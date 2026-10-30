import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AssigneeAutocomplete, UserOption } from '../../src/components/review/AssigneeAutocomplete';

describe('AssigneeAutocomplete Component', () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  const sampleCollaborators: UserOption[] = [
    { id: 'u-1', username: 'alice', display_name: 'Alice Developer' },
    { id: 'u-2', username: 'bob', display_name: 'Bob Architect' },
    { id: 'u-3', username: 'carol', display_name: 'Carol DevOps' },
  ];

  it('renders unassigned placeholder and hidden select by default', () => {
    const html = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <AssigneeAutocomplete
          value=""
          onChange={vi.fn()}
          collaborators={sampleCollaborators}
          testId="task-assignee-select"
        />
      </QueryClientProvider>
    );

    expect(html).toContain('data-testid="task-assignee-select"');
    expect(html).toContain('data-testid="task-assignee-select-input"');
    expect(html).toContain('placeholder="Type to search user or @username..."');
    expect(html).toContain('Unassigned');
    expect(html).toContain('Alice Developer (@alice)');
    expect(html).toContain('Bob Architect (@bob)');
    expect(html).toContain('Carol DevOps (@carol)');
  });

  it('renders selected user name and clear button when value is provided', () => {
    const html = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <AssigneeAutocomplete
          value="u-2"
          onChange={vi.fn()}
          collaborators={sampleCollaborators}
          testId="task-assignee-select"
        />
      </QueryClientProvider>
    );

    expect(html).toContain('data-testid="task-assignee-select-clear-btn"');
    expect(html).toContain('Bob Architect (@bob)');
  });

  it('renders initialUser even if not in collaborators list', () => {
    const customUser: UserOption = {
      id: 'u-99',
      username: 'daniel',
      display_name: 'Daniel Specialist',
    };

    const html = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <AssigneeAutocomplete
          value="u-99"
          onChange={vi.fn()}
          initialUser={customUser}
          collaborators={sampleCollaborators}
          testId="edit-task-assignee-select"
        />
      </QueryClientProvider>
    );

    expect(html).toContain('data-testid="edit-task-assignee-select"');
    expect(html).toContain('Daniel Specialist (@daniel)');
  });
});
