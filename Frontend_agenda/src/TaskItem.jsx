import { useSortable } from "@dnd-kit/sortable";
// adjustTranslate removed – not exported in current version
import { CSS } from "@dnd-kit/utilities";
import { useState, useEffect, useRef } from "react";

export default function TaskItem({ task, toggleDone, editTaskText }) {
  const { 
    attributes, 
    listeners, 
    setNodeRef, 
    transform, 
    transition,
    isDragging 
  } = useSortable({
    id: task.id || task.task,
  });
    
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
    opacity: isDragging ? 0.5 : 1,
    cursor: isEditing ? "text" : "grab",
    position: "relative",
    display: "flex",
    alignItems: "flex-start", 
    wordBreak: "break-word",
    transform: CSS.Translate.toString(transform),
    transition,
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
      className={`task-item ${task.done ? "task-done" : ""}`}
      onDoubleClick={() => { if (!task.done) setIsEditing(true); }}
    >
      <input 
        type="checkbox" 
        checked={task.done} 
        onChange={toggleDone}
        onPointerDown={(e) => e.stopPropagation()} 
        style={{ marginTop: task.time ? "4px" : "1px", flexShrink: 0, cursor: "pointer" }} 
      />
      
      <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
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