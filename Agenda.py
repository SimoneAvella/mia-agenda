import streamlit as st
import json
import os
import datetime
from streamlit_sortables import sort_items

FILE = "tasks.json"

# Funzione per caricare i task
def load_tasks():
    if os.path.exists(FILE):
        with open(FILE, "r") as f:
            return json.load(f)
    return {}

# Funzione per salvare i task
def save_tasks(tasks):
    with open(FILE, "w") as f:
        json.dump(tasks, f, indent=2)

st.set_page_config(layout="wide")

st.markdown("""
    <style>
        .block-container {
            padding-top: 1rem;
            padding-bottom: 0rem;
            padding-left: 2rem;
            padding-right: 2rem;
        }
    </style>
""", unsafe_allow_html=True)
st.markdown("""
    <style>
        header {visibility: hidden;}
        footer {visibility: hidden;}
    </style>
""", unsafe_allow_html=True)

# Carica tasks esistenti
tasks = load_tasks()
if "Backlog" not in tasks:
    tasks["Backlog"] = []

# SESSION STATE: data di partenza della settimana
if "week_start" not in st.session_state:
    oggi = datetime.date.today()
    st.session_state.week_start = oggi - datetime.timedelta(days=oggi.weekday())  # lunedì di questa settimana

# 👈/👉 per cambiare settimana
col_prev, col_next = st.columns([0.1, 0.1])
with col_prev:
    if st.button("⬅️ Settimana precedente"):
        st.session_state.week_start -= datetime.timedelta(days=7)
with col_next:
    if st.button("Settimana successiva ➡️"):
        st.session_state.week_start += datetime.timedelta(days=7)

# Genera giorni della settimana selezionata
giorni_it = ["Lunedì","Martedì","Mercoledì","Giovedì","Venerdì","Sabato","Domenica"]
days = []
for i in range(7):
    giorno = st.session_state.week_start + datetime.timedelta(days=i)
    day_str = f"{giorni_it[giorno.weekday()]} {giorno.day}/{giorno.month}"
    days.append(day_str)
    if day_str not in tasks:
        tasks[day_str] = []


# 📊 Vista settimanale
cols = st.columns(7)

for i, day in enumerate(days):
    with cols[i]:
        st.markdown(f"### {day}")

        task_names = [t["task"] for t in tasks[day]]

        new_order = sort_items(task_names, key=day)

        # aggiorna ordine mantenendo "done"
        new_tasks = []
        for name in new_order:
            for t in tasks[day]:
                if t["task"] == name:
                    new_tasks.append(t)
                    break
        tasks[day] = new_tasks

        # checkbox sotto
        for idx, t in enumerate(tasks[day]):
            tasks[day][idx]["done"] = st.checkbox(
                t["task"],
                value=t["done"],
                key=f"{day}-{idx}"
            )
st.markdown("---")
st.markdown("## 📋 Backlog (trascina sopra)")

# input veloce
new_task = st.text_input("Nuovo task")

if st.button("Aggiungi al backlog"):
    if new_task:
        tasks["Backlog"].append({"task": new_task, "done": False})
        save_tasks(tasks)
        st.experimental_rerun()

# drag backlog
backlog_names = [t["task"] for t in tasks["Backlog"]]

new_backlog = sort_items(backlog_names, key="backlog")

# aggiorna ordine backlog
updated_backlog = []
for name in new_backlog:
    for t in tasks["Backlog"]:
        if t["task"] == name:
            updated_backlog.append(t)
            break
tasks["Backlog"] = updated_backlog

# Salva sempre alla fine
save_tasks(tasks)