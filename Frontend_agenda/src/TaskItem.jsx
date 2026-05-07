import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useState, useEffect, useRef } from "react";

export default function TaskItem({ task, toggleDone, editTaskText }) {
  // Usiamo l'ID come identificatore unico per il drag, oppure il testo come fallback estremo
  const draggableId = String(task.id || task.text || task.task);
  const { 
    attributes, 
    listeners, 
    setNodeRef, 
    transform, 
    transition,
    isDragging 
  } = useSortable({ id: draggableId });
    
  const [isEditing, setIsEditing] = useState(false);
  const displayText = task.text || task.task || "";
  const [editText, setEditText] = useState(displayText);
  const inputRef = useRef(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.selectionStart = inputRef.current.value.length;
      
      inputRef.current.style.height = "auto";
      inputRef.current.style.height = inputRef.current.scrollHeight + "px";
    }
  }, [isEditing]);

  const style = {
    // Se il task è in fase di trascinamento (isDragging), lo rendiamo trasparente (opacity: 0)
    // Questo perché dnd-kit mostra una "copia" (DragOverlay) e non vogliamo vedere l'originale sotto.
    opacity: isDragging ? 0 : 1, 
    visibility: isDragging ? "hidden" : "visible",
    
    cursor: isEditing ? "text" : "grab",
    position: "relative",
    display: "flex",
    alignItems: "flex-start", 
    wordBreak: "break-word",
    transform: CSS.Translate.toString(transform), // Gestisce il movimento fluido del task nella lista
    transition,
    zIndex: isDragging ? 9999 : "auto",
    pointerEvents: isDragging ? "none" : "auto"
  };

  const handleSave = () => {
    setIsEditing(false);
    if (editText.trim() !== "" && editText.trim() !== displayText) {
      editTaskText(editText.trim());
    } else {
      setEditText(displayText);
    }
  };

  return (
    <div 
      ref={setNodeRef} 
      style={style} 
      {...attributes} 
      {...(isEditing ? {} : listeners)}
      className={`task-item ${task.done ? "task-done" : ""} ${isDragging ? "is-dragging" : ""}`.trim()}
      onDoubleClick={() => { if (!task.done) setIsEditing(true); }}
      title={!task.done && !isEditing ? "Doppio clic per modificare" : ""}
    >
      <input 
        type="checkbox" 
        checked={task.done} 
        onChange={toggleDone}
        onPointerDown={(e) => e.stopPropagation()} 
        style={{ marginTop: task.time ? "4px" : "1px", flexShrink: 0, cursor: "pointer" }} 
      />
      
      <div style={{ display: "flex", flexDirection: "column", flex: 1, marginLeft: "0px" }}>
        {task.time && !isEditing && (
          <div className="task-time-header">
            <span className="task-time-label">⏰ {task.time}</span>
          </div>
        )}
        
        {isEditing ? (
          <textarea
            ref={inputRef}
            style={{ 
              width: "100%",
              border: "none", 
              padding: "0", 
              resize: "none", 
              overflow: "hidden", 
              outline: "none", 
              fontFamily: "inherit", 
              fontSize: "inherit", 
              lineHeight: "inherit",
              background: "transparent"
            }}
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            onBlur={handleSave}
            onPointerDown={(e) => e.stopPropagation()} 
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSave();
              }
              if (e.key === "Escape") {
                setEditText(displayText);
                setIsEditing(false);
              }
            }}
          />
        ) : (
          <span className="task-text-content">
            {displayText}
          </span>
        )}
      </div>
    </div>
  );
}