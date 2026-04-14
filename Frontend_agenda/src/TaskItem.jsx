import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useState, useEffect, useRef } from "react";

export default function TaskItem({ task, toggleDone, editTaskText }) {
  const draggableId = String(task.id ? task.id : task.task);
  const { 
    attributes, 
    listeners, 
    setNodeRef, 
    transform, 
    transition,
    isDragging 
  } = useSortable({ id: draggableId });
    
  const [isEditing, setIsEditing] = useState(false);
  const displayText = task.text ? task.text : task.task;
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
    opacity: isDragging ? 0 : 1, 
    cursor: isEditing ? "text" : "default",
    position: "relative",
    display: "flex",
    alignItems: "flex-start", 
    wordBreak: "break-word",
    touchAction: "pan-y", /* Allow native vertical scroll on the item */
    transform: CSS.Translate.toString(transform),
    transition
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
        onPointerDown={(e) => e.stopPropagation()} /* Keep checkbox clickable independent of drag */
        style={{ marginTop: "1px", flexShrink: 0, cursor: "pointer" }} 
      />
      
      {isEditing ? (
        <textarea
          ref={inputRef}
          style={{ 
            flex: 1, 
            border: "none", 
            padding: "0", 
            resize: "none", 
            overflow: "hidden", 
            outline: "none", 
            fontFamily: "inherit", 
            fontSize: "inherit", 
            lineHeight: "inherit",
            background: "transparent",
            marginLeft: "0px" 
          }}
          value={editText}
          onChange={(e) => {
            setEditText(e.target.value);
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
        <span style={{ marginLeft: "0px", flex: 1 }}>
          {displayText}
        </span>
      )}
    </div>
  );
}