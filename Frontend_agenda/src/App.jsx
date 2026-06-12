// BUILD_TEST_12345
import './App.css';
import { useState, useEffect, useRef } from "react";

// Feature flag: enable drag‑to‑edge week switching on mobile devices
const ENABLE_WEEK_EDGE_DRAG = true; // set to false to disable
import { createPortal } from "react-dom";
import { getWeekDates, getTodayString } from "./utils/dates";
import TaskItem from "./TaskItem";
import { getTasks, updateTasks, moveTaskAPI, checkAuth, logout, API_BASE_URL } from "./api";
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
  rectSortingStrategy,
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
  const [isMobile, setIsMobile] = useState(('ontouchstart' in window) || window.innerWidth <= 768);

  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);
  const [newTask, setNewTask] = useState("");
  const [showTrashModal, setShowTrashModal] = useState(false);
  const [activeTask, setActiveTask] = useState(null);
  const [showArchiveModal, setShowArchiveModal] = useState(false);
  const [movingTaskId, setMovingTaskId] = useState(null);
  const [isDraggingFromBacklog, setIsDraggingFromBacklog] = useState(false);
  const [draggingEdge, setDraggingEdge] = useState(null);
  const [edgeTimer, setEdgeTimer] = useState(null);
  
  const EDGE_TIMEOUT = 1100;
  const EDGE_THRESHOLD = 80;

  const [addingToDay, setAddingToDay] = useState(null);
  const [inlineDayTask, setInlineDayTask] = useState("");
  const [newTaskTime, setNewTaskTime] = useState("");
  const notifiedTasksRef = useRef(new Set());
  
  const parseTime = (text) => {
    if (!text) return null;
    const timeMatch = text.match(/\b([01]?\d|2[0-3])[:. ]([0-5]\d)\b/);
    if (timeMatch) return `${timeMatch[1].padStart(2, '0')}:${timeMatch[2]}`;
    const hourEndMatch = text.match(/\b([01]?\d|2[0-3])\b\s*$/);
    if (hourEndMatch) return `${hourEndMatch[1].padStart(2, '0')}:00`;
    const hourStartMatch = text.match(/^\s*\b([01]?\d|2[0-3])\b/);
    if (hourStartMatch) return `${hourStartMatch[1].padStart(2, '0')}:00`;
    return null;
  };

  const stripTime = (text) => {
    if (!text) return "";
    let cleaned = text;
    cleaned = cleaned.replace(/\b([01]?\d|2[0-3])[:. ]([0-5]\d)\b/g, "");
    cleaned = cleaned.replace(/\b([01]?\d|2[0-3])\b\s*$/, "");
    cleaned = cleaned.replace(/^\s*\b([01]?\d|2[0-3])\b/g, "");
    return cleaned.trim();
  };

  const [detectedTime, setDetectedTime] = useState(null);
  const [pushStatus, setPushStatus] = useState('pending');

  const subscribeToPush = async () => {
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        setPushStatus('unsupported');
        return;
      }
      const registration = await navigator.serviceWorker.register('/sw.js');
      const permission = await Notification.requestPermission();
      setPushStatus(permission);
      if (permission === 'granted') {
        const response = await fetch(`${API_BASE_URL}/vapid-public-key`);
        const { publicKey } = await response.json();
        const subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: publicKey
        });
        await fetch(`${API_BASE_URL}/subscribe`, {
          method: 'POST',
          body: JSON.stringify(subscription),
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem("agenda_token")}`
          }
        });
        setPushStatus('granted');
      }
    } catch (error) {
      console.error("Push Error:", error);
      setPushStatus('error');
    }
  };
  
  const activeEdgeRef = useRef(null);
  const weekTimerRef = useRef(null);
  const touchStartX = useRef(null);
  const touchStartY = useRef(null);
  const dragStartX = useRef(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 10 } })
  );

  useEffect(() => {
    async function initAuth() {
      try {
        const isOk = await checkAuth();
        setIsAuthenticated(isOk);
      } catch (e) {
        setIsAuthenticated(false);
      } finally {
        setTimeout(() => { setIsCheckingAuth(false); }, 500);
      }
    }
    initAuth();
    const handleResize = () => {
      const mobile = ('ontouchstart' in window) || window.innerWidth <= 768;
      setIsMobile(mobile);
    };
    window.addEventListener('resize', handleResize);
    handleResize();
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (isAuthenticated) subscribeToPush();
  }, [isAuthenticated]);

  useEffect(() => {
    if (isAuthenticated) setDays(getWeekDates(weekStart));
  }, [weekStart, isAuthenticated]);

  useEffect(() => {
    if (isAuthenticated) {
      async function fetchTasks() {
        const data = await getTasks();
        const normalized = {};
        Object.keys(data).forEach(day => {
          normalized[day] = data[day].map((t, i) => ({
            ...t,
            id: String(t.id || `task-${day}-${i}-${Date.now()}`)
          }));
        });
        setTasks(normalized);
      }
      fetchTasks();
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) return;
    const checkReminders = () => {
      const now = new Date();
      const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      const todayStr = getTodayString();
      if (tasks[todayStr]) {
        tasks[todayStr].forEach(t => {
          if (!t.done && t.time === currentTime && !notifiedTasksRef.current.has(t.id)) {
            new Notification("PROMEMORIA AGENDA", {
              body: `È l'ora di: ${t.text || t.task}`,
              icon: "/favicon.ico",
              requireInteraction: true
            });
            notifiedTasksRef.current.add(t.id);
          }
        });
      }
    };
    const interval = setInterval(checkReminders, 30000); 
    return () => clearInterval(interval);
  }, [isAuthenticated, tasks]);

  if (isCheckingAuth) {
    return (
      <div className="loading-screen">
        <div style={{ textAlign: 'center' }}>
          <p>Caricamento... ☕</p>
          <p style={{ fontSize: '12px', color: '#888', marginTop: '10px' }}>Il primo accesso può richiedere fino a 30 secondi.</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) return <Login onLoginSuccess={() => setIsAuthenticated(true)} />;

  const handleLogout = () => {
    logout();
    setIsAuthenticated(false);
  };

  const toggleTaskDone = (day, taskId, taskText) => {
    const newTasks = { ...tasks };
    if (!newTasks[day]) return;
    const idx = newTasks[day].findIndex(t => (t.id ? t.id === taskId : (t.text === taskText || t.task === taskText)));
    if (idx === -1) return;
    newTasks[day] = [...newTasks[day]];
    newTasks[day][idx] = { ...newTasks[day][idx], done: !newTasks[day][idx].done };
    setTasks(newTasks);
    updateTasks(newTasks);
  };

  const deleteTask = (day, taskId, taskText) => {
    const newTasks = { ...tasks };
    if (!newTasks[day]) return;
    const idx = newTasks[day].findIndex(t => (t.id ? t.id === taskId : (t.text === taskText || t.task === taskText)));
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
    const idx = newTasks[day].findIndex(t => (t.id ? t.id === taskId : (t.text === oldText || t.task === oldText)));
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

  const moveTaskToDay = async (taskId, targetDay) => {
    const newTasks = { ...tasks };
    if (!newTasks["Backlog"]) return;
    const idx = newTasks["Backlog"].findIndex(t => t.id === taskId);
    if (idx === -1) return;
    const taskToMove = { ...newTasks["Backlog"].splice(idx, 1)[0], done: false };
    if (!newTasks[targetDay]) newTasks[targetDay] = [];
    newTasks[targetDay].push(taskToMove);
    setTasks(newTasks);
    await updateTasks(newTasks);
    setMovingTaskId(null);
  };

  const handleAddTask = () => {
    if (newTask.trim() === "") {
      setShowInput(false);
      setNewTask("");
      return;
    }
    const newId = Date.now().toString();
    const timeToSet = parseTime(newTask);
    const cleanedText = stripTime(newTask);
    const updatedTasks = {
      ...tasks,
      Backlog: [
        { id: newId, text: cleanedText, task: cleanedText, done: false, time: timeToSet },
        ...(tasks["Backlog"] || [])
      ]
    };
    setTasks(updatedTasks);
    setNewTask("");
    setShowInput(false);
    updateTasks(updatedTasks);
  };

  const handleAddTaskToDay = async (day) => {
    if (inlineDayTask.trim() === "") {
      setAddingToDay(null);
      return;
    }
    const timeToSet = parseTime(inlineDayTask);
    const cleanedText = stripTime(inlineDayTask);
    const newTaskObj = {
      id: `task-${day}-${Date.now()}`,
      text: cleanedText,
      done: false,
      time: timeToSet
    };
    const newTasks = { ...tasks };
    if (!newTasks[day]) newTasks[day] = [];
    newTasks[day].push(newTaskObj);
    setTasks(newTasks);
    setAddingToDay(null);
    setInlineDayTask("");
    await updateTasks(newTasks);
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
    const ae = event.activatorEvent;
    let x = 0;
    if (ae?.touches && ae.touches.length > 0) x = ae.touches[0].clientX;
    else if (ae?.clientX !== undefined) x = ae.clientX;
    dragStartX.current = x;
    const { active } = event;
    let foundTask = null;
    let foundDay = null;
    Object.keys(tasks).forEach(day => {
      const t = tasks[day].find(item => String(item.id || item.text || item.task) === String(active.id));
      if (t) {
        foundTask = t;
        foundDay = day;
      }
    });
    if (foundTask) {
      setActiveTask({ ...foundTask, currentDay: foundDay });
      setIsDraggingFromBacklog(foundDay === "Backlog");
      setDraggingEdge(null);
      activeEdgeRef.current = null;
      if (weekTimerRef.current) clearTimeout(weekTimerRef.current);
    }
  };

  const handleDragMove = (event) => {
    if (!ENABLE_WEEK_EDGE_DRAG) return;
    const { over } = event;
    let edge = null;
    if (over?.id === 'prev-week-btn' || over?.id === 'edge-left') edge = 'left';
    else if (over?.id === 'next-week-btn' || over?.id === 'edge-right') edge = 'right';
    if (edge !== activeEdgeRef.current) {
      if (weekTimerRef.current) clearTimeout(weekTimerRef.current);
      activeEdgeRef.current = edge;
      setDraggingEdge(edge);
      if (edge) {
        weekTimerRef.current = setTimeout(() => {
          if (activeEdgeRef.current === 'left') prevWeek();
          else if (activeEdgeRef.current === 'right') nextWeek();
          setDraggingEdge(null);
          activeEdgeRef.current = null;
        }, EDGE_TIMEOUT);
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
    if (weekTimerRef.current) clearTimeout(weekTimerRef.current);
    activeEdgeRef.current = null;
    dragStartX.current = null;
    const { active, over } = event;
    const activeId = active.id;
    const finishDrag = (shouldCloseMenu = true) => {
      setActiveTask(null);
      setIsDraggingFromBacklog(false);
      setDraggingEdge(null);
      activeEdgeRef.current = null;
      if (shouldCloseMenu && showArchiveModal) setShowArchiveModal(false);
    };
    if (!over) {
      finishDrag(false); 
      return;
    }
    const overId = over.id;
    if (overId === "trash-zone") {
      const updatedTasks = { ...tasks };
      let foundT = null;
      for (const key of Object.keys(updatedTasks)) {
        const idx = (updatedTasks[key] || []).findIndex(t => String(t.id || t.text || t.task) === String(activeId));
        if (idx !== -1) {
          const newList = [...updatedTasks[key]];
          foundT = newList.splice(idx, 1)[0];
          updatedTasks[key] = newList;
          break;
        }
      }
      if (foundT) {
        const trashList = [...(updatedTasks["Trash"] || [])];
        trashList.push({ ...foundT, done: false });
        updatedTasks["Trash"] = trashList;
        setTasks(updatedTasks);
        updateTasks(updatedTasks);
      }
      finishDrag(true);
      return;
    }
    if (overId === "archive-zone" || overId === "Backlog" || String(overId).startsWith("Backlog-col-")) {
      if (activeTask && activeTask.currentDay === "Backlog") {
        finishDrag(false); 
        return;
      }
      const updatedTasks = { ...tasks };
      let foundT = null;
      for (const key of Object.keys(updatedTasks)) {
        const idx = (updatedTasks[key] || []).findIndex(t => String(t.id || t.text || t.task) === String(activeId));
        if (idx !== -1) {
          const newList = [...updatedTasks[key]];
          foundT = newList.splice(idx, 1)[0];
          updatedTasks[key] = newList;
          break;
        }
      }
      if (foundT) {
        const backlogList = [...(updatedTasks["Backlog"] || [])];
        if (!backlogList.find(t => String(t.id || t.text || t.task) === String(activeId))) {
          backlogList.push({ ...foundT, done: false });
        }
        updatedTasks["Backlog"] = backlogList;
        setTasks(updatedTasks);
        updateTasks(updatedTasks);
      }
      finishDrag(false);
      return;
    }
    let activeContainer = null;
    let activeIndex = -1;
    let foundTaskObj = null;
    Object.keys(tasks).forEach(key => {
      const idx = (tasks[key] || []).findIndex(t => String(t.id || t.text || t.task) === String(activeId));
      if (idx !== -1) {
        activeContainer = key;
        activeIndex = idx;
        foundTaskObj = tasks[key][idx];
      }
    });
    if (!activeContainer || !foundTaskObj) {
      finishDrag(false);
      return;
    }
    let overContainer = overId;
    let overIndex = -1;
    Object.keys(tasks).forEach(key => {
      const idx = (tasks[key] || []).findIndex(t => String(t.id || t.text || t.task) === String(overId));
      if (idx !== -1) {
        overContainer = key;
        overIndex = idx;
      }
    });
    if (String(overId).startsWith("Backlog-col-") || overId === "Backlog") {
      overContainer = "Backlog";
      if (overIndex === -1) overIndex = (tasks["Backlog"] || []).length;
    }
    const isValidDest = days.includes(overContainer) || overContainer === "Backlog";
    if (!isValidDest) {
      finishDrag(false);
      return;
    }
    const updatedTasks = { ...tasks };
    if (activeContainer === overContainer) {
      if (activeIndex !== overIndex && overIndex !== -1) {
        updatedTasks[activeContainer] = arrayMove(tasks[activeContainer], activeIndex, overIndex);
      } else {
        finishDrag(false);
        return;
      }
    } else {
      const sourceList = [...(updatedTasks[activeContainer] || [])];
      sourceList.splice(activeIndex, 1);
      updatedTasks[activeContainer] = sourceList;
      const destList = [...(updatedTasks[overContainer] || [])];
      const newTaskObj = { ...foundTaskObj };
      if (overIndex === -1) destList.push(newTaskObj);
      else destList.splice(overIndex, 0, newTaskObj);
      updatedTasks[overContainer] = destList;
    }
    setTasks(updatedTasks);
    updateTasks(updatedTasks);
    finishDrag(overContainer !== "Backlog");
  };

  const columns = [[], [], []];
  tasks["Backlog"]?.forEach((task, index) => {
    const colIdx = index % 3;
    columns[colIdx].push(task);
  });

  const customCollisionDetection = (args) => {
    const collisions = pointerWithin(args);
    if (collisions.length > 0) return collisions;
    return rectIntersection(args);
  };

  return (
    <div className={`app-container ${draggingEdge ? `edge-active-${draggingEdge}` : ""}`} >
      <DroppableContainer id="edge-left" className="edge-drop-zone left" />
      <DroppableContainer id="edge-right" className="edge-drop-zone right" />
      {isMobile && (
        <div className="mobile-top-nav">
          <span className="mobile-title">Calendario 🗓️</span>
          <div className="mobile-nav-controls">
            <DroppableContainer id="prev-week-btn" className="mobile-nav-btn-wrapper" onClick={prevWeek}>
              <button style={{ pointerEvents: 'none' }}>←</button>
            </DroppableContainer>
            <DroppableContainer id="next-week-btn" className="mobile-nav-btn-wrapper" onClick={nextWeek}>
              <button style={{ pointerEvents: 'none' }}>→</button>
            </DroppableContainer>
            <button className="logout-btn" onClick={handleLogout} title="Logout">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
            </button>
          </div>
        </div>
      )}
      <DndContext 
        sensors={sensors} 
        onDragStart={handleDragStart}
        onDragMove={handleDragMove}
        onDragEnd={handleDragEnd}
        collisionDetection={customCollisionDetection}
        measuring={{ droppable: { strategy: MeasuringStrategy.WhileDragging } }}
      >
        <div className="main-layout">
          <div className="calendar-section">
            <div className="week-container" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
              {days.map((day, i) => {
                const isToday = day === getTodayString();
                return (
                  <div key={i} className={`day-column-wrapper ${isToday ? 'is-today-wrapper' : ''}`}>
                    <DroppableContainer className={`day-column ${isToday ? 'is-today' : ''}`} id={day}>
                      <div className="day-header-wrapper">
                        <h3 className={isToday ? "today-header" : ""}>{day}</h3>
                      </div>
                      <div className="column-scroll-area" onDoubleClick={() => { setAddingToDay(day); setInlineDayTask(""); }}>
                        <SortableContext items={tasks[day] || []} strategy={verticalListSortingStrategy}>
                          {tasks[day]?.map((t) => (
                            <TaskItem key={t.id || t.task} task={t} toggleDone={() => toggleTaskDone(day, t.id, t.text || t.task)} editTaskText={(newText) => editTaskText(day, t.id, t.text || t.task, newText)} />
                          ))}
                        </SortableContext>
                        {addingToDay === day && (
                          <div className="inline-day-input-wrapper" onPointerDown={(e) => e.stopPropagation()}>
                            <textarea className="inline-day-textarea" placeholder="Cosa devi fare?" value={inlineDayTask} autoFocus rows={2} onChange={(e) => { setInlineDayTask(e.target.value); }} onBlur={() => handleAddTaskToDay(day)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAddTaskToDay(day); } if (e.key === 'Escape') { setAddingToDay(null); setInlineDayTask(""); } }} />
                          </div>
                        )}
                        <div className="add-task-click-area"></div>
                      </div>
                    </DroppableContainer>
                  </div>
                );
              })}
              {isMobile && (
                <div className="day-column mobile-backlog-column">
                  <h3>MENU AZIONI 📓</h3>
                  <div className="mobile-action-center">
                    <DroppableContainer id="archive-zone" className="action-btn-circ-wrapper" onClick={() => setShowArchiveModal(true)}>
                      <button className="action-btn-circ archive" title="Archivio" style={{ pointerEvents: "none" }}><span className="icon">📝 </span></button>
                    </DroppableContainer>
                    <DroppableContainer id="trash-zone" className="action-btn-circ-wrapper" onClick={() => setShowTrashModal(true)}>
                      <button className="action-btn-circ trash" title="Cestino" style={{ pointerEvents: "none" }}><span className="icon">🗑️</span></button>
                    </DroppableContainer>
                  </div>
                </div>
              )}
            </div>
          </div>
          {!isMobile && (
            <div className="backlog-sidebar">
              <div className="backlog-header">
                <div className="left-group">
                  <h2 className="backlog-title">Attività 📓</h2>
                  <button className="add-task-btn" onClick={() => setShowInput(true)}>➕</button>
                  <DroppableContainer id="trash-zone" className="trash-drop-zone" title="Trascina qui per eliminare" onClick={() => setShowTrashModal(true)}>
                    <button className="action-btn-circ trash" title="Cestino">🗑️</button>
                  </DroppableContainer>
                </div>
                <div className="week-nav-buttons">
                  <DroppableContainer id="prev-week-btn" className="nav-drop-zone" onClick={prevWeek}><button className="nav-btn">←</button></DroppableContainer>
                  <DroppableContainer id="next-week-btn" className="nav-drop-zone" onClick={nextWeek}><button className="nav-btn">→</button></DroppableContainer>
                  <button className="logout-btn" onClick={handleLogout} title="Logout">🚪</button>
                </div>
              </div>
              <div className="backlog-columns">
                {[0, 1, 2].map((colIdx) => (
                  <DroppableContainer key={`Backlog-col-${colIdx}`} className="activity-column" id={`Backlog-col-${colIdx}`}>
                    {colIdx === 0 && showInput && (
                      <div className="input-with-feedback">
                        <textarea className="task-input" placeholder="Inserisci task..." value={newTask} autoFocus onChange={(e) => { setNewTask(e.target.value); }} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleAddTask(); } }} />
                      </div>
                    )}
                    <SortableContext items={columns[colIdx] || []} strategy={verticalListSortingStrategy}>
                      {columns[colIdx].map((t) => (
                        <TaskItem key={t.id || t.task} task={t} toggleDone={() => toggleTaskDone("Backlog", t.id, t.text || t.task)} editTaskText={(newText) => editTaskText("Backlog", t.id, t.text || t.task, newText)} />
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
            <div className="task-item-dragging-visual"><span>{activeTask.text || activeTask.task}</span></div>
          ) : null}
        </DragOverlay>
        {showTrashModal && (
          <div className="modal-overlay" onClick={() => setShowTrashModal(false)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <h2>Cestino 🗑️</h2>
              <div className="trash-items-list">
                {(tasks["Trash"] || []).map((t, idx) => (
                  <div key={t.id || idx} className="trash-item-row"><span>{t.text || t.task}</span><button onClick={() => restoreTask(t.id)}>Ripristina</button></div>
                ))}
              </div>
              <button className="empty-trash-btn" onClick={emptyTrash}>Svuota</button>
            </div>
          </div>
        )}
        {showArchiveModal && (
          <div className="archive-modal-overlay" onClick={() => setShowArchiveModal(false)}>
            <div className="archive-modal-content" onClick={(e) => e.stopPropagation()}>
              <h2>Azioni & Archivio 📋</h2>
              <DroppableContainer id="Backlog" className="archive-drop-zone">
                <SortableContext items={tasks["Backlog"] || []} strategy={rectSortingStrategy}>
                  <div className="archive-grid">
                    {(tasks["Backlog"] || []).map((t) => (
                      <TaskItem key={t.id || t.text || t.task} task={t} toggleDone={() => toggleTaskDone("Backlog", t.id, t.text || t.task)} editTaskText={(newText) => editTaskText("Backlog", t.id, t.text || t.task, newText)} />
                    ))}
                  </div>
                </SortableContext>
              </DroppableContainer>
            </div>
          </div>
        )}
      </DndContext>
      {draggingEdge === 'left' && <div className="week-portal left active"><span>PRECEDENTE</span></div>}
      {draggingEdge === 'right' && <div className="week-portal right active"><span>SUCCESSIVA</span></div>}
    </div>
  );
}

export default App;
