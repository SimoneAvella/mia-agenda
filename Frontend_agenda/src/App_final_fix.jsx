            <div className="modal-actions">
              <button className="btn-cancel" onClick={() => { setIsQuickAddOpen(false); setNewTask(""); setNewTaskTime(""); }}>Annulla</button>
              <button className="btn-save" onClick={() => { handleAddTask(); setIsQuickAddOpen(false); }}>Salva</button>
            </div>
          </div>
        </div>
      )}

      {createPortal(
        <DragOverlay dropAnimation={null} zIndex={9999}>
          {activeTask ? (
            <div className="dragging-task-mirror">
               <TaskItem task={activeTask} toggleDone={() => {}} editTaskText={() => {}} />
            </div>
          ) : null}
        </DragOverlay>,
        document.body
      )}

    </div>
  );
}

export default App;
