import './App.css';
import { useEffect, useState, useRef } from "react";
import { getWeekDates, getTodayString } from "./utils/dates";
import TaskItem from "./TaskItem";
import { getTasks, updateTasks, moveTaskAPI, checkAuth, logout } from "./api";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  TouchSensor,
  DragOverlay,
  pointerWithin,
  rectIntersection,
  MeasuringStrategy,
} from "@dnd-kit/core";
import { 
  SortableContext, 
  verticalListSortingStrategy, 
  arrayMove 
} from "@dnd-kit/sortable";
import DroppableContainer from "./DroppableContainer";
import Login from "./Login";

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [weekStart, setWeekStart] = useState(new Date());
  const [days, setDays] = useState([]);
  const [tasks, setTasks] = useState({ Backlog: [] });
  const [showInput, setShowInput] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);
  const [newTask, setNewTask] = useState("");
  const [showTrashModal, setShowTrashModal] = useState(false);
  const [activeTask, setActiveTask] = useState(null);
  
  const lastWeekChangeRef = useRef(0);
  const activeEdgeRef = useRef(null);
  const weekTimerRef = useRef(null);
  const touchStartX = useRef(null);
  const touchStartY = useRef(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 250, tolerance: 5 },
    })
  );

  useEffect(() => {
    async function initAuth() {
      const isOk = await checkAuth();
      setIsAuthenticated(isOk);
      setIsCheckingAuth(false);
    }
    initAuth();

    const handleResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
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
    if (idx === -1) return;
    
    newTasks[day] = [...newTasks[day]];
    newTasks[day][idx] = { ...newTasks[day][idx], done: !newTasks[day][idx].done };
    setTasks(newTasks);
    updateTasks(newTasks);
  };

  const deleteTask = (day, taskId, taskText) => {
    const newTasks = { ...tasks };
    if (!newTasks[day]) return;
    const idx = newTasks[day].findIndex(t => (t.id ? t.id === taskId : t.task === taskText));
    if (idx === -1) return;
    
    if (!newTasks["Trash"]) newTasks["Trash"] = [];
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
    newTasks[day][idx] = { ...newTasks[day][idx], text: newText, task: newText };
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
    const updatedTasks = {
      ...tasks,
      Backlog: [
        { id: Date.now().toString(), text: newTask, task: newTask, done: false },
        ...(tasks["Backlog"] || [])
      ]
    };
    setTasks(updatedTasks);
    setNewTask("");
    setShowInput(false);
    updateTasks(updatedTasks);
  };

  const prevWeek = () => {
    setWeekStart(prev => {
      const d = new Date(prev);
      d.setDate(d.getDate() - 7);
      return d;
    });
  };

  const nextWeek = () => {
    setWeekStart(prev => {
      const d = new Date(prev);
      d.setDate(d.getDate() + 7);
      return d;
    });
  };

  const handleDragStart = (event) => {
    const { active } = event;
    let foundTask = null;
    let foundDay = null;
    
    Object.keys(tasks).forEach(day => {
      const t = tasks[day].find(item => (item.id || item.task) === active.id);
      if (t) {
        foundTask = t;
        foundDay = day;
      }
    });
    if (foundTask) {
      setActiveTask({ ...foundTask, currentDay: foundDay });
    }
  };

  const handleDragMove = (event) => {
    if (!isMobile) return;
    const { active } = event;
    const x = event.pointerCoordinates?.x || active?.rect?.current?.translated?.left;
    if (x === undefined || x === null) return;
    
    const threshold = 60; 
    let currentEdge = null;
    if (x < threshold) currentEdge = 'left';
    else if (x > window.innerWidth - threshold) currentEdge = 'right';
    
    if (currentEdge !== activeEdgeRef.current) {
      if (weekTimerRef.current) clearTimeout(weekTimerRef.current);
      activeEdgeRef.current = currentEdge;
      if (currentEdge) {
        weekTimerRef.current = setTimeout(() => {
          const now = Date.now();
          if (now - lastWeekChangeRef.current > 1500) {
            if (activeEdgeRef.current === 'left') prevWeek();
            else if (activeEdgeRef.current === 'right') nextWeek();
            lastWeekChangeRef.current = now;
          }
          weekTimerRef.current = null;
          activeEdgeRef.current = null; 
        }, 1200);
      }
    }
  };

  const handleTouchStart = (e) => {
    if (activeTask) return;
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  };

  const handleTouchEnd = (e) => {
    if (!touchStartX.current || !touchStartY.current || activeTask) return;
    const touchEndX = e.changedTouches[0].clientX;
    const touchEndY = e.changedTouches[0].clientY;
    
    const deltaX = touchEndX - touchStartX.current;
    const deltaY = touchEndY - touchStartY.current;
    
    if (Math.abs(deltaX) > 100 && Math.abs(deltaY) < 60) {
      if (deltaX > 0) prevWeek();
      else nextWeek();
    }
    touchStartX.current = null;
    touchStartY.current = null;
  };

  const handleDragEnd = async (event) => {
    setActiveTask(null);
    if (weekTimerRef.current) clearTimeout(weekTimerRef.current);
    activeEdgeRef.current = null;

    const { active, over } = event;
    if (!over) return;

    const taskId = active.id;
    const overId = over.id;

    let activeContainer = null;
    let activeIndex = -1;
    let foundTask = null;

    Object.keys(tasks).forEach(key => {
      const idx = (tasks[key] || []).findIndex(t => (t.id || t.task) === taskId);
      if (idx !== -1) {
        activeContainer = key;
        activeIndex = idx;
        foundTask = tasks[key][idx];
      }
    });

    if (!activeContainer || !foundTask) return;

    if (overId === "trash-zone") {
      if (window.confirm(`Vuoi davvero eliminare "${foundTask.text || foundTask.task}"?`)) {
        deleteTask(activeContainer, taskId, foundTask.task || foundTask.text);
      }
      return;
    }

    let overContainer = overId;
    let overIndex = -1;

    Object.keys(tasks).forEach(key => {
      const idx = (tasks[key] || []).findIndex(t => (t.id || t.task) === overId);
      if (idx !== -1) {
        overContainer = key;
        overIndex = idx;
      }
    });

    if (String(overId).startsWith("Backlog-col-")) {
      overContainer = "Backlog";
      overIndex = (tasks["Backlog"] || []).length;
    } else if (overId === "mobile-backlog") {
      overContainer = "Backlog";
      overIndex = (tasks["Backlog"] || []).length;
    }

    const isValidDest = days.includes(overContainer) || overContainer === "Backlog";
    if (!isValidDest) return;

    const updatedTasks = { ...tasks };
    if (activeContainer === overContainer) {
      if (activeIndex !== overIndex && overIndex !== -1) {
        updatedTasks[activeContainer] = arrayMove(tasks[activeContainer], activeIndex, overIndex);
      } else {
        return;
      }
    } else {
      const sourceList = [...(updatedTasks[activeContainer] || [])];
      sourceList.splice(activeIndex, 1);
      updatedTasks[activeContainer] = sourceList;

      const destList = [...(updatedTasks[overContainer] || [])];
      const newTaskObj = { ...foundTask };
      
      if (overIndex === -1) destList.push(newTaskObj);
      else destList.splice(overIndex, 0, newTaskObj);
      
      updatedTasks[overContainer] = destList;
    }

    setTasks(updatedTasks);
    updateTasks(updatedTasks);
    try {
      await updateTasks(updatedTasks);
    } catch (e) {
      console.error("Failed to save tasks:", e);
    }
  };

  const columns = [[], [], []];
  tasks["Backlog"]?.forEach((task, index) => {
    const colIdx = index % 3;
    columns[colIdx].push(task);
  });

  const customCollisionDetection = (args) => {
    const pointerCollisions = pointerWithin(args);
    const rectCollisions = rectIntersection(args);
    const trashCollision = pointerCollisions.find(c => c.id === "trash-zone") || rectCollisions.find(c => c.id === "trash-zone");
    
    if (trashCollision) return [trashCollision];
    return pointerCollisions.length > 0 ? pointerCollisions : rectCollisions;
  };

  return (
    <div className="app-container">
      {isMobile && (
        <div className="mobile-top-nav">
          <span className="mobile-title">Calendario 🗓️</span>
          <div className="mobile-nav-controls">
            <button onClick={prevWeek}>←</button>
            <button onClick={nextWeek}>→</button>
            <button onClick={handleLogout}>🚪</button>
          </div>
        </div>
      )}

      <DndContext 
        sensors={sensors} 
        onDragStart={handleDragStart}
        onDragMove={handleDragMove}
        onDragEnd={handleDragEnd}
        collisionDetection={customCollisionDetection}
        measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
      >
        <div className="main-layout">
          <div className="calendar-section">
            <div 
              className="week-container"
              onTouchStart={handleTouchStart}
              onTouchEnd={handleTouchEnd}
            >
              {days.map((day, i) => {
                const isToday = day === getTodayString();
                return (
                  <DroppableContainer key={i} className={`day-column ${isToday ? 'is-today' : ''}`} id={day}>
                    <h3 className={isToday ? "today-header" : ""}>{day}</h3>
                    <div className="column-scroll-area">
                      <SortableContext items={tasks[day] || []} strategy={verticalListSortingStrategy}>
                        {tasks[day]?.map((t) => (
                          <TaskItem
                            key={t.id || t.task}
                            task={t}
                            toggleDone={() => toggleTaskDone(day, t.id, t.text || t.task)}
                            editTaskText={(newText) => editTaskText(day, t.id, t.text || t.task, newText)}
                          />
                        ))}
                      </SortableContext>
                    </div>
                  </DroppableContainer>
                );
              })}
              {isMobile && (
                <DroppableContainer className="day-column mobile-backlog-column" id="mobile-backlog">
                  <h3>ATTIVITÀ 📋</h3>
                  <div className="column-scroll-area">
                    <SortableContext items={tasks["Backlog"] || []} strategy={verticalListSortingStrategy}>
                      {tasks["Backlog"]?.map((t) => (
                        <TaskItem
                          key={t.id || t.task}
                          task={t}
                          toggleDone={() => toggleTaskDone("Backlog", t.id, t.text || t.task)}
                          editTaskText={(newText) => editTaskText("Backlog", t.id, t.text || t.task, newText)}
                        />
                      ))}
                    </SortableContext>
                  </div>
                </DroppableContainer>
              )}
            </div>
          </div>

          {!isMobile && (
            <div className="backlog-sidebar">
              <div className="backlog-header">
                <div className="left-group">
                  <h2 className="backlog-title">Attività 📋</h2>
                  <button className="add-task-btn" onClick={() => setShowInput(true)}>➕</button>
                  <DroppableContainer
                    id="trash-zone"
                    className="trash-drop-zone"
                    title="Trascina qui per eliminare"
                    onClick={() => setShowTrashModal(true)}
                  >
                    🗑️
                  </DroppableContainer>
                </div>
                <div className="week-nav-buttons">
                  <button onClick={prevWeek}>←</button>
                  <button onClick={nextWeek}>→</button>
                  <button onClick={handleLogout} title="Logout">🚪</button>
                </div>
              </div>
              <div className="backlog-columns">
                {[0, 1, 2].map((colIdx) => (
                  <DroppableContainer key={`Backlog-col-${colIdx}`} className="activity-column" id={`Backlog-col-${colIdx}`}>
                    {colIdx === 0 && showInput && (
                      <textarea
                        className="task-input"
                        placeholder="Inserisci task..."
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
                      />
                    )}
                    <SortableContext items={columns[colIdx] || []} strategy={verticalListSortingStrategy}>
                      {columns[colIdx].map((t) => (
                        <TaskItem
                          key={t.id || t.task}
                          task={t}
                          toggleDone={() => toggleTaskDone("Backlog", t.id, t.text || t.task)}
                          editTaskText={(newText) => editTaskText("Backlog", t.id, t.text || t.task, newText)}
                        />
                      ))}
                    </SortableContext>
                  </DroppableContainer>
                ))}
              </div>
            </div>
          )}
        </div>

        <DragOverlay dropAnimation={null} zIndex={9999}>
          {activeTask ? (
            <div 
              className="task-item" 
              style={{ 
                width: "160px",
                background: "white",
                opacity: 1,
                cursor: "grabbing", 
                boxShadow: "0 25px 50px rgba(0,0,0,0.5)",
                border: "2px solid black",
                borderRadius: "6px",
                padding: "8px",
                fontWeight: "500",
                display: "flex",
                alignItems: "center",
                gap: "4px",
              }}
            >
               <input type="checkbox" checked={activeTask.done} readOnly style={{ marginRight: "4px" }} />
               <span style={{ fontSize: "14px" }}>{activeTask.text || activeTask.task}</span>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {isMobile && (
        <div className="mobile-fab-group">
          <button className="fab-add" onClick={() => setIsQuickAddOpen(true)}>+</button>
          <DroppableContainer id="trash-zone" className="fab-trash-wrapper" onClick={() => setShowTrashModal(true)}>
            <div className="fab-trash">🗑️</div>
          </DroppableContainer>
        </div>
      )}

      {isQuickAddOpen && (
        <div className="modal-overlay" onClick={() => setIsQuickAddOpen(false)}>
          <div className="modal-content glass" onClick={(e) => e.stopPropagation()}>
            <h3>Nuova Attività ✏️</h3>
            <textarea
              className="modal-textarea"
              placeholder="Cosa devi fare?"
              value={newTask}
              onChange={(e) => setNewTask(e.target.value)}
              autoFocus
            />
            <div className="modal-actions">
              <button className="btn-cancel" onClick={() => { setIsQuickAddOpen(false); setNewTask(""); }}>Annulla</button>
              <button className="btn-save" onClick={() => { handleAddTask(); setIsQuickAddOpen(false); }}>Salva</button>
            </div>
          </div>
        </div>
      )}

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
              <button className="empty-trash-btn" onClick={emptyTrash}>Svuota Cestino</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;