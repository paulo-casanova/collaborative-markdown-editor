import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { CommentsDashboardView } from '../../src/components/review/CommentsDashboardView';
import { SuggestionsDashboardView } from '../../src/components/review/SuggestionsDashboardView';
import { TaskDashboardPage } from '../../src/pages/TaskDashboardPage';
import { Sidebar } from '../../src/components/layout/Sidebar';
import * as reviewsApi from '../../src/api/reviews';
import * as mentionsApi from '../../src/api/mentions';
import * as checkoutsApi from '../../src/api/checkouts';
import * as authApi from '../../src/api/auth';
import { CommentRecord, SuggestionRecord, TaskRecord } from '../../src/review/types';

vi.mock('../../src/api/reviews', () => ({
  fetchParticipatedComments: vi.fn(),
  fetchUnacknowledgedCommentsCount: vi.fn(),
  acknowledgeComment: vi.fn(),
  acknowledgeAllComments: vi.fn(),
  fetchAllSuggestions: vi.fn(),
  fetchUnacknowledgedSuggestionsCount: vi.fn(),
  acknowledgeSuggestion: vi.fn(),
  acknowledgeAllSuggestions: vi.fn(),
  fetchAllTasks: vi.fn(),
  updateTask: vi.fn(),
  deleteTask: vi.fn(),
}));

vi.mock('../../src/api/mentions', () => ({
  fetchMentions: vi.fn(),
  fetchUnreadMentionsCount: vi.fn(),
  acknowledgeMention: vi.fn(),
  acknowledgeAllMentions: vi.fn(),
  fetchMentionCandidates: vi.fn(),
}));

vi.mock('../../src/api/checkouts', () => ({
  fetchMyCheckouts: vi.fn(),
}));

vi.mock('../../src/api/auth', () => ({
  fetchCurrentUser: vi.fn(),
}));

vi.mock('../../src/components/navigation/FileTree', () => ({
  FileTree: () => <div data-testid="file-tree-mock">FileTree</div>,
}));

vi.mock('../../src/components/navigation/RecentDocuments', () => ({
  RecentDocuments: () => <div data-testid="recent-docs-mock">RecentDocuments</div>,
}));

describe('Comments & Suggestions Dashboard Views and Navigation', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });

    vi.mocked(authApi.fetchCurrentUser).mockResolvedValue({
      id: 'u-1',
      username: 'alice',
      email: 'alice@example.com',
      role: 'ADMIN',
    });

    vi.mocked(reviewsApi.fetchUnacknowledgedCommentsCount).mockResolvedValue({
      unacknowledged_count: 3,
    });

    vi.mocked(reviewsApi.fetchUnacknowledgedSuggestionsCount).mockResolvedValue({
      unacknowledged_count: 2,
    });

    vi.mocked(mentionsApi.fetchUnreadMentionsCount).mockResolvedValue({
      unread_count: 1,
    });

    vi.mocked(checkoutsApi.fetchMyCheckouts).mockResolvedValue([]);
    vi.mocked(reviewsApi.fetchAllTasks).mockResolvedValue([]);
  });

  const mockComments: CommentRecord[] = [
    {
      id: 'c-1',
      document_id: 'doc-1',
      parent_id: null,
      author: {
        id: 'u-2',
        username: 'bob',
        display_name: 'Bob Reviewer',
        avatar_color: '#3b82f6',
      },
      content: 'Should we increase cache TTL to 3600 seconds?',
      status: 'RESOLVED',
      anchor: {
        quote: {
          exact: 'cache_ttl: 300',
          prefix: '',
          suffix: '',
        },
      },
      created_at: '2026-11-05T10:00:00Z',
      updated_at: '2026-11-05T12:00:00Z',
      document_title: 'API Gateway Config',
      document_path: 'configs/gateway.md',
      last_activity_at: '2026-11-05T12:00:00Z',
      is_acknowledged: false,
      acknowledged_at: null,
      replies: [
        {
          id: 'c-2',
          document_id: 'doc-1',
          parent_id: 'c-1',
          author: {
            id: 'u-1',
            username: 'alice',
            display_name: 'Alice Admin',
            avatar_color: '#10b981',
          },
          content: 'Agreed, 3600s matches our CDN edge configuration.',
          status: 'RESOLVED',
          anchor: null,
          created_at: '2026-11-05T12:00:00Z',
          updated_at: '2026-11-05T12:00:00Z',
        },
      ],
    },
    {
      id: 'c-3',
      document_id: 'doc-2',
      parent_id: null,
      author: {
        id: 'u-1',
        username: 'alice',
        display_name: 'Alice Admin',
        avatar_color: '#10b981',
      },
      content: 'Need to clarify the OAuth scope definitions.',
      status: 'OPEN',
      anchor: {
        quote: {
          exact: 'scopes: read, write',
          prefix: '',
          suffix: '',
        },
      },
      created_at: '2026-11-05T09:00:00Z',
      updated_at: '2026-11-05T09:00:00Z',
      document_title: 'Auth Service Spec',
      document_path: 'specs/auth.md',
      last_activity_at: '2026-11-05T09:00:00Z',
      is_acknowledged: false,
      acknowledged_at: null,
      replies: [],
    },
  ];

  const mockSuggestions: SuggestionRecord[] = [
    {
      id: 's-1',
      document_id: 'doc-1',
      author: {
        id: 'u-2',
        username: 'bob',
        display_name: 'Bob Reviewer',
        avatar_color: '#3b82f6',
      },
      original_text: 'timeout: 5s',
      suggested_text: 'timeout: 15s',
      status: 'ACCEPTED',
      anchor: null,
      created_at: '2026-11-05T11:00:00Z',
      document_title: 'API Gateway Config',
      document_path: 'configs/gateway.md',
      is_acknowledged: false,
      acknowledged_at: null,
    },
    {
      id: 's-2',
      document_id: 'doc-2',
      author: {
        id: 'u-3',
        username: 'charlie',
        display_name: 'Charlie Contributor',
        avatar_color: '#8b5cf6',
      },
      original_text: 'algorithm: RS256',
      suggested_text: 'algorithm: EdDSA',
      status: 'PENDING',
      anchor: null,
      created_at: '2026-11-05T14:00:00Z',
      document_title: 'Auth Service Spec',
      document_path: 'specs/auth.md',
      is_acknowledged: false,
      acknowledged_at: null,
    },
  ];

  describe('CommentsDashboardView', () => {
    it('renders participated threads, replies, document metadata, and ACK actions', () => {
      queryClient.setQueryData(['participated-comments', 'active'], mockComments);

      const html = renderToStaticMarkup(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter>
            <CommentsDashboardView />
          </MemoryRouter>
        </QueryClientProvider>
      );

      // Thread titles & document context
      expect(html).toContain('API Gateway Config');
      expect(html).toContain('configs/gateway.md');
      expect(html).toContain('Auth Service Spec');
      expect(html).toContain('specs/auth.md');

      // Thread contents and author badges
      expect(html).toContain('@bob');
      expect(html).toContain('Should we increase cache TTL to 3600 seconds?');
      expect(html).toContain('cache_ttl: 300');

      // Nested reply
      expect(html).toContain('@alice');
      expect(html).toContain('Agreed, 3600s matches our CDN edge configuration.');

      // Second thread
      expect(html).toContain('Need to clarify the OAuth scope definitions.');

      // ACK button for resolved thread
      expect(html).toContain('ACK');
      expect(html).toContain('ACK All');
    });

    it('renders empty state when there are no comment threads', () => {
      queryClient.setQueryData(['participated-comments', 'active'], []);

      const html = renderToStaticMarkup(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter>
            <CommentsDashboardView />
          </MemoryRouter>
        </QueryClientProvider>
      );

      expect(html).toContain('No Comment Threads');
      expect(html).toContain('All caught up! No active or unacknowledged comment threads.');
    });
  });

  describe('SuggestionsDashboardView', () => {
    it('renders suggestions list with original vs suggested diff, status badges, and ACK actions', () => {
      queryClient.setQueryData(['all-suggestions', 'active'], mockSuggestions);

      const html = renderToStaticMarkup(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter>
            <SuggestionsDashboardView />
          </MemoryRouter>
        </QueryClientProvider>
      );

      // Document context & authors
      expect(html).toContain('API Gateway Config');
      expect(html).toContain('@bob');
      expect(html).toContain('Auth Service Spec');
      expect(html).toContain('@charlie');

      // Diff elements
      expect(html).toContain('timeout: 5s');
      expect(html).toContain('timeout: 15s');
      expect(html).toContain('algorithm: RS256');
      expect(html).toContain('algorithm: EdDSA');

      // Status badges
      expect(html).toContain('ACCEPTED');
      expect(html).toContain('PENDING');

      // ACK button for accepted suggestion
      expect(html).toContain('ACK');
      expect(html).toContain('ACK All');
    });

    it('renders empty state when there are no suggestions', () => {
      queryClient.setQueryData(['all-suggestions', 'active'], []);

      const html = renderToStaticMarkup(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter>
            <SuggestionsDashboardView />
          </MemoryRouter>
        </QueryClientProvider>
      );

      expect(html).toContain('No Suggestions Found');
      expect(html).toContain('All caught up! No pending or unacknowledged suggestions.');
    });
  });

  describe('TaskDashboardPage with Comments and Suggestions tabs', () => {
    it('renders tab switcher buttons for Tasks, Mentions, Comments, and Suggestions with badges', () => {
      queryClient.setQueryData(['all-tasks'], []);
      queryClient.setQueryData(['mentions-count'], { unread_count: 5 });
      queryClient.setQueryData(['comments-count'], { unacknowledged_count: 4 });
      queryClient.setQueryData(['suggestions-count'], { unacknowledged_count: 2 });

      const html = renderToStaticMarkup(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={['/comments']}>
            <TaskDashboardPage initialTab="comments" />
          </MemoryRouter>
        </QueryClientProvider>
      );

      // Section switcher buttons
      expect(html).toContain('data-testid="dashboard-tab-tasks"');
      expect(html).toContain('data-testid="dashboard-tab-mentions"');
      expect(html).toContain('data-testid="dashboard-tab-comments"');
      expect(html).toContain('data-testid="dashboard-tab-suggestions"');

      // Badges
      expect(html).toContain('data-testid="dashboard-tab-comments-badge"');
      expect(html).toContain('data-testid="dashboard-tab-suggestions-badge"');
      expect(html).toContain('>4</span>');
      expect(html).toContain('>2</span>');

      // Comments view active
      expect(html).toContain('Comment threads you participated in, ordered by last activity');
    });

    it('renders Suggestions view when initialTab is suggestions', () => {
      queryClient.setQueryData(['all-tasks'], []);
      queryClient.setQueryData(['all-suggestions', 'active'], mockSuggestions);

      const html = renderToStaticMarkup(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={['/suggestions']}>
            <TaskDashboardPage initialTab="suggestions" />
          </MemoryRouter>
        </QueryClientProvider>
      );

      expect(html).toContain('Inline edit suggestions across documents, ordered by date');
      expect(html).toContain('API Gateway Config');
      expect(html).toContain('timeout: 15s');
    });

    it('renders Dashboard title, markdown and review tasks with badges and line numbers', () => {
      const mockDashboardTasks: TaskRecord[] = [
        {
          id: 't-1',
          document_id: 'doc-1',
          document_title: 'API Gateway Config',
          document_path: 'configs/gateway.md',
          comment_id: null,
          description: 'Ship caching implementation',
          is_completed: false,
          due_date: '2026-11-20',
          created_at: '2026-11-05T10:00:00Z',
          source: 'markdown',
          line_number: 14,
        },
        {
          id: 't-2',
          document_id: 'doc-1',
          document_title: 'API Gateway Config',
          document_path: 'configs/gateway.md',
          comment_id: 'c-1',
          description: 'Review security audit comments',
          is_completed: true,
          due_date: null,
          created_at: '2026-11-05T10:00:00Z',
          completed_at: '2026-11-05T12:00:00Z',
          source: 'review',
        },
      ];

      queryClient.setQueryData(['all-tasks'], mockDashboardTasks);

      const html = renderToStaticMarkup(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={['/tasks']}>
            <TaskDashboardPage initialTab="tasks" />
          </MemoryRouter>
        </QueryClientProvider>
      );

      // Dashboard Header
      expect(html).toContain('Dashboard');
      expect(html).toContain('Centralized action items, mentions, comments, and suggestions across your workspaces');

      // Task items & badges
      expect(html).toContain('Ship caching implementation');
      expect(html).toContain('data-testid="task-source-markdown-badge"');
      expect(html).toContain('Markdown');
      expect(html).toContain('Line 14');

      expect(html).toContain('Review security audit comments');
      expect(html).toContain('data-testid="task-source-review-badge"');
      expect(html).toContain('Review');
    });
  });

  describe('Sidebar navigation with Dashboard and unread mentions badge', () => {
    it('renders Dashboard link with unread mentions count badge in the left sidebar', () => {
      queryClient.setQueryData(['mentions-count'], { unread_count: 5 });

      const html = renderToStaticMarkup(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={['/']}>
            <Sidebar />
          </MemoryRouter>
        </QueryClientProvider>
      );

      // Dashboard link and unread count badge
      expect(html).toContain('data-testid="sidebar-tasks-link"');
      expect(html).toContain('Dashboard');
      expect(html).toContain('data-testid="sidebar-dashboard-unread-badge"');
      expect(html).toContain('>5</span>');

      // Comments, suggestions, and mentions are removed from left sidebar
      expect(html).not.toContain('data-testid="sidebar-comments-link"');
      expect(html).not.toContain('data-testid="sidebar-suggestions-link"');
      expect(html).not.toContain('data-testid="sidebar-mentions-link"');
    });

    it('does not render unread badge when unread mentions count is 0', () => {
      queryClient.setQueryData(['mentions-count'], { unread_count: 0 });

      const html = renderToStaticMarkup(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={['/']}>
            <Sidebar />
          </MemoryRouter>
        </QueryClientProvider>
      );

      expect(html).toContain('data-testid="sidebar-tasks-link"');
      expect(html).toContain('Dashboard');
      expect(html).not.toContain('data-testid="sidebar-dashboard-unread-badge"');
    });
  });
});
