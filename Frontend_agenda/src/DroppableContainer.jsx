import { useDroppable } from "@dnd-kit/core";

export default function DroppableContainer({ id, className, children, onClick, title }) {
  const { isOver, setNodeRef } = useDroppable({
    id: id,
  });

  return (
    <div 
      ref={setNodeRef} 
      className={`${className || ""} ${isOver ? "is-drag-over" : ""}`.trim()} 
      id={id}
      onClick={onClick}
      title={title}
    >
      {children}
    </div>
  );
}
