import { useDroppable } from "@dnd-kit/core";

export default function DroppableContainer({ id, className, children, disabled, ...props }) {
  const { isOver, setNodeRef } = useDroppable({
    id: id,
    disabled: disabled
  });

  return (
    <div 
      ref={setNodeRef} 
      className={`${className || ""} ${isOver ? "is-over" : ""}`.trim()} 
      id={id}
      {...props}
    >
      {children}
    </div>
  );
}
