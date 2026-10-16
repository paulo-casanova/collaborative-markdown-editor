import React, { useState } from 'react';
import { X, Calendar, User, Pencil, CheckSquare } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { fetchCurrentUser } from '../../api/auth';
import { TaskRecord } from '../../review/types';
import { useReviewStore } from '../../stores/reviewStore';
import { CollaboratorOption } from './NewTaskModal';

interface EditTaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  task: TaskRecord;
  collaborators?: CollaboratorOption[];
  onSaved?: (updated: TaskRecord) => void;
}

export const EditTaskModal: React.FC<EditTaskModalProps> = ({
  isOpen,
  onClose,
  task,
  collaborators = [],
  onSaved,
}) => {
  const { editTask } = useReviewStore();
  const [description, setDescription] = useState(task.description || '');
  const [assigneeId, setAssigneeId] = useState(task.assignee?.id || '');
  // Format dueDate for HTML date input: YYYY-MM-DD
  const initialDueDate = task.due_date
    ? task.due_date.includes('T')
      ? task.due_date.split('T')[0]
      : task.due_date
    : '';
  const [dueDate, setDueDate] = useState(initialDueDate);
  const [isCompleted, setIsCompleted] = useState(task.is_completed || false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: currentUser } = useQuery({
    queryKey: ['auth-me'],
    queryFn: fetchCurrentUser,
    enabled: isOpen,
  });

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!description.trim()) {
      setError('Task description cannot be empty');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const updated = await editTask(task.id, {
        description: description.trim(),
        assignee_id: assigneeId ? assigneeId : null,
        due_date: dueDate ? dueDate : null,
        is_completed: isCompleted,
      });

      if (updated) {
        onSaved?.(updated);
        onClose();
      } else {
        setError('Failed to update task. Please try again.');
      }
    } catch (err: any) {
      setError(err?.message || 'Error updating task');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4"
      data-testid="edit-task-modal"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-cme-bg-surface rounded-xl shadow-xl border border-cme-border-base overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-cme-border-base bg-cme-bg-subtle/50">
          <div className="flex items-center gap-2">
            <Pencil className="w-4 h-4 text-cme-primary" />
            <h3 className="font-semibold text-cme-text-base text-sm">Edit Task</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md text-cme-text-muted hover:text-cme-text-base hover:bg-cme-bg-hover"
            data-testid="close-edit-task-modal-btn"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && (
            <div className="p-2.5 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-xs text-red-600 dark:text-red-400">
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-cme-text-subtle mb-1">
              Task Description <span className="text-red-500">*</span>
            </label>
            <textarea
              data-testid="edit-task-description-input"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Update API schema documentation..."
              rows={3}
              required
              className="w-full px-3 py-2 text-xs bg-cme-bg-elevated border border-cme-border-base rounded-lg text-cme-text-base placeholder-cme-text-muted focus:outline-hidden focus:border-cme-primary focus:ring-1 focus:ring-cme-primary resize-none"
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-cme-text-subtle mb-1 flex items-center gap-1">
                <User className="w-3.5 h-3.5 text-cme-text-muted" />
                <span>Assignee</span>
              </label>
              <select
                data-testid="edit-task-assignee-select"
                value={assigneeId}
                onChange={(e) => setAssigneeId(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs bg-cme-bg-elevated border border-cme-border-base rounded-lg text-cme-text-base focus:outline-hidden focus:border-cme-primary"
              >
                <option value="">Unassigned</option>
                {currentUser && (
                  <option value={currentUser.user_id}>
                    Assign to me (@{currentUser.username})
                  </option>
                )}
                {collaborators
                  .filter((c) => c.id !== currentUser?.user_id)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.display_name || c.username} (@{c.username})
                    </option>
                  ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-cme-text-subtle mb-1 flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5 text-cme-text-muted" />
                <span>Due Date</span>
              </label>
              <input
                type="date"
                data-testid="edit-task-due-date-input"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs bg-cme-bg-elevated border border-cme-border-base rounded-lg text-cme-text-base focus:outline-hidden focus:border-cme-primary"
              />
            </div>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <input
              type="checkbox"
              id="edit-task-completed"
              data-testid="edit-task-completed-checkbox"
              checked={isCompleted}
              onChange={(e) => setIsCompleted(e.target.checked)}
              className="w-4 h-4 rounded text-cme-primary focus:ring-cme-primary cursor-pointer border-cme-border-base"
            />
            <label htmlFor="edit-task-completed" className="text-xs text-cme-text-base cursor-pointer select-none">
              Mark as completed
            </label>
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-cme-border-base">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-3 py-1.5 text-xs rounded-lg border border-cme-border-base text-cme-text-muted hover:text-cme-text-base hover:bg-cme-bg-hover"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !description.trim()}
              data-testid="save-task-btn"
              className="px-4 py-1.5 text-xs font-medium rounded-lg bg-cme-primary text-white hover:bg-cme-primary/90 disabled:opacity-50 flex items-center gap-1.5 shadow-sm"
            >
              <CheckSquare className="w-3.5 h-3.5" />
              <span>{isSubmitting ? 'Saving...' : 'Save Changes'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
