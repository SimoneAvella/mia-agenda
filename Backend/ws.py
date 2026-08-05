import socketio
from fastapi import Depends

import json

# Create Socket.IO server (async mode for FastAPI)
sio = socketio.AsyncServer(async_mode="asgi", cors_allowed_origins="*")

# Simple connection handler that validates JWT token
@sio.event
async def connect(sid, environ, auth):
    token = auth.get("token") if auth else None
    if not token:
        await sio.disconnect(sid)
        return
    try:
        from Backend.Backend_main import SessionLocal, SessionModel
        from datetime import datetime
        db = SessionLocal()
        session_obj = db.query(SessionModel).filter(SessionModel.token == token).first()
        
        if not session_obj or datetime.now() > session_obj.expiry:
            if session_obj:
                db.delete(session_obj)
                db.commit()
            db.close()
            await sio.disconnect(sid)
            return
            
        db.close()
        await sio.save_session(sid, {"auth": True})
        print(f"🔗 WS connected: {sid}")
    except Exception as e:
        print("WS auth failed:", e)
        await sio.disconnect(sid)

@sio.event
async def disconnect(sid):
    print(f"❌ WS disconnected: {sid}")

# Helper to broadcast task changes to all connected clients
async def broadcast_task_change(event: str, payload: dict):
    await sio.emit(event, payload)
