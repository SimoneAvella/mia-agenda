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
  // --- STATI PRINCIPALI DELL'APPLICAZIONE ---
  const [isAuthenticated, setIsAuthenticated] = useState(false); // Utente loggato?
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);   // Caricamento iniziale login
  const [weekStart, setWeekStart] = useState(new Date());       // Il Lunedì della settimana visualizzata
  const [days, setDays] = useState([]);                         // Array dei 7 giorni correnti (es. "2023-10-25")
  const [tasks, setTasks] = useState({ Backlog: [] });          // IL DATABASE LOCALE: contiene tutti i task divisi per giorno
  const [showInput, setShowInput] = useState(false);            // Mostra/nasconde il campo "Aggiungi veloce"
  const [isMobile, setIsMobile] = useState(('ontouchstart' in window) || window.innerWidth <= 768);

  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);  // Popup aggiunta rapida
  const [newTask, setNewTask] = useState("");                   // Testo del nuovo task che stai scrivendo
  const [showTrashModal, setShowTrashModal] = useState(false);  // Visibilità del Cestino
  const [activeTask, setActiveTask] = useState(null);           // Il task che stai TRASCINANDO in questo momento
  const [showArchiveModal, setShowArchiveModal] = useState(false); // Visibilità Menu Azioni (Backlog)
  const [movingTaskId, setMovingTaskId] = useState(null);       // Per spostamenti rapidi senza drag
  const [isDraggingFromBacklog, setIsDraggingFromBacklog] = useState(false); // Indica se il drag è partito dal menu
  const [draggingEdge, setDraggingEdge] = useState(null);       // Indica se il task è vicino ai bordi dello schermo (per cambiare settimana)
  const [edgeTimer, setEdgeTimer] = useState(null);             // Timer per il cambio settimana automatico durante il drag
  
  // --- MONITOR DI DEBUG (TEMPORANEO) ---
  const [debugLogs, setDebugLogs] = useState([]);
  const addDebugLog = (msg) => {
    setDebugLogs(prev => [msg, ...prev].slice(0, 5));
    console.log("DEBUG:", msg);
  };
  // --------------------------------------
  
  // --- CONFIGURAZIONE NAVIGAZIONE AI BORDI ---
  const EDGE_TIMEOUT = 1200; // Tempo (in ms) da aspettare sul bordo prima di girare pagina
  const EDGE_THRESHOLD = 80; // Larghezza (in pixel) della zona sensibile ai bordi dello schermo
  // --------------------------------------------

  const [addingToDay, setAddingToDay] = useState(null); // Giorno in cui stiamo aggiungendo un task inline
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

  // --- CONFIGURAZIONE SENSORI (Il cuore del trascinamento) ---
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 }, // Muovi di 8px prima di iniziare il drag (evita drag accidentali al click)
    }),
    useSensor(TouchSensor, {
      // IMPORTANTE PER MOBILE: Aspetta 200ms prima di iniziare il drag.
      // Questo permette di scorrere la pagina (scroll) senza "prendere" i task per sbaglio.
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

    const handleResize = () => {
      const mobile = ('ontouchstart' in window) || window.innerWidth <= 768;
      setIsMobile(mobile);
      if (ENABLE_WEEK_EDGE_DRAG && !mobile) setIsMobile(true);
    };
    window.addEventListener('resize', handleResize);
    handleResize(); // Initial check
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
        // Guaranteed Unique IDs: combine day, text and index to avoid any collision
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
            new Notification("PROMEMORIA AGENDA", {
              body: `È l'ora di: ${t.text || t.task}`,
              icon: "/favicon.ico",
              requireInteraction: true // La notifica resta finché non la chiudi
            });
            notifiedTasksRef.current.add(t.id);
          }
        });
      }
    };

    const interval = setInterval(checkReminders, 30000); 
    return () => clearInterval(interval);
  }, [isAuthenticated, tasks]);

  // --- RECUPERO UNA TANTUM (VERRÀ RIMOSSO SUBITO DOPO) ---
  useEffect(() => {
    if (Object.keys(tasks).length > 0 && tasks["Trash"] && tasks["Trash"].length > 0) {
      const newTasks = { ...tasks };
      if (!newTasks["Backlog"]) newTasks["Backlog"] = [];
      newTasks["Backlog"] = [...newTasks["Backlog"], ...tasks["Trash"]];
      delete newTasks["Trash"];
      setTasks(newTasks);
      updateTasks(newTasks);
      alert("Task recuperati con successo! 📦 Saranno di nuovo nel Menu Azioni.");
    }
  }, [tasks]);
  // ------------------------------------------------------


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
      setDetectedTime(null);
      return;
    }
    const newId = Date.now().toString();
    const timeToSet = detectedTime || parseTime(newTask);
    const cleanedText = stripTime(newTask); // Puliamo il testo!
    
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
    // Correctly handle both Mouse/Pointer events and Touch events
    const ae = event.activatorEvent;
    let x = 0;
    if (ae?.touches && ae.touches.length > 0) {
      x = ae.touches[0].clientX;
    } else if (ae?.clientX !== undefined) {
      x = ae.clientX;
    }
    dragStartX.current = x;
    // Existing logic follows
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
      // Reset edge tracking on start
      setDraggingEdge(null);
      activeEdgeRef.current = null;
      if (weekTimerRef.current) clearTimeout(weekTimerRef.current);
      addDebugLog(`START: ${foundTask.text || foundTask.task} da ${foundDay}`);
    } else {
      addDebugLog(`START: Task non trovato per ID ${active.id}`);
    }
  };

  /**
   * Gestisce il movimento del task durante il trascinamento.
   * Qui controlliamo se il task finisce sopra le frecce o vicino ai bordi dello schermo.
   */
  const handleDragMove = (event) => {
    if (!ENABLE_WEEK_EDGE_DRAG) return;

    const { over } = event;
    let edge = null;

    // 1. Rilevamento tramite ID (se siamo sopra le frecce della testata o le zone invisibili ai bordi)
    if (over?.id === 'prev-week-btn' || over?.id === 'edge-left') edge = 'left';
    else if (over?.id === 'next-week-btn' || over?.id === 'edge-right') edge = 'right';
    
    // 2. Gestione del Timer: se entriamo in un bordo, facciamo partire il conto alla rovescia
    if (edge !== activeEdgeRef.current) {
      // Se cambiamo bordo o usciamo, cancelliamo il timer precedente
      if (weekTimerRef.current) clearTimeout(weekTimerRef.current);
      
      activeEdgeRef.current = edge;
      setDraggingEdge(edge); // Aggiorna lo stato per mostrare l'indicatore blu visivo
      
      if (edge) {
        // Se siamo su un bordo, avviamo il timer per cambiare settimana
        weekTimerRef.current = setTimeout(() => {
          if (activeEdgeRef.current === 'left') prevWeek();
          else if (activeEdgeRef.current === 'right') nextWeek();
          
          // Reset dopo il cambio per evitare scatti multipli
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


  /**
   * FUNZIONE: handleDragEnd
   * Viene eseguita quando RILASCI un task. È qui che avviene lo spostamento effettivo.
   */
  const handleDragEnd = async (event) => {
    // 1. Pulizia timer e bordi (per fermare eventuali cambi settimana automatici)
    if (edgeTimer) clearTimeout(edgeTimer);
    setEdgeTimer(null);
    if (weekTimerRef.current) clearTimeout(weekTimerRef.current);
    activeEdgeRef.current = null;
    dragStartX.current = null;

    const { active, over } = event;
    const activeId = active.id;

    // Funzione interna per resettare lo stato e chiudere o meno il menu
    const finishDrag = (shouldCloseMenu = true) => {
      setActiveTask(null);
      setIsDraggingFromBacklog(false);
      setDraggingEdge(null);
      activeEdgeRef.current = null;
      if (shouldCloseMenu && showArchiveModal) setShowArchiveModal(false);
    };

    // Se rilasciamo nel vuoto (non sopra un giorno o cestino), annulliamo
    if (!over) {
      addDebugLog("Rilascio annullato (fuori zona)");
      finishDrag(false); 
      return;
    }

    const overId = over.id;

    // --- CASO: SPOSTAMENTO NEL CESTINO ---
    if (overId === "trash-zone") {
      const updatedTasks = { ...tasks };
      let foundT = null;
      let sourceKey = null;

      for (const key of Object.keys(updatedTasks)) {
        const idx = (updatedTasks[key] || []).findIndex(t => String(t.id || t.text || t.task) === String(activeId));
        if (idx !== -1) {
          sourceKey = key;
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

    // --- CASO: SPOSTAMENTO NEL MENU AZIONI (BACKLOG) ---
    if (overId === "archive-zone" || overId === "Backlog" || String(overId).startsWith("Backlog-col-") || overId === "mobile-backlog") {
      // Se il task viene già dal Backlog, non facciamo nulla (rimane dov'è)
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
        // Evitiamo duplicati
        if (!backlogList.find(t => String(t.id || t.text || t.task) === String(activeId))) {
          backlogList.push({ ...foundT, done: false });
        }
        updatedTasks["Backlog"] = backlogList;
        setTasks(updatedTasks);
        updateTasks(updatedTasks);
      }
      finishDrag(false); // Teniamo il menu aperto per feedback visivo
      return;
    }

    // --- CASO: SPOSTAMENTO TRA I GIORNI DELLA SETTIMANA ---
    let activeContainer = null;
    let activeIndex = -1;
    let foundTaskObj = null;

    // Cerchiamo dove si trova il task attualmente
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

    // Capiamo su quale giorno/task stiamo rilasciando
    Object.keys(tasks).forEach(key => {
      const idx = (tasks[key] || []).findIndex(t => String(t.id || t.text || t.task) === String(overId));
      if (idx !== -1) {
        overContainer = key;
        overIndex = idx;
      }
    });

    // Se rilasciamo sulle colonne del backlog mentre il menu è aperto
    if (String(overId).startsWith("Backlog-col-") || overId === "mobile-backlog" || overId === "Backlog") {
      overContainer = "Backlog";
      if (overIndex === -1) overIndex = (tasks["Backlog"] || []).length;
    }

    // Se la destinazione non è un giorno valido o il backlog, annulliamo
    const isValidDest = days.includes(overContainer) || overContainer === "Backlog";
    if (!isValidDest) {
      finishDrag(false);
      return;
    }

    const updatedTasks = { ...tasks };
    if (activeContainer === overContainer) {
      // RIORDINAMENTO INTERNO ALLO STESSO GIORNO
      if (activeIndex !== overIndex && overIndex !== -1) {
        updatedTasks[activeContainer] = arrayMove(tasks[activeContainer], activeIndex, overIndex);
      } else {
        finishDrag(false);
        return;
      }
    } else {
      // SPOSTAMENTO REALE TRA GIORNI DIVERSI
      const sourceList = [...(updatedTasks[activeContainer] || [])];
      sourceList.splice(activeIndex, 1);
      updatedTasks[activeContainer] = sourceList;

      const destList = [...(updatedTasks[overContainer] || [])];
      const newTaskObj = { ...foundTaskObj };
      
      if (overIndex === -1) destList.push(newTaskObj); // In fondo alla lista
      else destList.splice(overIndex, 0, newTaskObj); // In una posizione specifica
      
      updatedTasks[overContainer] = destList;
    }

    // --- RETE DI SICUREZZA ---
    // Controlliamo che il task non sia "sparito" per errore logico
    let taskExists = false;
    Object.keys(updatedTasks).forEach(k => {
      if (updatedTasks[k].some(t => String(t.id || t.text || t.task) === String(activeId))) taskExists = true;
    });

    if (!taskExists && foundTaskObj) {
      addDebugLog("SAFETY: Task recuperato automaticamente!");
      updatedTasks[activeContainer] = [...(updatedTasks[activeContainer] || []), foundTaskObj];
    }

    setTasks(updatedTasks);
    updateTasks(updatedTasks); // Salvataggio sul server
    addDebugLog(`END: Spostato in ${overContainer}`);
    finishDrag(overContainer !== "Backlog");
  };

  /**
   * Suddivide i task del backlog in 3 colonne per la visualizzazione.
   */
  const columns = [[], [], []];
  tasks["Backlog"]?.forEach((task, index) => {
    const colIdx = index % 3;
    columns[colIdx].push(task);
  });

  /**
   * MOTORE DI COLLISIONE PERSONALIZZATO
   * È il "cervello" che decide quale elemento viene colpito durante il trascinamento.
   */
  const customCollisionDetection = (args) => {
    const { active, droppableContainers } = args;
    if (!active) return [];

    // --- LO SCUDO DEL MENU ---
    // Se il Menu Azioni è aperto, forziamo il sistema a vedere SOLO il menu
    // Questo evita che il task venga rilasciato per errore su un giorno che sta "sotto"
    if (showArchiveModal) {
      const modalTargets = droppableContainers.filter(c => 
        c.id === 'Backlog' || c.id === 'trash-zone' || String(c.id).startsWith('Backlog-col-')
      );
      const modalCollisions = pointerWithin({ ...args, droppableContainers: modalTargets });
      if (modalCollisions.length > 0) return modalCollisions;
      
      return []; // Se non tocca nulla nel menu, non toccare nulla fuori
    }

    // 1. Rilevamento elementi di sistema (Cestino, Pulsanti Navigazione, Bordi Schermo)
    const pointerCollisions = pointerWithin(args);
    const rectCollisions = rectIntersection(args);
    const allCollisions = [...pointerCollisions, ...rectCollisions];

    const systemCollision = allCollisions.find(c => 
      c.id === 'trash-zone' || c.id === 'archive-zone' || 
      c.id === 'prev-week-btn' || c.id === 'next-week-btn' ||
      c.id === 'edge-left' || c.id === 'edge-right'
    );
    if (systemCollision) return [systemCollision];

    // 2. Se trasciniamo dal Backlog verso l'esterno, cerchiamo i Giorni della settimana
    if (isDraggingFromBacklog) {
      const dayCollision = allCollisions.find(c => days.includes(c.id));
      if (dayCollision) return [dayCollision];
    }

    // 3. Comportamento standard: restituisce le collisioni rilevate dal puntatore
    if (pointerCollisions.length > 0) return pointerCollisions;
    return rectIntersection(args);
  };

  return (
    <div className={`app-container ${draggingEdge ? `edge-active-${draggingEdge}` : ""}`} >
      {/* Visible Droppable Edges */}
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
                  >
                    {pushStatus === 'granted' ? '🔔' : pushStatus === 'denied' ? '🔕' : '⏳'}
                  </button>

                  <button className="logout-btn" onClick={handleLogout} title="Logout">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                      <polyline points="16 17 21 12 16 7" />
                      <line x1="21" y1="12" x2="9" y2="12" />
                    </svg>
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

        {/* --- RENDERING DELL'INTERFACCIA --- */}
        <DndContext
          sensors={sensors}
          /* Motore di collisione personalizzato per gestire il posizionamento degli elementi trascinati */
          collisionDetection={customCollisionDetection}
          onDragStart={handleDragStart}
          onDragMove={handleDragMove}
          onDragEnd={handleDragEnd}
          /* Strategia di misura per aggiornare costantemente i confini delle drop zone */
          measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
        >
          <div className={`app-container ${isMobile ? 'mobile-view' : 'desktop-view'}`}>
            
            {/* TESTATA: Titolo, data corrente e pulsanti navigazione */}
            <header className="main-header">
              <div className="header-top">
                <div className="logo-section">
                  <h1 className="app-title">Agenda</h1>
                  <span className="current-date-badge">
                    {new Date().toLocaleDateString('it-IT', { day: 'numeric', month: 'long' })}
                  </span>
                </div>
                
                <div className="week-navigation">
                  <DroppableContainer id="prev-week-btn" className="nav-btn-wrapper">
                    <button className="nav-btn" onClick={prevWeek}>◀</button>
                  </DroppableContainer>
                  
                  <h2 className="week-label">
                    Settimana del {weekStart.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })}
                  </h2>
                  
                  <DroppableContainer id="next-week-btn" className="nav-btn-wrapper">
                    <button className="nav-btn" onClick={nextWeek}>▶</button>
                  </DroppableContainer>
                </div>
              </div>
            </header>

            {/* CONTENUTO PRINCIPALE: La griglia dei giorni */}
            <main className="agenda-grid">
              {days.map((day) => (
                <DroppableContainer key={day} id={day} className="day-column">
                  <div className="day-header">
                    <h3>{new Date(day).toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric' })}</h3>
                    <button className="add-task-inline-btn" onClick={() => setAddingToDay(day)}>＋</button>
                  </div>
                  
                  {/* Lista dei task del giorno */}
                  <SortableContext items={tasks[day] || []} strategy={verticalListSortingStrategy}>
                    <div className="task-list">
                      {(tasks[day] || []).map((t) => (
                        <TaskItem
                          key={t.id || t.text || t.task}
                          task={t}
                          toggleDone={() => toggleTaskDone(day, t.id, t.text || t.task)}
                          editTaskText={(newText) => editTaskText(day, t.id, t.text || t.task, newText)}
                        />
                      ))}
                    </div>
                  </SortableContext>

                  {/* Input rapido che appare in fondo alla colonna */}
                  {addingToDay === day && (
                    <div className="inline-add-container">
                      <textarea
                        autoFocus
                        placeholder="Nuova attività..."
                        value={inlineDayTask}
                        onChange={(e) => setInlineDayTask(e.target.value)}
                        onBlur={() => handleAddTaskToDay(day)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            handleAddTaskToDay(day);
                          }
                        }}
                      />
                    </div>
                  )}
                </DroppableContainer>
              ))}
            </main>

            {/* BARRA DI NAVIGAZIONE MOBILE (In fondo allo schermo) */}
            <nav className="mobile-bottom-nav">
              <DroppableContainer id="trash-zone" className="mobile-nav-btn-wrapper">
                <button className="mobile-nav-btn trash" onClick={() => setShowTrashModal(true)}>🗑️</button>
<button className="mobile-nav-btn add-main" onClick={() => setIsQuickAddOpen(true)}>＋</button>
              
              <DroppableContainer id="archive-zone" className="mobile-nav-btn-wrapper">
                <button className="mobile-nav-btn archive" onClick={() => setShowArchiveModal(true)}>📋</button>
              </DroppableContainer>
            </nav>

            {/* MODALE CESTINO */}
            {showTrashModal && (
              <div className="modal-overlay" onClick={() => setShowTrashModal(false)}>
                <div className="modal-content trash-modal" onClick={(e) => e.stopPropagation()}>
                  <div className="modal-header">
                    <h2>Cestino</h2>
                    <button className="clear-trash-btn" onClick={emptyTrash}>Svuota tutto</button>
                  </div>
                  <div className="trash-items">
                    {(tasks["Trash"] || []).map(t => (
                      <div key={t.id} className="trash-item-row">{t.text || t.task}</div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* MODALE ARCHIVIO (Menu Azioni) */}
            {showArchiveModal && (
              <div 
                className={activeTask ? "archive-modal-overlay is-dragging" : "archive-modal-overlay"} 
                onClick={() => { if (!activeTask) setShowArchiveModal(false); }}
              >
                <div className="archive-modal-content" onClick={(e) => e.stopPropagation()}>
                  <div className="archive-modal-header">
                    <h2>Azioni & Archivio 📋</h2>
                    <button className="close-modal-btn" onClick={() => setShowArchiveModal(false)}>✖</button>
                  </div>
                  
                  <DroppableContainer id="Backlog" className="archive-drop-zone">
                    <SortableContext items={tasks["Backlog"] || []} strategy={rectSortingStrategy}>
                      <div className="archive-grid">
                        {(tasks["Backlog"] || []).map((t) => (
                          <TaskItem
                            key={t.id || t.text || t.task}
                            task={t}
                            toggleDone={() => toggleTaskDone("Backlog", t.id, t.text || t.task)}
                            editTaskText={(newText) => editTaskText("Backlog", t.id, t.text || t.task, newText)}
                          />
                        ))}
                      </div>
                    </SortableContext>
                  </DroppableContainer>
                </div>
              </div>
            )}
              
            {/* MONITOR DI DEBUG (In fondo al DndContext) */}
            <div style={{
              position: "fixed",
              bottom: "10px",
              left: "10px",
              right: "10px",
              backgroundColor: "rgba(0,0,0,0.8)",
              color: "#0f0",
              fontSize: "10px",
              padding: "5px",
              borderRadius: "5px",
              zIndex: 99999,
              pointerEvents: "none",
              fontFamily: "monospace"
            }}>
              {debugLogs.map((log, i) => <div key={i}>{log}</div>)}
              {debugLogs.length === 0 && <div>Monitor di Debug Attivo...</div>}
            </div>

            {/* ZONA TRASCINAMENTO (Quello che vedi "sotto il dito") */}
            <DragOverlay dropAnimation={null}>
              {activeTask ? (
                <div className="task-item-dragging">
                  <TaskItem task={activeTask} isOverlay />
                </div>
              ) : null}
            </DragOverlay>

          </div>
        </DndContext>

        {/* MODALE AGGIUNTA RAPIDA (Fuori dal DndContext perché non serve il drag) */}
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
              <div className="modal-actions">
                <button className="btn-cancel" onClick={() => { setIsQuickAddOpen(false); setNewTask(""); }}>Annulla</button>
                <button className="btn-save" onClick={() => { handleAddTask(); setIsQuickAddOpen(false); }}>Salva</button>
              </div>
            </div>
          </div>
        )}

        {/* FEEDBACK VISIVO BORDI (Per il cambio settimana automatico) */}
        {draggingEdge === 'left' && <div className="week-portal left active"><span>PRECEDENTE</span></div>}
        {draggingEdge === 'right' && <div className="week-portal right active"><span>SUCCESSIVA</span></div>}
      </div>
    );
}

export default App;
