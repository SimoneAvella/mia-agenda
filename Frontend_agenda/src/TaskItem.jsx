import { useDraggable } from "@dnd-kit/core";
import { useState, useEffect, useRef } from "react";

export default function TaskItem({ task, toggleDone, editTaskText }) {
  const draggableId = task.id ? task.id : task.task;
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: draggableId });
  
  const [isEditing, setIsEditing] = useState(false);
  const displayText = task.text ? task.text : task.task;
  const [editText, setEditText] = useState(displayText);
  const inputRef = useRef(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.selectionStart = inputRef.current.value.length;
    }
  }, [isEditing]);

  const style = {
    transform: transform
      ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
      : undefined,
    zIndex: isDragging ? 999 : "auto",
    cursor: isEditing ? "text" : "grab",
    position: "relative",
    display: "flex",
    alignItems: "flex-start", 
    wordBreak: "break-word"
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
      className={task.done ? "task-item task-done" : "task-item"}
      onDoubleClick={() => { if (!task.done) setIsEditing(true); }}
      title={!task.done && !isEditing ? "Doppio clic per modificare" : ""}
    >
      <input 
        type="checkbox" 
        checked={task.done} 
        onChange={toggleDone}
        onPointerDown={(e) => e.stopPropagation()}
        style={{ marginTop: "4px", flexShrink: 0, cursor: "pointer" }} 
      />
      
      {isEditing ? (
        <textarea
          ref={inputRef}
          style={{ flex: 1, border: "1px solid #007bff", borderRadius: "4px", padding: "2px 4px", resize: "none", overflow: "hidden", outline: "none", fontFamily: "inherit", fontSize: "1rem", marginLeft: "6px" }}
          value={editText}
          onChange={(e) => {
            setEditText(e.target.value);
            e.target.style.height = "auto";
            e.target.style.height = e.target.scrollHeight + "px";
          }}
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
        <span style={{ textDecoration: task.done ? "line-through" : "none", marginLeft: "6px", flex: 1 }}>
          {displayText}
        </span>
      )}
    </div>
  );
}