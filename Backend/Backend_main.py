from fastapi import FastAPI, HTTPException, Depends, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import json
import os
import hashlib
import secrets
import pyotp
from datetime import datetime, timedelta
from sqlalchemy import create_engine, Column, String, Boolean, DateTime, Text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
import threading
import time
from pywebpush import webpush, WebPushException

# --- CONFIGURAZIONE ---
DATABASE_URL = os.environ.get("DATABASE_URL")
VAPID_PRIVATE_KEY = os.environ.get("VAPID_PRIVATE_KEY")
VAPID_PUBLIC_KEY = os.environ.get("VAPID_PUBLIC_KEY")
VAPID_CLAIMS = {"sub": "mailto:admin@agenda.it"}

# Se siamo in locale, carichiamo da auth_config.json
ADMIN_PASSWORD_HASH = os.environ.get("ADMIN_PASSWORD_HASH")
MFA_SECRET = os.environ.get("MFA_SECRET")

if not ADMIN_PASSWORD_HASH or not MFA_SECRET:
    try:
        with open(os.path.join(os.path.dirname(__file__), "auth_config.json"), "r") as f:
            config = json.load(f)
            if not ADMIN_PASSWORD_HASH: ADMIN_PASSWORD_HASH = config.get("password_hash")
            if not MFA_SECRET: MFA_SECRET = config.get("totp_secret")
    except:
        print("AVVISO: auth_config.json non trovato o incompleto.")

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
    time = Column(String, nullable=True) # Orario promemoria

class SubscriptionModel(Base):
    __tablename__ = "subscriptions"
    endpoint = Column(String, primary_key=True)
    subscription_info = Column(Text) # JSON con chiavi auth e p256dh

class SessionModel(Base):
    __tablename__ = "sessions"
    token = Column(String, primary_key=True)
    expiry = Column(DateTime)

# --- DATABASE SETUP ---
Base = declarative_base()

if not DATABASE_URL:
    # Se non c'è il DB online, l'app segnala l'errore chiaramente
    print("ERRORE: DATABASE_URL non impostato! Collegati a Render.")
    # Fallback minimo per non far crashare il caricamento del modulo
    engine = create_engine("sqlite:///:memory:") 
else:
    if DATABASE_URL.startswith("postgres://"):
        DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)
    engine = create_engine(DATABASE_URL)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Auto-riparazione database online (per recuperare i task)
if DATABASE_URL and "postgresql" in DATABASE_URL:
    from sqlalchemy import text
    with engine.connect() as conn:
        try:
            conn.execute(text("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS time VARCHAR;"))
            conn.commit()
            print("Database Online Riparato!")
        except Exception as e:
            print(f"Nota: {e}")

Base.metadata.create_all(bind=engine)

# --- PROMEMORIA IN BACKGROUND ---
def reminder_worker():
    while True:
        try:
            if not DATABASE_URL:
                time.sleep(60)
                continue
                
            engine_worker = create_engine(DATABASE_URL)
            SessionWorker = sessionmaker(bind=engine_worker)
            db = SessionWorker()
            
            now = datetime.now()
            currentTime = now.strftime("%H:%M")
            todayStr = now.strftime("%Y-%m-%d")
            
            tasks = db.query(TaskModel).filter(
                TaskModel.day == todayStr,
                TaskModel.time == currentTime,
                TaskModel.done == False
            ).all()
            
            if tasks and VAPID_PRIVATE_KEY:
                subscriptions = db.query(SubscriptionModel).all()
                for t in tasks:
                    for sub in subscriptions:
                        try:
                            webpush(
                                subscription_info=json.loads(sub.subscription_info),
                                data=json.dumps({
                                    "title": "PROMEMORIA AGENTA 🚀",
                                    "body": f"È l'ora di: {t.text}",
                                    "icon": "/logo192.png"
                                }),
                                vapid_private_key=VAPID_PRIVATE_KEY,
                                vapid_claims=VAPID_CLAIMS
                            )
                        except Exception:
                            pass
            db.close()
        except Exception as e:
            print(f"ERRORE REMINDER: {e}")
        time.sleep(60)

# Avvio thread promemoria per il cellulare
if DATABASE_URL and VAPID_PRIVATE_KEY:
    threading.Thread(target=reminder_worker, daemon=True).start()

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

import bcrypt

def verify_password(plain_password, hashed_password):
    # Se l'hash è lungo 64 caratteri, è probabilmente lo SHA256 locale
    if len(hashed_password) == 64:
        import hashlib
        return hashlib.sha256(plain_password.encode()).hexdigest() == hashed_password
    
    # Altrimenti usa bcrypt (per Render)
    import bcrypt
    try:
        return bcrypt.checkpw(plain_password.encode(), hashed_password.encode())
    except:
        return False

# --- ENDPOINTS AUTH ---
@app.post("/auth/login")
async def login(data: dict):
    print("--- TENTATIVO DI LOGIN ---")
    pwd = data.get("password")
    if not ADMIN_PASSWORD_HASH:
        print("ERRORE: ADMIN_PASSWORD_HASH non trovata!")
        raise HTTPException(status_code=500, detail="Server config error: Password hash missing")
    
    # Debug
    print(f"Metodo usato: NATIVE BCRYPT. Lunghezza Hash: {len(ADMIN_PASSWORD_HASH)}")
    
    try:
        if not verify_password(pwd, ADMIN_PASSWORD_HASH):
            print("LOGIN FALLITO: Password errata")
            raise HTTPException(status_code=401, detail="Password Errata")
    except HTTPException:
        raise
    except Exception as e:
        print(f"ERRORE CRITTOGRAFIA: {e}")
        raise HTTPException(status_code=500, detail=f"Errore tecnico: {e}")
    
    print("LOGIN OK!")
    return {"status": "mfa_required"}

@app.post("/auth/mfa")
async def verify_mfa(data: dict):
    pwd = data.get("password")
    code = data.get("code")
    remember = data.get("remember", False)
    
    if pwd and not verify_password(pwd, ADMIN_PASSWORD_HASH):
        raise HTTPException(status_code=401, detail="Sessione non valida")
    
    totp = pyotp.TOTP(MFA_SECRET)
    # Aumentiamo la tolleranza al disallineamento dell'ora (drift) fino a 90 secondi prima/dopo (valid_window=3)
    if not totp.verify(code, valid_window=3):
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

# --- ENDPOINT SOTTOSCRIZIONE ---
@app.post("/subscribe")
async def subscribe(data: dict, db: SessionLocal = Depends(get_db), auth: bool = Depends(check_auth)):
    endpoint = data.get("endpoint")
    if not endpoint:
        raise HTTPException(status_code=400, detail="Missing endpoint")
    
    sub = db.query(SubscriptionModel).filter(SubscriptionModel.endpoint == endpoint).first()
    if not sub:
        sub = SubscriptionModel(endpoint=endpoint, subscription_info=json.dumps(data))
        db.add(sub)
    else:
        sub.subscription_info = json.dumps(data)
    
    db.commit()
    return {"status": "ok"}

@app.get("/vapid-public-key")
async def get_vapid_key():
    return {"publicKey": VAPID_PUBLIC_KEY}

# --- ENDPOINTS TASK AGGIORNATI ---
@app.get("/tasks")
def get_tasks(db: SessionLocal = Depends(get_db), auth: bool = Depends(check_auth)):
    all_tasks = db.query(TaskModel).all()
    result = {}
    for t in all_tasks:
        if t.day not in result:
            result[t.day] = []
        result[t.day].append({
            "id": t.id,
            "text": t.text,
            "done": t.done,
            "col": t.col,
            "time": t.time # Aggiunto orario
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
                    col=str(t.get("col", "0")),
                    time=t.get("time") # Salviamo l'orario
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
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST_DIR = os.path.join(BASE_DIR, "Frontend_agenda", "dist")

@app.get("/api/health")
@app.head("/api/health")
def health(): return {"status": "ok"}

if os.path.isdir(DIST_DIR):
    app.mount("/assets", StaticFiles(directory=os.path.join(DIST_DIR, "assets")), name="assets")
    @app.get("/")
    @app.head("/")
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
        return {"error": f"Frontend non trovato in {DIST_DIR}."}