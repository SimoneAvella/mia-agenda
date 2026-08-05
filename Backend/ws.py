import socketio
from fastapi import Depends
from Backend.deps import get_current_user
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
        user = await get_current_user(token)
        await sio.save_session(sid, {"user_id": user["username"]})
        print(f"🔗 WS connected: {sid} as {user['username']}")
    except Exception as e:
        print("WS auth failed:", e)
        await sio.disconnect(sid)

@sio.event
async def disconnect(sid):
    print(f"❌ WS disconnected: {sid}")

# Helper to broadcast task changes to all connected clients
async def broadcast_task_change(event: str, payload: dict):
    await sio.emit(event, payload)
