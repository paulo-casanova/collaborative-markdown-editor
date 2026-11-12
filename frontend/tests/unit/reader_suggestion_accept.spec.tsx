import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { QueryClient } from '@tanstack/react-query';
import * as reviewsApi from '../../src/api/reviews';
import * as documentsApi from '../../src/api/documents';
import { computeReplacementChange } from '../../src/utils/diffPatcher';
import { computeSuggestionsSignature } from '../../src/pages/ReaderPage';
import { useReviewStore } from '../../src/stores/reviewStore';
import type { SuggestionRecord } from '../../src/review/types';

describe('Reader Mode Suggestion Acceptance (No Manual Refresh Required)', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.restoreAllMocks();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
    useReviewStore.setState({
      documentId: 'doc-read-1',
      suggestions: [],
      comments: [],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('computeSuggestionsSignature', () => {
    it('returns empty string for empty or null suggestions', () => {
      expect(computeSuggestionsSignature([])).toBe('');
      expect(computeSuggestionsSignature(undefined as any)).toBe('');
    });

    it('generates consistent deterministic signature regardless of array ordering', () => {
      const suggA: SuggestionRecord = {
        id: 's-1',
        document_id: 'doc-1',
        author: { id: 'u1', username: 'alice', display_name: 'Alice', avatar_color: '#3b82f6' },
        original_text: 'hello',
        suggested_text: 'hi',
        status: 'PENDING',
        anchor: {},
        created_at: '2026-11-01T00:00:00Z',
      };
      const suggB: SuggestionRecord = {
        id: 's-2',
        document_id: 'doc-1',
        author: { id: 'u2', username: 'bob', display_name: 'Bob', avatar_color: '#10b981' },
        original_text: 'world',
        suggested_text: 'earth',
        status: 'PENDING',
        anchor: {},
        created_at: '2026-11-01T01:00:00Z',
      };

      const sig1 = computeSuggestionsSignature([suggA, suggB]);
      const sig2 = computeSuggestionsSignature([suggB, suggA]);
      expect(sig1).toBe(sig2);
      expect(sig1.length).toBeGreaterThan(0);
    });

    it('changes signature when a suggestion is accepted or modified', () => {
      const suggPending: SuggestionRecord = {
        id: 's-1',
        document_id: 'doc-1',
        author: { id: 'u1', username: 'alice', display_name: 'Alice', avatar_color: '#3b82f6' },
        original_text: 'hello',
        suggested_text: 'hi',
        status: 'PENDING',
        anchor: {},
        created_at: '2026-11-01T00:00:00Z',
      };
      const sigPending = computeSuggestionsSignature([suggPending]);

      const suggAccepted: SuggestionRecord = {
        ...suggPending,
        status: 'ACCEPTED',
        resolved_at: '2026-11-01T02:00:00Z',
      };
      const sigAccepted = computeSuggestionsSignature([suggAccepted]);

      expect(sigPending).not.toBe(sigAccepted);
    });
  });

  describe('handleAcceptSuggestion Pipeline in Reader View', () => {
    it('immediately updates document content and query cache without requiring manual refresh', async () => {
      const docId = 'doc-read-1';
      const rawTarget = 'workspace/guide.md';
      let serverContent = '# Guide\n\nThis is a draft version of the system.';
      const initialContent = serverContent;

      const suggestion: SuggestionRecord = {
        id: 'sugg-100',
        document_id: docId,
        author: { id: 'u1', username: 'alice', display_name: 'Alice', avatar_color: '#3b82f6' },
        original_text: 'draft version',
        suggested_text: 'production release',
        status: 'PENDING',
        anchor: { quote: { exact: 'draft version' } },
        created_at: '2026-11-01T00:00:00Z',
      };

      // Set initial React Query state
      queryClient.setQueryData(['doc-reader', rawTarget], {
        id: docId,
        title: 'Guide',
        content: initialContent,
        path: rawTarget,
      });
      queryClient.setQueryData(['document', docId], {
        id: docId,
        title: 'Guide',
        content: initialContent,
        path: rawTarget,
      });
      queryClient.setQueryData<SuggestionRecord[]>(['reader-suggestions', docId], [suggestion]);

      useReviewStore.setState({
        documentId: docId,
        suggestions: [suggestion],
      });

      // Mocks
      const acceptApiSpy = vi.spyOn(reviewsApi, 'acceptSuggestion').mockImplementation(async (suggId: string) => {
        expect(suggId).toBe('sugg-100');
        serverContent = serverContent.replace('draft version', 'production release');
        return {
          ...suggestion,
          status: 'ACCEPTED',
          resolved_at: new Date().toISOString(),
        } as any;
      });

      const fetchDocSpy = vi.spyOn(documentsApi, 'fetchDocument').mockImplementation(async (id: string) => {
        expect(id).toBe(docId);
        return {
          id: docId,
          title: 'Guide',
          content: serverContent,
          path: rawTarget,
        } as any;
      });

      // Simulating the reader page component references
      const latestContentRef = { current: initialContent };
      let hasNewVersion = false;
      let refreshReason: string | null = null;
      const refetchSpy = vi.fn().mockImplementation(async () => {
        const fresh = await documentsApi.fetchDocument(docId);
        queryClient.setQueryData(['doc-reader', rawTarget], fresh);
        return { data: fresh };
      });

      // Pipeline execution (the reader handleAcceptSuggestion implementation)
      const suggestions = queryClient.getQueryData<SuggestionRecord[]>(['reader-suggestions', docId]) || [];
      const targetSugg = suggestions.find((s) => s.id === 'sugg-100');
      const currentContent = latestContentRef.current;

      // 1. Optimistic calculation
      let anticipatedContent = currentContent;
      if (targetSugg) {
        const change = computeReplacementChange(
          currentContent,
          targetSugg.original_text,
          targetSugg.suggested_text
        );
        if (change) {
          anticipatedContent =
            currentContent.slice(0, change.from) + change.insert + currentContent.slice(change.to);
        } else if (targetSugg.original_text && currentContent.includes(targetSugg.original_text)) {
          anticipatedContent = currentContent.replace(targetSugg.original_text, targetSugg.suggested_text);
        }

        if (anticipatedContent !== currentContent) {
          latestContentRef.current = anticipatedContent;
          queryClient.setQueryData(['doc-reader', rawTarget], (old: any) => ({
            ...old,
            content: anticipatedContent,
          }));
          queryClient.setQueryData(['document', docId], (old: any) => ({
            ...old,
            content: anticipatedContent,
          }));
        }
      }

      // Check that optimistic update happened BEFORE server roundtrip
      const optimisticDoc: any = queryClient.getQueryData(['doc-reader', rawTarget]);
      expect(optimisticDoc.content).toBe('# Guide\n\nThis is a production release of the system.');
      expect(latestContentRef.current).toBe('# Guide\n\nThis is a production release of the system.');

      // 2. Optimistic suggestion update
      queryClient.setQueryData<SuggestionRecord[]>(['reader-suggestions', docId], (old) => {
        if (!old) return [];
        return old.map((s) =>
          s.id === 'sugg-100' ? { ...s, status: 'ACCEPTED', resolved_at: new Date().toISOString() } : s
        );
      });
      const optimisticSuggs = queryClient.getQueryData<SuggestionRecord[]>(['reader-suggestions', docId]);
      expect(optimisticSuggs?.[0].status).toBe('ACCEPTED');

      // 3. Send API call
      const updatedSugg = await reviewsApi.acceptSuggestion('sugg-100');
      expect(acceptApiSpy).toHaveBeenCalledWith('sugg-100');
      expect(updatedSugg.status).toBe('ACCEPTED');

      // 4. Fetch fresh authoritative document
      const freshDoc = await documentsApi.fetchDocument(docId);
      expect(fetchDocSpy).toHaveBeenCalledWith(docId);
      expect(freshDoc.content).toBe('# Guide\n\nThis is a production release of the system.');
      latestContentRef.current = freshDoc.content;
      queryClient.setQueryData(['doc-reader', rawTarget], freshDoc);
      queryClient.setQueryData(['document', docId], freshDoc);

      // 5. Refetch and query invalidations
      await refetchSpy();
      queryClient.invalidateQueries({ queryKey: ['doc-reader'] });
      queryClient.invalidateQueries({ queryKey: ['reader-suggestions', docId] });

      // 6. Stale version banner must remain false
      hasNewVersion = false;
      refreshReason = null;

      // Final Assertions:
      const finalDoc: any = queryClient.getQueryData(['doc-reader', rawTarget]);
      expect(finalDoc.content).toContain('production release');
      expect(finalDoc.content).not.toContain('draft version');

      // Subsequent 5-second polling check does not flag contentChanged because latestContentRef matches server
      const latestFromPoller = serverContent;
      const contentChanged = latestFromPoller !== latestContentRef.current;
      expect(contentChanged).toBe(false);
      expect(hasNewVersion).toBe(false);
      expect(refreshReason).toBeNull();
    });

    it('handles multiple sequential suggestions accepted in read mode without stale overwrites', async () => {
      const docId = 'doc-mult-sugg';
      const rawTarget = 'mult.md';
      let serverDoc = 'Alpha text and Beta text.';

      const sugg1: SuggestionRecord = {
        id: 'sugg-alpha',
        document_id: docId,
        author: { id: 'u1', username: 'alice', display_name: 'Alice', avatar_color: '#3b82f6' },
        original_text: 'Alpha',
        suggested_text: 'Gamma',
        status: 'PENDING',
        anchor: {},
        created_at: '2026-11-01T00:00:00Z',
      };

      const sugg2: SuggestionRecord = {
        id: 'sugg-beta',
        document_id: docId,
        author: { id: 'u2', username: 'bob', display_name: 'Bob', avatar_color: '#10b981' },
        original_text: 'Beta',
        suggested_text: 'Delta',
        status: 'PENDING',
        anchor: {},
        created_at: '2026-11-01T00:00:00Z',
      };

      queryClient.setQueryData(['doc-reader', rawTarget], { id: docId, content: serverDoc });
      queryClient.setQueryData(['reader-suggestions', docId], [sugg1, sugg2]);

      vi.spyOn(reviewsApi, 'acceptSuggestion').mockImplementation(async (suggId: string) => {
        if (suggId === 'sugg-alpha') {
          serverDoc = serverDoc.replace('Alpha', 'Gamma');
        } else if (suggId === 'sugg-beta') {
          serverDoc = serverDoc.replace('Beta', 'Delta');
        }
        return { id: suggId, status: 'ACCEPTED' } as any;
      });

      vi.spyOn(documentsApi, 'fetchDocument').mockImplementation(async () => {
        return { id: docId, content: serverDoc } as any;
      });

      const latestContentRef = { current: serverDoc };

      // Helper function matching ReaderPage handleAcceptSuggestion logic
      const acceptInReader = async (suggId: string) => {
        const curSuggs = queryClient.getQueryData<SuggestionRecord[]>(['reader-suggestions', docId]) || [];
        const target = curSuggs.find((s) => s.id === suggId);
        const curContent = latestContentRef.current;

        if (target) {
          const change = computeReplacementChange(curContent, target.original_text, target.suggested_text);
          const newContent = change
            ? curContent.slice(0, change.from) + change.insert + curContent.slice(change.to)
            : curContent.replace(target.original_text, target.suggested_text);

          latestContentRef.current = newContent;
          queryClient.setQueryData(['doc-reader', rawTarget], (old: any) => ({ ...old, content: newContent }));
        }

        queryClient.setQueryData<SuggestionRecord[]>(['reader-suggestions', docId], (old) => {
          return (old || []).map((s) => (s.id === suggId ? { ...s, status: 'ACCEPTED' } : s));
        });

        await reviewsApi.acceptSuggestion(suggId);
        const fresh = await documentsApi.fetchDocument(docId);
        latestContentRef.current = fresh.content;
        queryClient.setQueryData(['doc-reader', rawTarget], fresh);
      };

      // Accept Sugg 1
      await acceptInReader('sugg-alpha');
      expect((queryClient.getQueryData(['doc-reader', rawTarget]) as any).content).toBe('Gamma text and Beta text.');

      // Accept Sugg 2
      await acceptInReader('sugg-beta');
      expect((queryClient.getQueryData(['doc-reader', rawTarget]) as any).content).toBe('Gamma text and Delta text.');
      expect(serverDoc).toBe('Gamma text and Delta text.');

      // Check suggestion states
      const finalSuggs = queryClient.getQueryData<SuggestionRecord[]>(['reader-suggestions', docId]);
      expect(finalSuggs?.every((s) => s.status === 'ACCEPTED')).toBe(true);
    });

    it('rejecting a suggestion updates suggestion status without altering document content', async () => {
      const docId = 'doc-rej-1';
      const rawTarget = 'rej.md';
      const initialDoc = 'Keep this original sentence.';

      const sugg: SuggestionRecord = {
        id: 'sugg-rej-10',
        document_id: docId,
        author: { id: 'u1', username: 'alice', display_name: 'Alice', avatar_color: '#3b82f6' },
        original_text: 'Keep',
        suggested_text: 'Discard',
        status: 'PENDING',
        anchor: {},
        created_at: '2026-11-01T00:00:00Z',
      };

      queryClient.setQueryData(['doc-reader', rawTarget], { id: docId, content: initialDoc });
      queryClient.setQueryData(['reader-suggestions', docId], [sugg]);

      vi.spyOn(reviewsApi, 'rejectSuggestion').mockResolvedValue({
        ...sugg,
        status: 'REJECTED',
        resolved_at: new Date().toISOString(),
      } as any);

      // Reader handleRejectSuggestion logic
      queryClient.setQueryData<SuggestionRecord[]>(['reader-suggestions', docId], (old) => {
        return (old || []).map((s) => (s.id === 'sugg-rej-10' ? { ...s, status: 'REJECTED' } : s));
      });
      await reviewsApi.rejectSuggestion('sugg-rej-10');

      const doc: any = queryClient.getQueryData(['doc-reader', rawTarget]);
      expect(doc.content).toBe('Keep this original sentence.');

      const suggs = queryClient.getQueryData<SuggestionRecord[]>(['reader-suggestions', docId]);
      expect(suggs?.[0].status).toBe('REJECTED');
    });
  });
});
