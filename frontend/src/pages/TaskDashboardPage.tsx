import React, { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CheckSquare,
  Search,
  CheckCircle2,
  Clock,
  User,
  Calendar,
  FileText,
  ExternalLink,
  Trash2,
  Inbox,
} from 'lucide-react';
import { fetchAllTasks, updateTask, deleteTask } from '../api/reviews';
import { fetchCurrentUser } from '../api/auth';
import { TaskRecord } from '../review/types';

export const TaskDashboardPage: React.FC = () => {
  const queryClient = useQueryClient();
  const [filterTab, setFilterTab] = useState<'all' | 'assigned' | 'open' | 'completed'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Fetch current user info
  const { data: currentUser } = useQuery({
    queryKey: ['auth-me'],
    queryFn: fetchCurrentUser,
  });

  // Fetch all tasks
  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ['all-tasks'],
    queryFn: () => fetchAllTasks(),
    staleTime: 2000,
  });

  // Toggle task mutation with optimistic UI updates
  const toggleMutation = useMutation({
    mutationFn: ({ taskId, isCompleted }: { taskId: string; isCompleted: boolean }) =>
      updateTask(taskId, isCompleted),
    onMutate: async ({ taskId, isCompleted }) => {
      await queryClient.cancelQueries({ queryKey: ['all-tasks'] });
      const previousTasks = queryClient.getQueryData<TaskRecord[]>(['all-tasks']);
      if (previousTasks) {
        queryClient.setQueryData<TaskRecord[]>(
          ['all-tasks'],
          previousTasks.map((t) =>
            t.id === taskId
              ? {
                  ...t,
                  is_completed: isCompleted,
                  completed_at: isCompleted ? new Date().toISOString() : null,
                }
              : t
          )
        );
      }
      return { previousTasks };
    },
    onError: (_err, _vars, context) => {
      if (context?.previousTasks) {
        queryClient.setQueryData(['all-tasks'], context.previousTasks);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['all-tasks'] });
    },
  });

  // Delete task mutation
  const deleteMutation = useMutation({
    mutationFn: (taskId: string) => deleteTask(taskId),
    onMutate: async (taskId) => {
      await queryClient.cancelQueries({ queryKey: ['all-tasks'] });
      const previousTasks = queryClient.getQueryData<TaskRecord[]>(['all-tasks']);
      if (previousTasks) {
        queryClient.setQueryData<TaskRecord[]>(
          ['all-tasks'],
          previousTasks.filter((t) => t.id !== taskId)
        );
      }
      return { previousTasks };
    },
    onError: (_err, _vars, context) => {
      if (context?.previousTasks) {
        queryClient.setQueryData(['all-tasks'], context.previousTasks);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['all-tasks'] });
    },
  });

  // Summary Metrics
  const metrics = useMemo(() => {
    const total = tasks.length;
    const completed = tasks.filter((t) => t.is_completed).length;
    const open = total - completed;
    const assigned = currentUser
      ? tasks.filter(
          (t) =>
            t.assignee?.id === currentUser.user_id ||
            t.assignee?.username === currentUser.username
        ).length
      : 0;
    return { total, open, completed, assigned };
  }, [tasks, currentUser]);

  // Filtered tasks
  const filteredTasks = useMemo(() => {
    return tasks.filter((task) => {
      // Tab filter
      if (filterTab === 'open' && task.is_completed) return false;
      if (filterTab === 'completed' && !task.is_completed) return false;
      if (filterTab === 'assigned') {
        if (!currentUser) return false;
        const isAssignedToMe =
          task.assignee?.id === currentUser.user_id ||
          task.assignee?.username === currentUser.username;
        if (!isAssignedToMe) return false;
      }

      // Search filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesDesc = task.description.toLowerCase().includes(q);
        const matchesDocTitle = task.document_title?.toLowerCase().includes(q) || false;
        const matchesDocPath = task.document_path?.toLowerCase().includes(q) || false;
        const matchesAssignee =
          task.assignee?.display_name?.toLowerCase().includes(q) ||
          task.assignee?.username?.toLowerCase().includes(q) ||
          false;
        if (!matchesDesc && !matchesDocTitle && !matchesDocPath && !matchesAssignee) {
          return false;
        }
      }

      return true;
    });
  }, [tasks, filterTab, searchQuery, currentUser]);

  // Group tasks by document
  const groupedTasks = useMemo(() => {
    const map = new Map<
      string,
      {
        documentId: string;
        documentTitle: string;
        documentPath: string;
        tasks: TaskRecord[];
      }
    >();

    filteredTasks.forEach((task) => {
      const docId = task.document_id;
      if (!map.has(docId)) {
        map.set(docId, {
          documentId: docId,
          documentTitle: task.document_title || 'Untitled Document',
          documentPath: task.document_path || '',
          tasks: [],
        });
      }
      map.get(docId)!.tasks.push(task);
    });

    return Array.from(map.values());
  }, [filteredTasks]);

  return (
    <div className="flex-1 h-full overflow-y-auto bg-cme-bg-base p-6 space-y-6" data-testid="task-dashboard-page">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-cme-border-base pb-5">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-cme-primary/10 text-cme-primary">
              <CheckSquare className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-cme-text-base">Task Dashboard</h1>
              <p className="text-xs text-cme-text-muted mt-0.5">
                Centralized action items and review tasks across your workspaces
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Metrics Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
        <div className="p-4 rounded-xl bg-cme-bg-surface border border-cme-border-base shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-cme-text-muted">Total Tasks</span>
            <CheckSquare className="w-4 h-4 text-cme-primary" />
          </div>
          <p className="text-2xl font-bold text-cme-text-base mt-2" data-testid="metric-total-tasks">
            {metrics.total}
          </p>
        </div>

        <div className="p-4 rounded-xl bg-cme-bg-surface border border-cme-border-base shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-cme-text-muted">Open Items</span>
            <Clock className="w-4 h-4 text-amber-500" />
          </div>
          <p className="text-2xl font-bold text-amber-600 dark:text-amber-400 mt-2" data-testid="metric-open-tasks">
            {metrics.open}
          </p>
        </div>

        <div className="p-4 rounded-xl bg-cme-bg-surface border border-cme-border-base shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-cme-text-muted">Completed</span>
            <CheckCircle2 className="w-4 h-4 text-green-500" />
          </div>
          <p className="text-2xl font-bold text-green-600 dark:text-green-400 mt-2" data-testid="metric-completed-tasks">
            {metrics.completed}
          </p>
        </div>

        <div className="p-4 rounded-xl bg-cme-bg-surface border border-cme-border-base shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-cme-text-muted">Assigned to Me</span>
            <User className="w-4 h-4 text-blue-500" />
          </div>
          <p className="text-2xl font-bold text-blue-600 dark:text-blue-400 mt-2" data-testid="metric-assigned-tasks">
            {metrics.assigned}
          </p>
        </div>
      </div>

      {/* Controls & Filter Bar */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 bg-cme-bg-surface p-3 rounded-xl border border-cme-border-base">
        {/* Filter Tabs */}
        <div className="flex items-center gap-1 bg-cme-bg-elevated p-1 rounded-lg text-xs">
          <button
            type="button"
            data-testid="tab-all-tasks"
            onClick={() => setFilterTab('all')}
            className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
              filterTab === 'all'
                ? 'bg-cme-bg-surface text-cme-text-base shadow-xs'
                : 'text-cme-text-muted hover:text-cme-text-base'
            }`}
          >
            All ({metrics.total})
          </button>
          <button
            type="button"
            data-testid="tab-assigned-tasks"
            onClick={() => setFilterTab('assigned')}
            className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
              filterTab === 'assigned'
                ? 'bg-cme-bg-surface text-cme-text-base shadow-xs'
                : 'text-cme-text-muted hover:text-cme-text-base'
            }`}
          >
            Assigned to Me ({metrics.assigned})
          </button>
          <button
            type="button"
            data-testid="tab-open-tasks"
            onClick={() => setFilterTab('open')}
            className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
              filterTab === 'open'
                ? 'bg-cme-bg-surface text-cme-text-base shadow-xs'
                : 'text-cme-text-muted hover:text-cme-text-base'
            }`}
          >
            Incomplete ({metrics.open})
          </button>
          <button
            type="button"
            data-testid="tab-completed-tasks"
            onClick={() => setFilterTab('completed')}
            className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
              filterTab === 'completed'
                ? 'bg-cme-bg-surface text-cme-text-base shadow-xs'
                : 'text-cme-text-muted hover:text-cme-text-base'
            }`}
          >
            Completed ({metrics.completed})
          </button>
        </div>

        {/* Search Input */}
        <div className="relative min-w-[240px]">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-cme-text-muted" />
          <input
            type="text"
            data-testid="task-search-input"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search tasks or documents..."
            className="w-full pl-9 pr-3 py-1.5 text-xs bg-cme-bg-elevated border border-cme-border-base rounded-lg text-cme-text-base placeholder-cme-text-muted focus:outline-hidden focus:border-cme-primary"
          />
        </div>
      </div>

      {/* Task List / Document Groups */}
      <div className="space-y-5">
        {isLoading ? (
          <div className="flex items-center justify-center h-48 text-xs text-cme-text-muted">
            Loading tasks dashboard...
          </div>
        ) : groupedTasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 bg-cme-bg-surface rounded-2xl border border-cme-border-base text-center p-6" data-testid="tasks-empty-state">
            <div className="p-3 rounded-full bg-cme-bg-elevated text-cme-text-muted mb-3">
              <Inbox className="w-6 h-6" />
            </div>
            <h3 className="text-sm font-semibold text-cme-text-base mb-1">No tasks found</h3>
            <p className="text-xs text-cme-text-muted max-w-sm">
              {searchQuery
                ? 'No tasks matched your search query. Try clearing the filter.'
                : 'You are all caught up! No action items in this category.'}
            </p>
          </div>
        ) : (
          groupedTasks.map((group) => (
            <div
              key={group.documentId}
              className="bg-cme-bg-surface rounded-xl border border-cme-border-base overflow-hidden shadow-xs"
              data-testid="document-task-group"
            >
              {/* Document Header */}
              <div className="px-4 py-3 bg-cme-bg-subtle/50 border-b border-cme-border-base flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-cme-primary" />
                  <span className="font-semibold text-xs text-cme-text-base">
                    {group.documentTitle}
                  </span>
                  {group.documentPath && (
                    <span className="text-[11px] text-cme-text-muted font-mono">
                      ({group.documentPath})
                    </span>
                  )}
                </div>

                <Link
                  to={`/documents/${group.documentId}`}
                  className="flex items-center gap-1 text-xs text-cme-primary hover:underline font-medium"
                  data-testid="open-document-link"
                >
                  <span>Open Document</span>
                  <ExternalLink className="w-3 h-3" />
                </Link>
              </div>

              {/* Tasks in Document */}
              <div className="divide-y divide-cme-border-base/50">
                {group.tasks.map((task) => (
                  <div
                    key={task.id}
                    data-testid="dashboard-task-item"
                    className={`px-4 py-3 flex items-start gap-3 transition-colors hover:bg-cme-bg-hover/40 ${
                      task.is_completed ? 'opacity-65' : ''
                    }`}
                  >
                    <input
                      type="checkbox"
                      data-testid="dashboard-task-checkbox"
                      checked={task.is_completed}
                      onChange={(e) => {
                        toggleMutation.mutate({
                          taskId: task.id,
                          isCompleted: e.target.checked,
                        });
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

                      <div className="flex flex-wrap items-center gap-2.5 mt-1.5 text-[10px] text-cme-text-muted">
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
                            <Calendar className="w-3 h-3 text-cme-text-muted" />
                            {task.due_date}
                          </span>
                        )}

                        {task.completed_at && (
                          <span className="text-green-600 dark:text-green-400 font-medium">
                            Completed {new Date(task.completed_at).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    </div>

                    <button
                      type="button"
                      data-testid="delete-dashboard-task-btn"
                      onClick={() => {
                        if (confirm('Delete this task?')) {
                          deleteMutation.mutate(task.id);
                        }
                      }}
                      className="p-1 rounded text-cme-text-muted hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40"
                      title="Delete task"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
