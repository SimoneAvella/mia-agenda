from fastapi import FastAPI, HTTPException, Depends, Header, Body
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
from sqlalchemy.exc import OperationalError
import threading
import time
from pywebpush import webpush, WebPushException

# --- CONFIGURAZIONE ---
import logging
import re
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

from Backend.ws import sio
import socketio
app.mount("/ws", socketio.ASGIApp(sio, socketio_path=""))


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
# Duplicate Base removed – keep the first Base declaration

if not DATABASE_URL:
    # Se non c'è il DB online, l'app segnala l'errore chiaramente
    logging.error("⚠️ DATABASE_URL non impostata! Uso SQLite temporaneo (solo per debug).")
    # Fallback minimo per non far crashare il caricamento del modulo
    engine = create_engine("sqlite:///:memory:")
else:
    # Normalizza l'URL se necessario
    if DATABASE_URL.startswith("postgres://"):
        DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

    # Maschera password nei log
    safe_url = re.sub(r"://([^:]+):[^@]+@", r"://\1:******@", DATABASE_URL)
    logging.info(f"🔧 DATABASE_URL impostata: {safe_url}")

    # Creazione dell'engine con pool pre‑ping e riciclo ogni 30 min
    engine = create_engine(
        DATABASE_URL,
        pool_pre_ping=True,
        pool_recycle=1800,
        connect_args={"sslmode": "require"},
    )

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
                                    "title": "PROMEMORIA AGENDA 🚀",
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

# if DATABASE_URL and VAPID_PRIVATE_KEY:
#     threading.Thread(target=reminder_worker, daemon=True).start()

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
    try:
        db = SessionLocal()
        session = db.query(SessionModel).filter(SessionModel.token == token).first()
    except OperationalError as e:
        logging.warning(f"⚠️ DB connection error in check_auth: {e}")
        raise HTTPException(status_code=401, detail="Database connection error")
    finally:
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
        is_local_dev = not os.environ.get("RENDER")
        if not is_local_dev and not verify_password(pwd, ADMIN_PASSWORD_HASH):
            print("LOGIN FALLITO: Password errata")
            raise HTTPException(status_code=401, detail="Password Errata")
        elif is_local_dev:
            print("LOGIN BYPASS LOCALE: Accetto qualsiasi password")
    except HTTPException:
        raise
    except Exception as e:
        print(f"ERRORE CRITTOGRAFIA: {e}")
        raise HTTPException(status_code=500, detail=f"Errore tecnico: {e}")
    
    print("LOGIN OK!")
    return {"status": "mfa_required"}

@app.post("/auth/mfa")
async def verify_mfa(data: dict):
    # If we are running locally (no RENDER env), skip MFA entirely.
    if not os.getenv("RENDER"):
        remember = data.get("remember", False)
        days = 365 if remember else 90
        token = secrets.token_hex(32)
        expiry = datetime.now() + timedelta(days=days)
        db = SessionLocal()
        db.add(SessionModel(token=token, expiry=expiry))
        db.commit()
        db.close()
        return {"token": token}

    # Production flow – keep original security checks.
    pwd = data.get("password")
    code = data.get("code")
    remember = data.get("remember", False)

    if pwd and not verify_password(pwd, ADMIN_PASSWORD_HASH):
        raise HTTPException(status_code=401, detail="Sessione non valida")

    totp = pyotp.TOTP(MFA_SECRET)
    print(f"Verifica TOTP per il codice: {code}")
    if not totp.verify(code):
        raise HTTPException(status_code=401, detail="Codice MFA non valido")

    token = secrets.token_hex(32)
    # Impostiamo una durata più lunga della sessione:
    # se l'utente spunta "remember me" manteniamo 365 giorni, altrimenti 90 giorni.
    days = 365 if remember else 90
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
def update_tasks(tasks_dict: dict = Body(...), db: SessionLocal = Depends(get_db), auth: bool = Depends(check_auth)):
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

# --- ATOMIC ENDPOINTS ---
from Backend.ws import broadcast_task_change
import asyncio

@app.post("/task")
async def add_task_atomic(task: dict = Body(...), db: SessionLocal = Depends(get_db), auth: bool = Depends(check_auth)):
    new_task = TaskModel(
        id=str(task.get("id", secrets.token_hex(4))),
        day=task.get("day"),
        text=task.get("text", ""),
        done=task.get("done", False),
        col=str(task.get("col", "0")),
        time=task.get("time")
    )
    db.add(new_task)
    db.commit()
    
    await broadcast_task_change("task_created", {
        "id": new_task.id,
        "day": new_task.day,
        "text": new_task.text,
        "done": new_task.done,
        "col": new_task.col,
        "time": new_task.time
    })
    return {"status": "ok", "task_id": new_task.id}

@app.patch("/task/{task_id}")
async def update_task_atomic(task_id: str, changes: dict = Body(...), db: SessionLocal = Depends(get_db), auth: bool = Depends(check_auth)):
    print(f"PATCH /task/{task_id} - changes: {changes}")
    task = db.query(TaskModel).filter(TaskModel.id == task_id).first()
    if not task:
        print(f"PATCH 404: task '{task_id}' not found in DB. All IDs: {[t.id for t in db.query(TaskModel).all()]}")
        raise HTTPException(status_code=404, detail="Task not found")
    
    for key, value in changes.items():
        if hasattr(task, key):
            setattr(task, key, value)
            
    db.commit()
    
    await broadcast_task_change("task_updated", {
        "id": task.id,
        "day": task.day,
        "text": task.text,
        "done": task.done,
        "col": task.col,
        "time": task.time
    })
    return {"status": "ok"}

@app.delete("/task/{task_id}")
async def delete_task_atomic(task_id: str, db: SessionLocal = Depends(get_db), auth: bool = Depends(check_auth)):
    task = db.query(TaskModel).filter(TaskModel.id == task_id).first()
    if task:
        db.delete(task)
        db.commit()
        await broadcast_task_change("task_deleted", {"id": task_id, "day": task.day})
    return {"status": "ok"}

@app.post("/move_task")
async def move_task(payload: dict = Body(...), db: SessionLocal = Depends(get_db), auth: bool = Depends(check_auth)):
    to_date = payload.get("to_date")
    task_id = payload.get("task_id")
    
    task = db.query(TaskModel).filter(TaskModel.id == str(task_id)).first()
    if task:
        task.day = to_date
        db.commit()
        await broadcast_task_change("task_updated", {
            "id": task.id,
            "day": task.day,
            "text": task.text,
            "done": task.done,
            "col": task.col,
            "time": task.time
        })
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