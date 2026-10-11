import React, { useState } from 'react';
import { X, Calendar, User, PlusCircle } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { fetchCurrentUser } from '../../api/auth';
import { useReviewStore } from '../../stores/reviewStore';

export interface CollaboratorOption {
  id: string;
  username: string;
  display_name?: string;
}

interface NewTaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  documentId?: string;
  commentId?: string;
  collaborators?: CollaboratorOption[];
}

export const NewTaskModal: React.FC<NewTaskModalProps> = ({
  isOpen,
  onClose,
  commentId,
  collaborators = [],
}) => {
  const { postTask } = useReviewStore();
  const [description, setDescription] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [dueDate, setDueDate] = useState('');
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
      const created = await postTask(
        description.trim(),
        commentId,
        assigneeId ? assigneeId : undefined,
        dueDate ? dueDate : undefined
      );

      if (created) {
        setDescription('');
        setAssigneeId('');
        setDueDate('');
        onClose();
      } else {
        setError('Failed to create task. Please try again.');
      }
    } catch (err: any) {
      setError(err?.message || 'Error creating task');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4"
      data-testid="new-task-modal"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-cme-bg-surface rounded-xl shadow-xl border border-cme-border-base overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-cme-border-base bg-cme-bg-subtle/50">
          <div className="flex items-center gap-2">
            <PlusCircle className="w-5 h-5 text-cme-primary" />
            <h3 className="font-semibold text-cme-text-base text-sm">
              {commentId ? 'Add Task to Discussion' : 'Create Action Item Task'}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md text-cme-text-muted hover:text-cme-text-base hover:bg-cme-bg-hover"
            data-testid="close-task-modal-btn"
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
              data-testid="task-description-input"
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
                data-testid="task-assignee-select"
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
                data-testid="task-due-date-input"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs bg-cme-bg-elevated border border-cme-border-base rounded-lg text-cme-text-base focus:outline-hidden focus:border-cme-primary"
              />
            </div>
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
              data-testid="submit-task-btn"
              className="px-4 py-1.5 text-xs rounded-lg font-medium bg-cme-primary text-white hover:bg-cme-primary/90 disabled:opacity-50 shadow-xs"
            >
              {isSubmitting ? 'Creating...' : 'Create Task'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
