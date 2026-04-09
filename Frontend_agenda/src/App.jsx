import './App.css';
import { useEffect, useState } from "react";
import { getWeekDates } from "./utils/dates";
import TaskItem from "./TaskItem";
import { getTasks, updateTasks, moveTaskAPI, checkAuth, logout } from "./api";
import { DndContext, TouchSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import DroppableContainer from "./DroppableContainer";
import Login from "./Login";

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [weekStart, setWeekStart] = useState(new Date());
  const [days, setDays] = useState([]);
  const [tasks, setTasks] = useState({ Backlog: [] });
  const [showInput, setShowInput] = useState(false);
  const [newTask, setNewTask] = useState("");
  const [showTrashModal, setShowTrashModal] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 250,
        tolerance: 5,
      },
    })
  );

  // Controllo autenticazione iniziale
  useEffect(() => {
    async function initAuth() {
      const isOk = await checkAuth();
      setIsAuthenticated(isOk);
      setIsCheckingAuth(false);
    }
    initAuth();
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      setDays(getWeekDates(weekStart));
    }
  }, [weekStart, isAuthenticated]);

  useEffect(() => {
    if (isAuthenticated) {
      async function fetchTasks() {
        const data = await getTasks();
        setTasks(data);
      }
      fetchTasks();
    }
  }, [isAuthenticated]);

  if (isCheckingAuth) {
    return <div className="loading-screen">Caricamento sicurezza...</div>;
  }

  if (!isAuthenticated) {
    return <Login onLoginSuccess={() => setIsAuthenticated(true)} />;
  }

  const handleLogout = () => {
    logout();
    setIsAuthenticated(false);
  };

  const toggleTaskDone = (day, taskId, taskText) => {
    const newTasks = { ...tasks };
    if (!newTasks[day]) return;

    const idx = newTasks[day].findIndex(t => (t.id ? t.id === taskId : t.task === taskText));
    if (idx === -1) {
      console.error("Task non trovato");
      return;
    }

    newTasks[day] = [...newTasks[day]];
    const updatedTask = { ...newTasks[day][idx], done: !newTasks[day][idx].done };
    newTasks[day][idx] = updatedTask;

    setTasks(newTasks);
    updateTasks(newTasks);
  };

  const deleteTask = (day, taskId, taskText) => {
    const newTasks = { ...tasks };
    if (!newTasks[day]) return;

    const idx = newTasks[day].findIndex(t => (t.id ? t.id === taskId : t.task === taskText));
    if (idx === -1) return;

    if (!newTasks["Trash"]) newTasks["Trash"] = [];

    newTasks[day] = [...newTasks[day]];
    const deletedTask = newTasks[day].splice(idx, 1)[0];
    newTasks["Trash"] = [...newTasks["Trash"], deletedTask];

    setTasks(newTasks);
    updateTasks(newTasks);
  };

  const editTaskText = (day, taskId, oldText, newText) => {
    const newTasks = { ...tasks };
    if (!newTasks[day]) return;

    const idx = newTasks[day].findIndex(t => (t.id ? t.id === taskId : t.task === oldText));
    if (idx === -1) return;

    newTasks[day] = [...newTasks[day]];
    const updatedTask = { ...newTasks[day][idx], text: newText, task: newText };
    newTasks[day][idx] = updatedTask;

    setTasks(newTasks);
    updateTasks(newTasks);
  };

  const restoreTask = (taskId) => {
    const newTasks = { ...tasks };
    if (!newTasks["Trash"]) return;

    const idx = newTasks["Trash"].findIndex(t => t.id === taskId);
    if (idx === -1) return;

    const restoredTask = { ...newTasks["Trash"].splice(idx, 1)[0], done: false };

    if (!newTasks["Backlog"]) newTasks["Backlog"] = [];
    newTasks["Backlog"].push(restoredTask);

    setTasks(newTasks);
    updateTasks(newTasks);
  };

  const emptyTrash = () => {
    if (window.confirm("Sei sicuro di voler svuotare il cestino definitivamente?")) {
      const newTasks = { ...tasks };
      newTasks["Trash"] = [];
      setTasks(newTasks);
      updateTasks(newTasks);
    }
  };

  const handleAddTask = () => {
    if (newTask.trim() === "") {
      setShowInput(false);
      setNewTask("");
      return;
    }

    // Trova la colonna con meno task
    const colLengths = [0, 0, 0];
    tasks["Backlog"]?.forEach((t) => {
      const col = t.col ?? 0;
      colLengths[col]++;
    });
    const targetCol = colLengths.indexOf(Math.min(...colLengths));

    const updatedTasks = {
      ...tasks,
      Backlog: [
        ...(tasks["Backlog"] || []),
        // Aggiungiamo sia 'id' che 'text' sia 'task' per la retrocompatibilitá con Streamlit
        { id: Date.now().toString(), text: newTask, task: newTask, done: false, col: targetCol }
      ]
    };

    setTasks(updatedTasks);
    setNewTask("");
    setShowInput(false);
    updateTasks(updatedTasks);
  };

  const prevWeek = () => setWeekStart(prev => { const d = new Date(prev); d.setDate(d.getDate() - 7); return d; });
  const nextWeek = () => setWeekStart(prev => { const d = new Date(prev); d.setDate(d.getDate() + 7); return d; });

  const handleDragEnd = async (event) => {
    const { active, over } = event;
    if (!over) return;

    const taskId = active.id;
    const targetId = over.id; // Può essere un giorno es: "Lunedì 24/4" o "Backlog-col-0"

    // Trova dove si trova attualmente il task
    let sourceKey = null;
    let foundTask = null;
    let sourceIndex = -1;

    for (const key of Object.keys(tasks)) {
      if (!tasks[key]) continue;
      const idx = tasks[key].findIndex(t => (t.id ? t.id === taskId : t.task === taskId));
      if (idx !== -1) {
        sourceKey = key;
        foundTask = tasks[key][idx];
        sourceIndex = idx;
        break;
      }
    }

    if (!sourceKey || !foundTask) return;

    // Se stiamo buttando nel cestino
    if (targetId === "trash-zone") {
      deleteTask(sourceKey, taskId, foundTask.task || foundTask.text);
      return;
    }

    // Determina la destinazione
    let destKey = targetId;
    let destCol = foundTask.col; // Conserva la colonna se rimpiazzato nel backlog

    if (String(targetId).startsWith("Backlog-col-")) {
      destKey = "Backlog";
      destCol = parseInt(String(targetId).replace("Backlog-col-", ""), 10);
    }

    // Se il source è uguale alla destinazione non fare nulla.
    if (sourceKey === destKey && (sourceKey !== "Backlog" || destCol === foundTask.col)) {
      return;
    }

    const updatedTasks = { ...tasks };
    updatedTasks[sourceKey] = [...(updatedTasks[sourceKey] || [])];
    updatedTasks[sourceKey].splice(sourceIndex, 1);

    const newTaskObj = { ...foundTask };
    if (destKey === "Backlog") {
      newTaskObj.col = destCol;
    }

    if (!updatedTasks[destKey]) {
      updatedTasks[destKey] = [];
    }
    updatedTasks[destKey] = [...updatedTasks[destKey], newTaskObj];

    // Aggiornamento ottimistico dello stato
    setTasks(updatedTasks);

    try {
      await moveTaskAPI(sourceKey, destKey, taskId);
      // Dobbiamo aggiornare in modo persistente se ci sono metadati come "col" per il Backlog
      if (destKey === "Backlog" || sourceKey === "Backlog") {
        await updateTasks(updatedTasks);
      }
    } catch (e) {
      console.error("Failed to move task:", e);
      // Opzionale potresti ricaricare lo stato ripristinandolo in caso di errore.
    }
  };

  // colonne backlog per visualizzazione
  const columns = [[], [], []];
  tasks["Backlog"]?.forEach((task) => {
    const col = task.col ?? 0;
    if (col >= 0 && col <= 2) columns[col].push(task);
  });

  return (
    <div className="app-container">
      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <div className="main-layout">

          {/* CALENDARIO */}
          <div className="calendar-section">
            <div className="week-container">
              {days.map((day, i) => (
                <DroppableContainer key={i} className="day-column" id={day}>
                  <h3>{day}</h3>
                  {tasks[day]?.map((t, idx) => (
                    <TaskItem
                      key={t.id || t.task}
                      task={t}
                      toggleDone={() => toggleTaskDone(day, t.id, t.text || t.task)}
                      editTaskText={(newText) => editTaskText(day, t.id, t.text || t.task, newText)}
                    />
                  ))}
                </DroppableContainer>
              ))}
            </div>
          </div>

          {/* BACKLOG */}
          <div className="backlog-sidebar">
            <div className="backlog-header">
              <div className="left-group">
                <h2 className="backlog-title">Attività 📋</h2>
                <button className="add-task-btn" onClick={() => setShowInput(true)}>➕</button>
                <DroppableContainer
                  id="trash-zone"
                  className="trash-drop-zone"
                  title="Clicca per aprire il cestino, o trascina qui per eliminare"
                  onClick={() => setShowTrashModal(true)}
                >
                  🗑️
                </DroppableContainer>
              </div>
              <div className="week-nav-buttons">
                <button onClick={prevWeek}>←</button>
                <button onClick={nextWeek}>→</button>
                <button onClick={handleLogout} title="Logout" style={{ padding: '4px', fontSize: '14px' }}>🚪</button>
              </div>
            </div>

            <div className="backlog-columns">
              {[0, 1, 2].map((colIdx) => (
                <DroppableContainer key={`Backlog-col-${colIdx}`} className="activity-column" id={`Backlog-col-${colIdx}`}>
                  {colIdx === 0 && showInput && (
                    <textarea
                      className="task-input"
                      placeholder=""
                      value={newTask}
                      onChange={(e) => {
                        setNewTask(e.target.value);
                        e.target.style.height = "auto";
                        e.target.style.height = e.target.scrollHeight + "px";
                      }}
                      onBlur={handleAddTask}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          handleAddTask();
                        }
                      }}
                      autoFocus
                      style={{ minHeight: "20px", overflow: "hidden" }}
                    />
                  )}

                  {columns[colIdx].map((t) => (
                    <TaskItem
                      key={t.id || t.task}
                      task={t}
                      toggleDone={() => toggleTaskDone("Backlog", t.id, t.text || t.task)}
                      editTaskText={(newText) => editTaskText("Backlog", t.id, t.text || t.task, newText)}
                    />
                  ))}
                </DroppableContainer>
              ))}
            </div>
          </div>

        </div>
      </DndContext>

      {/* MODALE CESTINO */}
      {showTrashModal && (
        <div className="trash-modal-overlay" onClick={() => setShowTrashModal(false)}>
          <div className="trash-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="trash-modal-header">
              <h2>Cestino 🗑️</h2>
              <button className="close-modal-btn" onClick={() => setShowTrashModal(false)}>✖</button>
            </div>

            <div className="trash-items-list">
              {(!tasks["Trash"] || tasks["Trash"].length === 0) ? (
                <p style={{ textAlign: "center", color: "#888" }}>Il cestino è vuoto.</p>
              ) : (
                tasks["Trash"].map((t, idx) => (
                  <div key={t.id || t.task || idx} className="trash-item">
                    <span className="trash-item-text">{t.text || t.task}</span>
                    <button className="restore-btn" onClick={() => restoreTask(t.id)}>
                      ♻️ Ripristina
                    </button>
                  </div>
                ))
              )}
            </div>

            {tasks["Trash"] && tasks["Trash"].length > 0 && (
              <button className="empty-trash-btn" onClick={emptyTrash}>
                Svuota Cestino
              </button>
            )}
          </div>
        </div>
      )}

    </div>
  );
}

export default App;