import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { MentionsView } from '../../src/components/mentions/MentionsView';
import * as mentionsApi from '../../src/api/mentions';
import { mentionCompletionSource } from '../../src/components/editor/codemirror/mentionAutocomplete';

vi.mock('../../src/api/mentions', () => ({
  fetchMentions: vi.fn(),
  fetchUnreadMentionsCount: vi.fn(),
  acknowledgeMention: vi.fn(),
  acknowledgeAllMentions: vi.fn(),
  fetchMentionCandidates: vi.fn(),
}));

describe('MentionsView & Mentions Autocomplete', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
  });

  const mockMentionsData: mentionsApi.MentionsListResponse = {
    unread_count: 2,
    mentions: [
      {
        id: 'mention-1',
        document_id: 'doc-uuid-1',
        document_title: 'Release Roadmap',
        document_path: 'plans/release.md',
        recipient_id: 'user-bob',
        author_id: 'user-alice',
        author_username: 'alice',
        heading_anchor: 'q4-milestones',
        context_snippet: 'Please verify the launch checklist @bob before Friday.',
        fingerprint: 'fp-1',
        status: 'UNREAD',
        is_active: true,
        created_at: new Date(Date.now() - 3600000).toISOString(),
        acknowledged_at: null,
      },
      {
        id: 'mention-2',
        document_id: 'doc-uuid-2',
        document_title: 'Architecture Spec',
        document_path: 'specs/arch.md',
        recipient_id: 'user-bob',
        author_id: 'user-carol',
        author_username: 'carol',
        heading_anchor: 'security-review',
        context_snippet: 'CC @bob for security signoff.',
        fingerprint: 'fp-2',
        status: 'UNREAD',
        is_active: true,
        created_at: new Date(Date.now() - 7200000).toISOString(),
        acknowledged_at: null,
      },
    ],
  };

  it('renders mentions items, context snippets, heading anchors, and jump links', () => {
    // Pre-seed query cache
    queryClient.setQueryData(['mentions', 'UNREAD'], mockMentionsData);

    const html = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <MentionsView />
        </MemoryRouter>
      </QueryClientProvider>
    );

    // Verify unread count badge
    expect(html).toContain('Unread');
    expect(html).toContain('>2</span>');

    // Verify mention items
    expect(html).toContain('@alice');
    expect(html).toContain('Release Roadmap');
    expect(html).toContain('q4-milestones');
    expect(html).toContain('Please verify the launch checklist');

    expect(html).toContain('@carol');
    expect(html).toContain('Architecture Spec');
    expect(html).toContain('security-review');
    expect(html).toContain('@bob');
    expect(html).toContain('for security signoff.');

    // Verify jump href has document ID and heading anchor
    expect(html).toContain('href="/docs/doc-uuid-1#q4-milestones"');
    expect(html).toContain('href="/docs/doc-uuid-2#security-review"');

    // Verify action buttons
    expect(html).toContain('ACK');
    expect(html).toContain('Mark all read');
  });

  it('renders empty state when there are no unread mentions', () => {
    queryClient.setQueryData(['mentions', 'UNREAD'], { unread_count: 0, mentions: [] });

    const html = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <MentionsView />
        </MemoryRouter>
      </QueryClientProvider>
    );

    expect(html).toContain("You&#x27;re all caught up!");
  });

  it('mentionCompletionSource triggers on @ prefix and resolves candidates', async () => {
    vi.mocked(mentionsApi.fetchMentionCandidates).mockResolvedValue([
      { id: '1', username: 'alice', display_name: 'Alice Admin' },
      { id: '2', username: 'bob', display_name: 'Bob Reviewer' },
    ]);

    // Test 1: Valid mention "@ali" after space
    const mockContextValid: any = {
      matchBefore: (regex: RegExp) => {
        const text = 'Hello @ali';
        const match = regex.exec(text);
        return match ? { from: 6, to: 10, text: '@ali' } : null;
      },
      state: {
        doc: {
          sliceString: (from: number, to: number) => 'Hello @ali'.slice(from, to),
        },
      },
    };

    const resValid = await mentionCompletionSource(mockContextValid);
    expect(resValid).not.toBeNull();
    expect(resValid?.options).toHaveLength(2);
    expect(resValid?.options[0].label).toBe('@alice');
    expect(resValid?.options[0].apply).toBe('@alice ');
    expect(resValid?.options[0].displayLabel).toBe('Alice Admin (@alice)');
  });

  it('mentionCompletionSource suppresses completion inside email addresses', async () => {
    // Inside email "contact@ali"
    const mockContextEmail: any = {
      matchBefore: (regex: RegExp) => {
        const text = 'contact@ali';
        const match = regex.exec(text);
        return match ? { from: 7, to: 11, text: '@ali' } : null;
      },
      state: {
        doc: {
          sliceString: (from: number, to: number) => 'contact@ali'.slice(from, to),
        },
      },
    };

    const resEmail = await mentionCompletionSource(mockContextEmail);
    expect(resEmail).toBeNull();
  });
});
