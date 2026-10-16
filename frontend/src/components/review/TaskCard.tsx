import React, { useState } from 'react';
import { Calendar, Pencil } from 'lucide-react';
import { TaskRecord } from '../../review/types';
import { useReviewStore } from '../../stores/reviewStore';
import { EditTaskModal } from './EditTaskModal';

interface TaskCardProps {
  task: TaskRecord;
}

export const TaskCard: React.FC<TaskCardProps> = ({ task }) => {
  const { toggleTask, activeItemId, setActiveItemId } = useReviewStore();
  const [showEditModal, setShowEditModal] = useState(false);

  const isActive = activeItemId === task.id;

  return (
    <>
      <div
        data-testid="task-card"
        onClick={() => setActiveItemId(task.id)}
        className={`rounded-xl border transition-all text-sm p-3 bg-cme-bg-surface flex items-start gap-2.5 ${
          isActive
            ? 'border-cme-primary shadow-md ring-1 ring-cme-primary/20'
            : 'border-cme-border-base hover:border-cme-border-hover shadow-sm'
        } ${task.is_completed ? 'opacity-65' : ''}`}
      >
        <input
          type="checkbox"
          data-testid="task-checkbox"
          checked={task.is_completed}
          onChange={(e) => {
            e.stopPropagation();
            toggleTask(task.id, e.target.checked);
          }}
          className="mt-0.5 w-4 h-4 rounded text-cme-primary focus:ring-cme-primary cursor-pointer border-cme-border-base"
        />

        <div className="flex-1 min-w-0">
          <p
            className={`text-xs text-cme-text-base leading-relaxed ${
              task.is_completed ? 'line-through text-cme-text-muted' : ''
            }`}
          >
            {task.description}
          </p>

          <div className="flex flex-wrap items-center gap-2 mt-1.5 text-[10px] text-cme-text-muted">
            {task.assignee && (
              <span className="flex items-center gap-1 font-medium text-cme-text-subtle">
                <span
                  className="w-3.5 h-3.5 rounded-full flex items-center justify-center text-[8px] text-white"
                  style={{ backgroundColor: task.assignee.avatar_color || '#3b82f6' }}
                >
                  {(task.assignee.display_name || task.assignee.username)[0].toUpperCase()}
                </span>
                {task.assignee.display_name || task.assignee.username}
              </span>
            )}

            {task.due_date && (
              <span className="flex items-center gap-0.5">
                <Calendar className="w-2.5 h-2.5" />
                {task.due_date}
              </span>
            )}
          </div>
        </div>

        <button
          type="button"
          data-testid="edit-task-btn"
          onClick={(e) => {
            e.stopPropagation();
            setShowEditModal(true);
          }}
          className="p-1 text-cme-text-muted hover:text-cme-primary hover:bg-cme-bg-hover rounded transition-colors"
          title="Edit task"
        >
          <Pencil className="w-3.5 h-3.5" />
        </button>
      </div>

      {showEditModal && (
        <EditTaskModal
          isOpen={showEditModal}
          onClose={() => setShowEditModal(false)}
          task={task}
        />
      )}
    </>
  );
};
