// BUILD_TEST_12345
import './App.css';
import { useEffect, useState, useRef } from "react";
import { createPortal } from "react-dom";
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
  rectSortingStrategy,
  arrayMove 
} from "@dnd-kit/sortable";
import DroppableContainer from "./DroppableContainer";
import Login from "./Login";

const API_BASE_URL = window.location.origin === 'http://localhost:5173' 
  ? 'http://localhost:8088' 
  : window.location.origin;

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
  const [showArchiveModal, setShowArchiveModal] = useState(false);
  const [movingTaskId, setMovingTaskId] = useState(null);
  const [isDraggingFromBacklog, setIsDraggingFromBacklog] = useState(false);
  const [draggingEdge, setDraggingEdge] = useState(null); // 'left' | 'right' | null
  const [addingToDay, setAddingToDay] = useState(null); // which day column is open for inline add
  const [inlineDayTask, setInlineDayTask] = useState(""); // text in the inline input
  const [newTaskTime, setNewTaskTime] = useState(""); // time for the new task being added
  const notifiedTasksRef = useRef(new Set()); // To avoid multiple notifications for same task
  
  // FUNZIONE PER ESTRARRE L'ORARIO AUTOMATICAMENTE
  const parseTime = (text) => {
    if (!text) return null;
    
    // Pattern 1: HH:MM o HH.MM o HH MM (ovunque nel testo)
    const timeMatch = text.match(/\b([01]?\d|2[0-3])[:. ]([0-5]\d)\b/);
    if (timeMatch) return `${timeMatch[1].padStart(2, '0')}:${timeMatch[2]}`;
    
    // Pattern 2: Solo un numero 0-23 alla FINE (es: "Meeting 15")
    const hourEndMatch = text.match(/\b([01]?\d|2[0-3])\b\s*$/);
    if (hourEndMatch) return `${hourEndMatch[1].padStart(2, '0')}:00`;

    // Pattern 3: Solo un numero 0-23 all'INIZIO (es: "15 Barbiere")
    const hourStartMatch = text.match(/^\s*\b([01]?\d|2[0-3])\b/);
    if (hourStartMatch) return `${hourStartMatch[1].padStart(2, '0')}:00`;
    
    return null;
  };

  // FUNZIONE PER PULIRE IL TESTO DALL'ORARIO
  const stripTime = (text) => {
    if (!text) return "";
    let cleaned = text;
    // Rimuove HH:MM, HH.MM, HH MM
    cleaned = cleaned.replace(/\b([01]?\d|2[0-3])[:. ]([0-5]\d)\b/g, "");
    // Rimuove solo un numero 0-23 alla FINE
    cleaned = cleaned.replace(/\b([01]?\d|2[0-3])\b\s*$/, "");
    // Rimuove solo un numero 0-23 all'INIZIO
    cleaned = cleaned.replace(/^\s*\b([01]?\d|2[0-3])\b/g, "");
    return cleaned.trim();
  };

  const [detectedTime, setDetectedTime] = useState(null);
  
  const [pushStatus, setPushStatus] = useState('pending'); // pending, granted, denied, error

  // REGISTRAZIONE PUSH NOTIFICATIONS
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
  
  const lastWeekChangeRef = useRef(0);
  const activeEdgeRef = useRef(null);
  const weekTimerRef = useRef(null);
  const touchStartX = useRef(null);
  const touchStartY = useRef(null);
  const edgeTimerRef = useRef(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 10 },
    })
  );

  useEffect(() => {
    async function initAuth() {
      // Diamo un respiro al sistema prima di decidere
      try {
        const isOk = await checkAuth();
        setIsAuthenticated(isOk);
      } catch (e) {
        setIsAuthenticated(false);
      } finally {
        // Un piccolo ritardo extra per far stabilizzare l'UI
        setTimeout(() => {
          setIsCheckingAuth(false);
        }, 500);
      }
    }
    initAuth();

    const handleResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      subscribeToPush();
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (isAuthenticated) {
      setDays(getWeekDates(weekStart));
    }
  }, [weekStart, isAuthenticated]);

  useEffect(() => {
    if (isAuthenticated) {
      async function fetchTasks() {
        const data = await getTasks();
        const normalized = {};
        Object.keys(data).forEach(day => {
          normalized[day] = data[day].map((t, i) => ({
            ...t,
            // ID univoco garantito: priorità a quello del DB, altrimenti ne creiamo uno atomico
            id: String(t.id || `task-${day}-${i}-${t.task}-${Date.now()}`)
          }));
        });
        setTasks(normalized);
      }
      fetchTasks();
    }
  }, [isAuthenticated]);

  // --- LOGICA SVEGLIA (NOTIFICHE) ---
  useEffect(() => {
    if (!isAuthenticated) return;

    // Chiedi permesso per le notifiche
    if (Notification.permission === "default") {
      Notification.requestPermission();
    }

    const checkReminders = () => {
      const now = new Date();
      const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      const todayStr = getTodayString();

      if (tasks[todayStr]) {
        tasks[todayStr].forEach(t => {
          if (!t.done && t.time === currentTime && !notifiedTasksRef.current.has(t.id)) {
            new Notification("PROMEMORIA AGENTA 🚀", {
              body: `È l'ora di: ${t.text || t.task}`,
              icon: "/favicon.ico",
              requireInteraction: true // La notifica resta finché non la chiudi
            });
            notifiedTasksRef.current.add(t.id);
          }
        });
      }
    };

    const interval = setInterval(checkReminders, 30000); // Controlla ogni 30 secondi
    return () => clearInterval(interval);
  }, [isAuthenticated, tasks]);

  if (isCheckingAuth) {
    return (
      <div className="loading-screen">
        <div style={{ textAlign: 'center' }}>
          <p>Svegliando l'agenda... ☕</p>
          <p style={{ fontSize: '12px', color: '#888', marginTop: '10px' }}>Il primo accesso può richiedere fino a 30 secondi.</p>
        </div>
      </div>
    );
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
      setDetectedTime(null);
      return;
    }
    const cleanedText = stripTime(newTask);
    const newId = `new-${Date.now()}-${cleanedText.substring(0, 10)}`;
    const timeToSet = detectedTime || parseTime(newTask);
    
    const updatedTasks = {
      ...tasks,
      Backlog: [
        { id: newId, text: cleanedText, task: cleanedText, done: false, time: timeToSet },
        ...(tasks["Backlog"] || [])
      ]
    };
    setTasks(updatedTasks);
    setNewTask("");
    setDetectedTime(null);
    setShowInput(false);
    updateTasks(updatedTasks);
  };

  const handleAddTaskToDay = async (day) => {
    if (inlineDayTask.trim() === "") {
      setAddingToDay(null);
      setDetectedTime(null);
      return;
    }
    
    const timeToSet = detectedTime || parseTime(inlineDayTask);
    const cleanedText = stripTime(inlineDayTask); // Puliamo il testo!
    
    const newTaskObj = {
      id: `task-${day}-${Date.now()}`,
      task: cleanedText,
      done: false,
      time: timeToSet
    };
    
    const newTasks = { ...tasks };
    if (!newTasks[day]) newTasks[day] = [];
    newTasks[day].push(newTaskObj);
    setTasks(newTasks);
    setAddingToDay(null);
    setInlineDayTask("");
    setDetectedTime(null);
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
    const { active } = event;
    let foundTask = null;
    let foundDay = null;
    
    Object.keys(tasks).forEach(day => {
      const t = tasks[day].find(item => String(item.id || item.task) === String(active.id));
      if (t) {
        foundTask = t;
        foundDay = day;
      }
    });
    if (foundTask) {
      setActiveTask({ ...foundTask, currentDay: foundDay });
      setIsDraggingFromBacklog(foundDay === "Backlog");
      // Reset edge tracking on start
      setDraggingEdge(null);
      activeEdgeRef.current = null;
      if (weekTimerRef.current) clearTimeout(weekTimerRef.current);
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

  const handleDragMove = (event) => {
    const { delta, active, over } = event;
    if (!active) return;

    // 1. Gestione dei Portali Droppable (Frecce esistenti)
    const overId = over?.id;
    let currentEdge = null;
    if (overId === 'prev-week-btn') currentEdge = 'left';
    else if (overId === 'next-week-btn') currentEdge = 'right';

    // 2. Gestione Trascinamento ai Bordi (Nuova funzione)
    const pointerX = (event.activatorEvent?.clientX || (event.activatorEvent?.touches && event.activatorEvent.touches[0].clientX) || 0) + (delta?.x || 0);
    const threshold = 40; 
    const screenWidth = window.innerWidth;

    if (pointerX < threshold || currentEdge === 'left') {
      const targetEdge = 'left';
      if (draggingEdge !== targetEdge) {
        setDraggingEdge(targetEdge);
        clearTimeout(edgeTimerRef.current);
        edgeTimerRef.current = setTimeout(() => {
          prevWeek();
          setDraggingEdge(null);
        }, 1000); 
      }
    } else if (pointerX > screenWidth - threshold || currentEdge === 'right') {
      const targetEdge = 'right';
      if (draggingEdge !== targetEdge) {
        setDraggingEdge(targetEdge);
        clearTimeout(edgeTimerRef.current);
        edgeTimerRef.current = setTimeout(() => {
          nextWeek();
          setDraggingEdge(null);
        }, 1000);
      }
    } else {
      if (draggingEdge) {
        setDraggingEdge(null);
        clearTimeout(edgeTimerRef.current);
      }
    }
  };

  const handleDragEnd = async (event) => {
    setDraggingEdge(null);
    clearTimeout(edgeTimerRef.current);
    setActiveTask(null);
    setIsDraggingFromBacklog(false);
    
    const { active, over } = event;
    if (!over) return;

    const activeId = active.id;
    const overId = over.id;

    // Handle Drop on Trash
    if (overId === "trash-zone") {
      const newTasks = { ...tasks };
      let foundTask = null;
      let sourceDay = null;

      Object.keys(newTasks).forEach(day => {
        const idx = newTasks[day].findIndex(t => String(t.id || t.task) === String(activeId));
        if (idx !== -1) {
          foundTask = newTasks[day].splice(idx, 1)[0];
          sourceDay = day;
        }
      });

      if (foundTask) {
        if (!newTasks["Trash"]) newTasks["Trash"] = [];
        newTasks["Trash"].push({ ...foundTask, done: false });
        setTasks(newTasks);
        updateTasks(newTasks);
      }
      return;
    }

    // Handle Drop on Archive (Backlog)
    if (overId === "archive-zone") {
      const newTasks = { ...tasks };
      let foundTask = null;
      let sourceDay = null;

      Object.keys(newTasks).forEach(day => {
        const idx = newTasks[day].findIndex(t => String(t.id || t.task) === String(activeId));
        if (idx !== -1) {
          foundTask = newTasks[day].splice(idx, 1)[0];
          sourceDay = day;
        }
      });

      if (foundTask && sourceDay !== "Backlog") {
        if (!newTasks["Backlog"]) newTasks["Backlog"] = [];
        newTasks["Backlog"].push({ ...foundTask, done: false });
        setTasks(newTasks);
        updateTasks(newTasks);
      }
      return;
    }

    let activeContainer = null;
    let activeIndex = -1;
    let foundTask = null;

    Object.keys(tasks).forEach(key => {
      const idx = (tasks[key] || []).findIndex(t => String(t.id || t.task) === String(activeId));
      if (idx !== -1) {
        activeContainer = key;
        activeIndex = idx;
        foundTask = tasks[key][idx];
      }
    });

    if (!activeContainer || !foundTask) return;


    let overContainer = overId;
    let overIndex = -1;

    Object.keys(tasks).forEach(key => {
      const idx = (tasks[key] || []).findIndex(t => String(t.id || t.task) === String(overId));
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
    
    // Cleanup edge tracking
    setDraggingEdge(null);
    activeEdgeRef.current = null;
    if (weekTimerRef.current) clearTimeout(weekTimerRef.current);

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
    const { active, droppableContainers } = args;
    if (!active) return [];

    if (isDraggingFromBacklog) {
      // Prioritize Day columns, Action zones, and its own Backlog container
      const filteredTargets = droppableContainers.filter(c => 
        days.includes(c.id) || c.id === "trash-zone" || c.id === "archive-zone" || c.id === "Backlog"
      );
      
      const collisions = pointerWithin({
        ...args,
        droppableContainers: filteredTargets
      });

      if (collisions.length > 0) return collisions;
      
      // Rect intersection as a fallback only for the filtered targets
      return rectIntersection({
        ...args,
        droppableContainers: filteredTargets
      });
    }

    const pointerCollisions = pointerWithin(args);
    if (pointerCollisions.length > 0) {
      // Prioritize Trash and Archive Zones
      const trash = pointerCollisions.find(c => c.id === "trash-zone");
      if (trash) return [trash];
      const archive = pointerCollisions.find(c => c.id === "archive-zone");
      if (archive) return [archive];

      // If dragging FROM archive, prioritize days
      if (activeTask && activeTask.currentDay === "Backlog") {
        const day = pointerCollisions.find(c => days.includes(c.id));
        if (day) return [day];
      }
      return pointerCollisions;
    }

    // Fallback to rectIntersection only if pointer is not over anything
    return rectIntersection(args);
  };

  return (
    <div className={`app-container ${draggingEdge ? `edge-active-${draggingEdge}` : ""}`}>
      {isMobile && (
        <div className="mobile-top-nav">
          <h1 className="mobile-title">Agenda</h1>
          <div className="mobile-nav-controls">
            <button onClick={prevWeek}>←</button>
            <span className="mobile-week-indicator">Sett. {getWeekNumber(currentDate)}</span>
            <button onClick={nextWeek}>→</button>
          </div>
        </div>
      )}

      <DndContext 
        sensors={sensors} 
        onDragStart={handleDragStart}
        onDragMove={handleDragMove}
        onDragEnd={handleDragEnd}
        collisionDetection={customCollisionDetection}
        measuring={{ 
          droppable: { 
            strategy: MeasuringStrategy.WhileDragging 
          } 
        }}
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
                  <div key={i} className={`day-column-wrapper ${isToday ? 'is-today-wrapper' : ''}`}>
                    <DroppableContainer 
                      className={`day-column ${isToday ? 'is-today' : ''}`} 
                      id={day}
                    >
                      <h3 className={isToday ? "today-header" : ""}>{day}</h3>
                      <div 
                        className="column-scroll-area" 
                        style={{ flex: 1, display: 'flex', flexDirection: 'column' }}
                        onDoubleClick={() => {
                          setAddingToDay(day);
                          setInlineDayTask("");
                          setDetectedTime(null);
                        }}
                      >
                        <SortableContext 
                          items={tasks[day]?.map(t => String(t.id || t.task)) || []} 
                          strategy={verticalListSortingStrategy}
                        >
                          {tasks[day]?.map((t) => (
                            <TaskItem
                              key={String(t.id || t.task)}
                              task={t}
                              toggleDone={() => toggleTaskDone(day, t.id, t.text || t.task)}
                              editTaskText={(newText) => editTaskText(day, t.id, t.text || t.task, newText)}
                            />
                          ))}
                        </SortableContext>

                        {/* Il box d'inserimento ora appare QUI, subito dopo l'ultimo task */}
                        {addingToDay === day && (
                          <div className="inline-day-input-wrapper" onPointerDown={(e) => e.stopPropagation()}>
                            <textarea
                              className="inline-day-textarea"
                              placeholder="Cosa devi fare?"
                              value={inlineDayTask}
                              autoFocus
                              rows={2}
                              onChange={(e) => {
                                setInlineDayTask(e.target.value);
                                setDetectedTime(parseTime(e.target.value));
                              }}
                              onBlur={() => handleAddTaskToDay(day)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                  e.preventDefault();
                                  handleAddTaskToDay(day);
                                }
                                if (e.key === 'Escape') {
                                  setAddingToDay(null);
                                  setInlineDayTask("");
                                  setDetectedTime(null);
                                }
                              }}
                            />
                            {detectedTime && (
                              <div className="time-feedback-badge mini">
                                ⏰ {detectedTime}
                              </div>
                            )}
                          </div>
                        )}
                        
                        {/* L'area cliccabile vuota serve solo a riempire il resto della colonna */}
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
                      <button className="action-btn-circ archive" title="Archivio" style={{ pointerEvents: "none" }}>
                        <span className="icon">📝 </span>
                      </button>
                    </DroppableContainer>

                    <DroppableContainer id="trash-zone" className="action-btn-circ-wrapper" onClick={() => setShowTrashModal(true)}>
                      <button className="action-btn-circ trash" title="Cestino" style={{ pointerEvents: "none" }}>
                        <span className="icon">🗑️</span>
                      </button>
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
                  <DroppableContainer 
                    id="prev-week-btn" 
                    className="nav-drop-zone"
                    onClick={prevWeek}
                  >
                    <button className="nav-btn">←</button>
                  </DroppableContainer>
                  <DroppableContainer 
                    id="next-week-btn" 
                    className="nav-drop-zone"
                    onClick={nextWeek}
                  >
                    <button className="nav-btn">→</button>
                  </DroppableContainer>

                  <button 
                    className={`nav-status-btn ${pushStatus}`}
                    onClick={subscribeToPush}
                    title={`Stato Notifiche: ${pushStatus}`}
                    style={{ marginRight: '10px' }}
                  >
                    {pushStatus === 'granted' ? '🔔' : pushStatus === 'denied' ? '🔕' : '⏳'}
                  </button>
                </div>
              </div>
              <div className="backlog-columns">
                {[0, 1, 2].map((colIdx) => (
                  <DroppableContainer key={`Backlog-col-${colIdx}`} className="activity-column" id={`Backlog-col-${colIdx}`}>
                    {colIdx === 0 && showInput && (
                      <div className="input-with-feedback">
                        <textarea
                          className="task-input"
                          placeholder="Inserisci task..."
                          value={newTask}
                          autoFocus
                          onChange={(e) => {
                            setNewTask(e.target.value);
                            setDetectedTime(parseTime(e.target.value));
                            e.target.style.height = "auto";
                            e.target.style.height = e.target.scrollHeight + "px";
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) {
                              e.preventDefault();
                              handleAddTask();
                            }
                          }}
                        />
                        {detectedTime && (
                          <div className="time-feedback-badge">
                            ⏰ Promemoria impostato alle {detectedTime}
                          </div>
                        )}
                      </div>
                    )}
                    <SortableContext 
                      items={columns[colIdx].map(t => String(t.id || t.task))} 
                      strategy={verticalListSortingStrategy}
                    >
                      {columns[colIdx].map((t) => (
                        <TaskItem
                          key={String(t.id || t.task)}
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
              className="task-item dragging-mirror" 
              style={{ 
                width: "250px", // Più largo e leggibile
                background: "white",
                opacity: 1,
                cursor: "grabbing", 
                boxShadow: "0 10px 30px rgba(0,0,0,0.3)",
                border: "2px solid #3b82f6",
                borderRadius: "8px",
                padding: "10px",
                fontWeight: "500",
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
               <input type="checkbox" checked={activeTask.done} readOnly />
               <span style={{ fontSize: "14px", color: "#1e293b" }}>{activeTask.text || activeTask.task}</span>
            </div>
          ) : null}
        </DragOverlay>

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
                    <div key={t.id || idx} className="trash-item">
                      <span>{t.text || t.task}</span>
                      <button onClick={() => restoreTask(t.id)}>Ripristina</button>
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

        {showArchiveModal && (
          <div className={activeTask ? "archive-modal-overlay is-dragging" : "archive-modal-overlay"} onClick={() => setShowArchiveModal(false)}>
            <div className="archive-modal-content" onClick={(e) => e.stopPropagation()}>
              <div className="archive-modal-header">
                <h2>Archivio 📋</h2>
                <div className="archive-header-actions">
                  <button className="archive-header-add-btn" onClick={() => setIsQuickAddOpen(true)}>➕</button>
                  <button className="close-modal-btn" onClick={() => setShowArchiveModal(false)}>✖</button>
                </div>
              </div>
              
              <div className="archive-items-list">
                {(!tasks["Backlog"] || tasks["Backlog"].length === 0) ? (
                  <p style={{ textAlign: "center", color: "#888", padding: "20px" }}>Nessuna attività in archivio.</p>
                ) : (
                  <DroppableContainer 
                    id="Backlog" 
                    className="archive-droppable-list"
                  >
                    <SortableContext items={tasks["Backlog"] || []} strategy={rectSortingStrategy}>
                      {tasks["Backlog"].map((t) => (
                        <TaskItem
                          key={t.id || t.task}
                          task={t}
                          toggleDone={() => toggleTaskDone("Backlog", t.id, t.text || t.task)}
                          editTaskText={(newText) => editTaskText("Backlog", t.id, t.text || t.task, newText)}
                        />
                      ))}
                    </SortableContext>
                  </DroppableContainer>
                )}
              </div>
            </div>
          </div>
        )}
      </DndContext>


      {isQuickAddOpen && (
        <div className="modal-overlay" onClick={() => setIsQuickAddOpen(false)}>
          <div className="modal-content glass" onClick={(e) => e.stopPropagation()}>
            <h3>Nuova Attività 📝</h3>
            <textarea
              className="modal-textarea"
              placeholder="Cosa devi fare?"
              value={newTask}
              onChange={(e) => setNewTask(e.target.value)}
              autoFocus
            />
            <div className="time-picker-wrapper" style={{ marginTop: '15px' }}>
              <label style={{ fontSize: '14px', fontWeight: 'bold', color: '#444', display: 'block', marginBottom: '8px' }}>Seleziona Orario ⏰</label>
              <div className="time-wheel-container">
                <div className="time-wheel-center-bar"></div>
                
                {/* ORE */}
                <div 
                  className="time-wheel-column"
                  onScroll={(e) => {
                    const idx = Math.round(e.target.scrollTop / 40);
                    const h = String(idx).padStart(2, '0');
                    const m = newTaskTime.split(':')[1] || "00";
                    setNewTaskTime(`${h}:${m}`);
                  }}
                >
                  <div style={{ height: '40px' }} /> {/* Spacer */}
                  {Array.from({ length: 24 }).map((_, i) => (
                    <div key={i} className={`time-wheel-item ${newTaskTime.startsWith(String(i).padStart(2, '0')) ? 'active' : ''}`}>
                      {String(i).padStart(2, '0')}
                    </div>
                  ))}
                  <div style={{ height: '40px' }} /> {/* Spacer */}
                </div>

                <div style={{ fontWeight: 'bold', fontSize: '1.5rem' }}>:</div>

                {/* MINUTI */}
                <div 
                  className="time-wheel-column"
                  onScroll={(e) => {
                    const idx = Math.round(e.target.scrollTop / 40);
                    const m = String(idx).padStart(2, '0');
                    const h = newTaskTime.split(':')[0] || "00";
                    setNewTaskTime(`${h}:${m}`);
                  }}
                >
                  <div style={{ height: '40px' }} /> {/* Spacer */}
                  {Array.from({ length: 60 }).map((_, i) => (
                    <div key={i} className={`time-wheel-item ${newTaskTime.endsWith(String(i).padStart(2, '0')) ? 'active' : ''}`}>
                      {String(i).padStart(2, '0')}
                    </div>
                  ))}
                  <div style={{ height: '40px' }} /> {/* Spacer */}
                </div>
              </div>
              {newTaskTime && (
                <div style={{ textAlign: 'center', marginTop: '10px', color: '#ff4d4f', fontWeight: 'bold' }}>
                  Scelto: {newTaskTime}
                </div>
              )}
            </div>
            <div className="modal-actions">
              <button className="btn-cancel" onClick={() => { setIsQuickAddOpen(false); setNewTask(""); setNewTaskTime(""); }}>Annulla</button>
              <button className="btn-save" onClick={() => { handleAddTask(); setIsQuickAddOpen(false); }}>Salva</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

export default App;
