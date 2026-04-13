import json
import os
from sqlalchemy import create_engine, Column, String, Boolean
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

# --- CONFIGURAZIONE ---
DATABASE_URL = "postgresql://neondb_owner:npg_l0p2QuykwznL@ep-purple-band-al3rh0xi-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require"
JSON_FILE = "Backend/tasks.json"

Base = declarative_base()

class TaskModel(Base):
    __tablename__ = "tasks"
    id = Column(String, primary_key=True)
    day = Column(String, index=True)
    text = Column(String)
    done = Column(Boolean, default=False)
    col = Column(String)

def migrate():
    if not os.path.exists(JSON_FILE):
        print(f"Errore: File {JSON_FILE} non trovato!")
        return

    print("Connessione al database Neon...")
    engine = create_engine(DATABASE_URL)
    SessionLocal = sessionmaker(bind=engine)
    db = SessionLocal()

    print("Rimozione dati esistenti (pulizia)...")
    db.query(TaskModel).delete()

    print(f"Lettura dati da {JSON_FILE}...")
    with open(JSON_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)

    count = 0
    for day, tasks in data.items():
        if day == "Trash": continue # Saltiamo il cestino per ora se vuoi
        for t in tasks:
            new_task = TaskModel(
                id=str(t.get("id")),
                day=day,
                text=t.get("text") or t.get("task"),
                done=t.get("done", False),
                col=str(t.get("col", "0"))
            )
            db.add(new_task)
            count += 1

    db.commit()
    db.close()
    print(f"✅ Migrazione completata con successo! {count} attività caricate.")

if __name__ == "__main__":
    migrate()
