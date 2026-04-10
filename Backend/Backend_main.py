import os
import json
import hashlib
import secrets
import pyotp
from datetime import datetime, timedelta
from fastapi import FastAPI, HTTPException, Depends, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from sqlalchemy import create_engine, Column, String, Boolean, DateTime, Text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

# --- CONFIGURAZIONE ---
DATABASE_URL = os.environ.get("DATABASE_URL")
ADMIN_PASSWORD_HASH = os.environ.get("ADMIN_PASSWORD_HASH")
MFA_SECRET = os.environ.get("MFA_SECRET")

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- DATABASE SETUP ---
Base = declarative_base()

class TaskModel(Base):
    __tablename__ = "tasks"
    id = Column(String, primary_key=True)
    day = Column(String, index=True)
    text = Column(String)
    done = Column(Boolean, default=False)
    col = Column(String)

class SessionModel(Base):
    __tablename__ = "sessions"
    token = Column(String, primary_key=True)
    expiry = Column(DateTime)

if DATABASE_URL:
    if DATABASE_URL.startswith("postgres://"):
        DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)
    
    engine = create_engine(DATABASE_URL)
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)
else:
    print("ATTENZIONE: DATABASE_URL non impostato!")

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# --- DIPENDENZA SICUREZZA ---
async def check_auth(authorization: str = Header(None)):
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing Token")
    
    token = authorization.replace("Bearer ", "")
    db = SessionLocal()
    session = db.query(SessionModel).filter(SessionModel.token == token).first()
    db.close()

    if not session:
        raise HTTPException(status_code=401, detail="Invalid Token")
    
    if datetime.now() > session.expiry:
        db = SessionLocal()
        db.delete(session)
        db.commit()
        db.close()
        raise HTTPException(status_code=401, detail="Token Expired")
    
    return True

# --- ENDPOINTS AUTH ---

@app.post("/auth/login")
async def login(data: dict):
    pwd = data.get("password")
    if not ADMIN_PASSWORD_HASH:
        raise HTTPException(status_code=500, detail="Server config error: Password hash missing")
    
    pwd_hash = hashlib.sha256(pwd.encode()).hexdigest()
    if pwd_hash != ADMIN_PASSWORD_HASH:
        raise HTTPException(status_code=401, detail="Password Errata")
    
    return {"status": "mfa_required"}

@app.post("/auth/mfa")
async def verify_mfa(data: dict):
    pwd = data.get("password")
    code = data.get("code")
    remember = data.get("remember", False)
    
    if pwd and hashlib.sha256(pwd.encode()).hexdigest() != ADMIN_PASSWORD_HASH:
        raise HTTPException(status_code=401, detail="Sessione non valida")
    
    totp = pyotp.TOTP(MFA_SECRET)
    if not totp.verify(code):
        raise HTTPException(status_code=401, detail="Codice MFA Errato")
    
    token = secrets.token_hex(32)
    days = 30 if remember else 1
    expiry = datetime.now() + timedelta(days=days)
    
    db = SessionLocal()
    new_session = SessionModel(token=token, expiry=expiry)
    db.add(new_session)
    db.commit()
    db.close()
    
    return {"token": token}

@app.get("/auth/check")
async def check_token(authorization: str = Header(None)):
    if not authorization: return {"status": "error"}
    try:
        await check_auth(authorization)
        return {"status": "ok"}
    except:
        return {"status": "error"}

# --- ENDPOINTS TASK ---

@app.get("/tasks")
def get_tasks(db: SessionLocal = Depends(get_db), auth: bool = Depends(check_auth)):
    all_tasks = db.query(TaskModel).all()
    result = {}
    for t in all_tasks:
        if t.day not in result:
            result[t.day] = []
        result[t.day].append({
            "id": t.id, "text": t.text, "done": t.done, "col": t.col
        })
    return result

@app.post("/tasks")
def update_tasks(tasks_dict: dict, db: SessionLocal = Depends(get_db), auth: bool = Depends(check_auth)):
    db.query(TaskModel).delete()
    for day, tasks in tasks_dict.items():
        if isinstance(tasks, list):
            for t in tasks:
                new_task = TaskModel(
                    id=str(t.get("id", secrets.token_hex(4))),
                    day=day,
                    text=t.get("text", t.get("task", "")),
                    done=t.get("done", False),
                    col=str(t.get("col", "0"))
                )
                db.add(new_task)
    db.commit()
    return {"status": "ok"}

@app.post("/move_task")
def move_task(data: dict, db: SessionLocal = Depends(get_db), auth: bool = Depends(check_auth)):
    to_date = data.get("to_date")
    task_id = data.get("task_id")
    task = db.query(TaskModel).filter(TaskModel.id == str(task_id)).first()
    if task:
        task.day = to_date
        db.commit()
    return {"status": "ok"}

# --- SERVE FRONTEND (ROBUSTO) ---
# Cerchiamo la cartella dist in modo più aggressivo
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST_DIR = os.path.join(BASE_DIR, "Frontend_agenda", "dist")

print(f"DEBUG: BASE_DIR = {BASE_DIR}")
print(f"DEBUG: DIST_DIR = {DIST_DIR}")
print(f"DEBUG: Esiste DIST_DIR? {os.path.isdir(DIST_DIR)}")

@app.get("/api/health")
def health(): return {"status": "ok"}

# Monta gli asset se la cartella esiste
if os.path.isdir(DIST_DIR):
    app.mount("/assets", StaticFiles(directory=os.path.join(DIST_DIR, "assets")), name="assets")

    @app.get("/")
    def serve_index():
        return FileResponse(os.path.join(DIST_DIR, "index.html"))

    @app.get("/{full_path:path}")
    def serve_react(full_path: str):
        file_path = os.path.join(DIST_DIR, full_path)
        if os.path.isfile(file_path): return FileResponse(file_path)
        return FileResponse(os.path.join(DIST_DIR, "index.html"))
else:
    @app.get("/")
    def fallback():
        return {"error": f"Frontend non trovato in {DIST_DIR}. Controlla la struttura delle cartelle su GitHub."}