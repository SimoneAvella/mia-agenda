from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import json
import os
from datetime import datetime

app = FastAPI()

# Permette al frontend di accedere alle API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # in produzione metti il dominio reale
    allow_methods=["*"],
    allow_headers=["*"],
)

FILE = "tasks.json"

# Carica i task
def load_tasks():
    if os.path.exists(FILE):
        with open(FILE, "r") as f:
            return json.load(f)
    return {}

# Salva i task
def save_tasks(tasks):
    with open(FILE, "w") as f:
        json.dump(tasks, f, indent=2)

# Endpoint per ottenere tutti i task
@app.get("/tasks")
def get_tasks():
    return load_tasks()

# Endpoint per ottenere task di una data specifica
@app.get("/tasks/{date}")
def get_tasks_by_date(date: str):
    tasks = load_tasks()
    return tasks.get(date, {})

# Endpoint per aggiornare i task
@app.post("/tasks")
def update_tasks(tasks: dict):
    save_tasks(tasks)
    return {"status": "ok"}

# Endpoint per aggiornare task di una data specifica
@app.post("/tasks/{date}")
def update_tasks_by_date(date: str, day_tasks: dict):
    tasks = load_tasks()
    tasks[date] = day_tasks
    save_tasks(tasks)
    return {"status": "ok"}

# Endpoint per spostare un task da una data all'altra
@app.post("/move_task")
def move_task(data: dict):
    from_date = data["from_date"]
    to_date = data["to_date"]
    task_id = data["task_id"]
    task_text = data["task_text"]
    
    tasks = load_tasks()
    
    # Rimuovi dalla data di origine
    if from_date in tasks and task_id in tasks[from_date]:
        del tasks[from_date][task_id]
        # Se la data di origine è vuota, rimuovi la chiave
        if not tasks[from_date]:
            del tasks[from_date]
    
    # Aggiungi alla data di destinazione
    if to_date not in tasks:
        tasks[to_date] = {}
    tasks[to_date][task_id] = task_text
    
    save_tasks(tasks)
    return {"status": "ok"}