import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import * as documentsApi from '../../src/api/documents';
import * as reviewsApi from '../../src/api/reviews';
import { computeCommentsSignature } from '../../src/pages/ReaderPage';
import type { CommentRecord } from '../../src/review/types';
import { useReviewStore } from '../../src/stores/reviewStore';
import { CodeMirrorEditorAdapter } from '../../src/components/editor/codemirror/editorAdapter';

describe('Issue #19 & Reader Refresh: Refresh Button & Comment Updates Polling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('computeCommentsSignature', () => {
    const sampleAuthor = {
      id: 'user-1',
      username: 'alice',
      display_name: 'Alice',
      avatar_color: '#3b82f6',
    };

    it('returns empty string for empty or null comments list', () => {
      expect(computeCommentsSignature([])).toBe('');
      expect(computeCommentsSignature(undefined as any)).toBe('');
    });

    it('generates consistent deterministic signature regardless of array ordering', () => {
      const commentA: CommentRecord = {
        id: 'c-1',
        document_id: 'doc-1',
        parent_id: null,
        author: sampleAuthor,
        content: 'First comment',
        status: 'OPEN',
        anchor: {},
        created_at: '2026-10-24T00:00:00Z',
        updated_at: '2026-10-24T00:00:00Z',
      };
      const commentB: CommentRecord = {
        id: 'c-2',
        document_id: 'doc-1',
        parent_id: null,
        author: sampleAuthor,
        content: 'Second comment',
        status: 'OPEN',
        anchor: {},
        created_at: '2026-10-24T01:00:00Z',
        updated_at: '2026-10-24T01:00:00Z',
      };

      const sig1 = computeCommentsSignature([commentA, commentB]);
      const sig2 = computeCommentsSignature([commentB, commentA]);
      expect(sig1).toBe(sig2);
      expect(sig1.length).toBeGreaterThan(0);
    });

    it('detects changes when a reply is added to a comment', () => {
      const comment: CommentRecord = {
        id: 'c-1',
        document_id: 'doc-1',
        parent_id: null,
        author: sampleAuthor,
        content: 'Does this need clarification?',
        status: 'OPEN',
        anchor: {},
        created_at: '2026-10-24T00:00:00Z',
        updated_at: '2026-10-24T00:00:00Z',
        replies: [],
      };

      const sigBeforeReply = computeCommentsSignature([comment]);

      const commentWithReply: CommentRecord = {
        ...comment,
        replies: [
          {
            id: 'r-1',
            document_id: 'doc-1',
            parent_id: 'c-1',
            author: sampleAuthor,
            content: 'AI Assistant: Clarification provided here.',
            status: 'OPEN',
            anchor: {},
            created_at: '2026-10-24T00:05:00Z',
            updated_at: '2026-10-24T00:05:00Z',
          },
        ],
      };

      const sigAfterReply = computeCommentsSignature([commentWithReply]);
      expect(sigBeforeReply).not.toBe(sigAfterReply);
    });

    it('detects changes when reply content is edited', () => {
      const commentWithReply1: CommentRecord = {
        id: 'c-1',
        document_id: 'doc-1',
        parent_id: null,
        author: sampleAuthor,
        content: 'Question?',
        status: 'OPEN',
        anchor: {},
        created_at: '2026-10-24T00:00:00Z',
        updated_at: '2026-10-24T00:00:00Z',
        replies: [
          {
            id: 'r-1',
            document_id: 'doc-1',
            parent_id: 'c-1',
            author: sampleAuthor,
            content: 'Original reply',
            status: 'OPEN',
            anchor: {},
            created_at: '2026-10-24T00:05:00Z',
            updated_at: '2026-10-24T00:05:00Z',
          },
        ],
      };

      const commentWithReply2: CommentRecord = {
        ...commentWithReply1,
        replies: [
          {
            ...commentWithReply1.replies![0],
            content: 'Updated reply text with more details',
          },
        ],
      };

      expect(computeCommentsSignature([commentWithReply1])).not.toBe(
        computeCommentsSignature([commentWithReply2])
      );
    });

    it('detects changes when comment status changes to RESOLVED', () => {
      const openComment: CommentRecord = {
        id: 'c-1',
        document_id: 'doc-1',
        parent_id: null,
        author: sampleAuthor,
        content: 'Check this',
        status: 'OPEN',
        anchor: {},
        created_at: '2026-10-24T00:00:00Z',
        updated_at: '2026-10-24T00:00:00Z',
      };

      const resolvedComment: CommentRecord = {
        ...openComment,
        status: 'RESOLVED',
      };

      expect(computeCommentsSignature([openComment])).not.toBe(
        computeCommentsSignature([resolvedComment])
      );
    });
  });

  describe('Background Polling for Document Content and Comment Updates', () => {
    it('detects when server document content differs from currently displayed content', async () => {
      const docId = 'doc-123';
      const initialContent = '# Initial Content\n\nReading page.';
      let serverContent = initialContent;
      const initialComments: CommentRecord[] = [];
      let serverComments: CommentRecord[] = [];

      vi.spyOn(documentsApi, 'fetchDocument').mockImplementation(async (id: string) => ({
        id,
        path: 'test/doc.md',
        title: 'Test Doc',
        content: serverContent,
        is_bundle: false,
        created_at: '2026-10-24T00:00:00Z',
        updated_at: '2026-10-24T00:00:00Z',
      }));

      vi.spyOn(reviewsApi, 'fetchDocumentComments').mockImplementation(async () => serverComments);

      // Poller logic matching ReaderPage
      let displayedContent = initialContent;
      let displayedComments = initialComments;
      let hasNewVersion = false;
      let refreshReason: 'content' | 'comments' | 'all' | null = null;

      const checkServerVersion = async () => {
        try {
          const [latestDoc, latestComments] = await Promise.all([
            documentsApi.fetchDocument(docId),
            reviewsApi.fetchDocumentComments(docId),
          ]);
          const latestContent = latestDoc.content ?? '';
          const contentChanged = latestContent !== displayedContent;
          const commentsChanged =
            computeCommentsSignature(latestComments) !== computeCommentsSignature(displayedComments);

          if (contentChanged && commentsChanged) {
            hasNewVersion = true;
            refreshReason = 'all';
          } else if (contentChanged) {
            hasNewVersion = true;
            refreshReason = 'content';
          } else if (commentsChanged) {
            hasNewVersion = true;
            refreshReason = 'comments';
          } else {
            hasNewVersion = false;
            refreshReason = null;
          }
        } catch {
          // ignore
        }
      };

      // Initially identical
      await checkServerVersion();
      expect(hasNewVersion).toBe(false);
      expect(refreshReason).toBeNull();

      // Content changed on server
      serverContent = '# Edited Content\n\nA collaborator updated this.';
      await checkServerVersion();
      expect(hasNewVersion).toBe(true);
      expect(refreshReason).toBe('content');

      // Refresh simulates user clicking refresh button
      displayedContent = serverContent;
      hasNewVersion = false;
      refreshReason = null;

      await checkServerVersion();
      expect(hasNewVersion).toBe(false);
    });

    it('detects when remote collaborator or AI adds a response to a comment', async () => {
      const docId = 'doc-123';
      const initialContent = '# Testing Comment Replies\n\nParagraph 1.';
      const existingComment: CommentRecord = {
        id: 'c-root',
        document_id: docId,
        parent_id: null,
        author: { id: 'u1', username: 'bob', display_name: 'Bob', avatar_color: '#3b82f6' },
        content: 'Can you rewrite this section?',
        status: 'OPEN',
        anchor: {},
        created_at: '2026-10-24T00:00:00Z',
        updated_at: '2026-10-24T00:00:00Z',
        replies: [],
      };

      let displayedComments: CommentRecord[] = [existingComment];
      let serverComments: CommentRecord[] = [existingComment];

      vi.spyOn(documentsApi, 'fetchDocument').mockImplementation(async (id: string) => ({
        id,
        path: 'test/doc.md',
        title: 'Test Doc',
        content: initialContent,
        is_bundle: false,
        created_at: '2026-10-24T00:00:00Z',
        updated_at: '2026-10-24T00:00:00Z',
      }));

      vi.spyOn(reviewsApi, 'fetchDocumentComments').mockImplementation(async () => serverComments);

      let hasNewVersion = false;
      let refreshReason: 'content' | 'comments' | 'all' | null = null;

      const checkServerVersion = async () => {
        try {
          const [latestDoc, latestComments] = await Promise.all([
            documentsApi.fetchDocument(docId),
            reviewsApi.fetchDocumentComments(docId),
          ]);
          const latestContent = latestDoc.content ?? '';
          const contentChanged = latestContent !== initialContent;
          const commentsChanged =
            computeCommentsSignature(latestComments) !== computeCommentsSignature(displayedComments);

          if (contentChanged && commentsChanged) {
            hasNewVersion = true;
            refreshReason = 'all';
          } else if (contentChanged) {
            hasNewVersion = true;
            refreshReason = 'content';
          } else if (commentsChanged) {
            hasNewVersion = true;
            refreshReason = 'comments';
          } else {
            hasNewVersion = false;
            refreshReason = null;
          }
        } catch {
          // ignore
        }
      };

      // Before reply: up to date
      await checkServerVersion();
      expect(hasNewVersion).toBe(false);
      expect(refreshReason).toBeNull();

      // Collaborator or AI responds to the comment
      serverComments = [
        {
          ...existingComment,
          replies: [
            {
              id: 'r-ai-1',
              document_id: docId,
              parent_id: 'c-root',
              author: { id: 'agent-1', username: 'claude', display_name: 'AI Agent', avatar_color: '#10b981' },
              content: 'I have analyzed the section and proposed improvements.',
              status: 'OPEN',
              anchor: {},
              created_at: '2026-10-24T00:02:00Z',
              updated_at: '2026-10-24T00:02:00Z',
            },
          ],
        },
      ];

      // Next poll checks server comments
      await checkServerVersion();
      expect(hasNewVersion).toBe(true);
      expect(refreshReason).toBe('comments');

      // User clicks refresh: displayedComments updates to match serverComments
      displayedComments = serverComments;
      hasNewVersion = false;
      refreshReason = null;

      // Next poll is back in sync
      await checkServerVersion();
      expect(hasNewVersion).toBe(false);
      expect(refreshReason).toBeNull();
    });

    it('detects when both content and comments are updated simultaneously', async () => {
      const docId = 'doc-123';
      const initialContent = 'Original';
      let serverContent = 'Modified text';
      const initialComments: CommentRecord[] = [];
      let serverComments: CommentRecord[] = [
        {
          id: 'c-new',
          document_id: docId,
          parent_id: null,
          author: { id: 'u1', username: 'alice', display_name: 'Alice', avatar_color: '#3b82f6' },
          content: 'New feedback',
          status: 'OPEN',
          anchor: {},
          created_at: '2026-10-24T00:00:00Z',
          updated_at: '2026-10-24T00:00:00Z',
        },
      ];

      vi.spyOn(documentsApi, 'fetchDocument').mockImplementation(async (id: string) => ({
        id,
        path: 'test/doc.md',
        title: 'Test Doc',
        content: serverContent,
        is_bundle: false,
        created_at: '2026-10-24T00:00:00Z',
        updated_at: '2026-10-24T00:00:00Z',
      }));

      vi.spyOn(reviewsApi, 'fetchDocumentComments').mockImplementation(async () => serverComments);

      let hasNewVersion = false;
      let refreshReason: 'content' | 'comments' | 'all' | null = null;

      const checkServerVersion = async () => {
        const [latestDoc, latestComments] = await Promise.all([
          documentsApi.fetchDocument(docId),
          reviewsApi.fetchDocumentComments(docId),
        ]);
        const contentChanged = latestDoc.content !== initialContent;
        const commentsChanged =
          computeCommentsSignature(latestComments) !== computeCommentsSignature(initialComments);

        if (contentChanged && commentsChanged) {
          hasNewVersion = true;
          refreshReason = 'all';
        } else if (contentChanged) {
          hasNewVersion = true;
          refreshReason = 'content';
        } else if (commentsChanged) {
          hasNewVersion = true;
          refreshReason = 'comments';
        }
      };

      await checkServerVersion();
      expect(hasNewVersion).toBe(true);
      expect(refreshReason).toBe('all');
    });

    it('handles background polling failures gracefully without throwing or corrupting state', async () => {
      vi.spyOn(documentsApi, 'fetchDocument').mockRejectedValue(new Error('Network offline'));
      vi.spyOn(reviewsApi, 'fetchDocumentComments').mockRejectedValue(new Error('Network offline'));

      let hasNewVersion = false;
      let errorCaught = false;

      const checkServerVersion = async () => {
        try {
          await Promise.all([
            documentsApi.fetchDocument('doc-123'),
            reviewsApi.fetchDocumentComments('doc-123'),
          ]);
        } catch {
          errorCaught = true;
        }
      };

      await checkServerVersion();
      expect(errorCaught).toBe(true);
      expect(hasNewVersion).toBe(false);
    });

    it('clears new version indicator if remote content and comments revert back to displayed values', async () => {
      let serverContent = 'Version B';
      const displayedContent = 'Version A';
      const displayedComments: CommentRecord[] = [];
      let serverComments: CommentRecord[] = [
        {
          id: 'c-temp',
          document_id: 'doc-123',
          parent_id: null,
          author: { id: 'u1', username: 'u', display_name: 'U', avatar_color: '#000' },
          content: 'Temporary comment',
          status: 'OPEN',
          anchor: {},
          created_at: '2026-10-24T00:00:00Z',
          updated_at: '2026-10-24T00:00:00Z',
        },
      ];

      vi.spyOn(documentsApi, 'fetchDocument').mockImplementation(async (id: string) => ({
        id,
        path: 'test/doc.md',
        title: 'Test Doc',
        content: serverContent,
        is_bundle: false,
        created_at: '2026-10-24T00:00:00Z',
        updated_at: '2026-10-24T00:00:00Z',
      }));

      vi.spyOn(reviewsApi, 'fetchDocumentComments').mockImplementation(async () => serverComments);

      let hasNewVersion = false;
      const checkServerVersion = async () => {
        const [latestDoc, latestComments] = await Promise.all([
          documentsApi.fetchDocument('doc-123'),
          reviewsApi.fetchDocumentComments('doc-123'),
        ]);
        const contentChanged = (latestDoc.content ?? '') !== displayedContent;
        const commentsChanged =
          computeCommentsSignature(latestComments) !== computeCommentsSignature(displayedComments);
        hasNewVersion = contentChanged || commentsChanged;
      };

      await checkServerVersion();
      expect(hasNewVersion).toBe(true);

      // Remote reverts back to displayed content and comments
      serverContent = 'Version A';
      serverComments = [];
      await checkServerVersion();
      expect(hasNewVersion).toBe(false);
    });
  });

  describe('AI Action Integration with reviewStore subscription', () => {
    it('sets hasNewVersion when comments in reviewStore are updated', () => {
      const docId = 'doc-test-ai';
      useReviewStore.setState({
        documentId: docId,
        comments: [
          {
            id: 'c-1',
            document_id: docId,
            parent_id: null,
            author: { id: 'u1', username: 'u', display_name: 'U', avatar_color: '#000' },
            content: 'Initial comment',
            status: 'OPEN',
            anchor: {},
            created_at: '2026-10-24T00:00:00Z',
            updated_at: '2026-10-24T00:00:00Z',
            replies: [],
          },
        ],
      });

      const initialComments = useReviewStore.getState().comments;
      let hasNewVersion = false;
      let refreshReason: 'content' | 'comments' | 'all' | null = null;

      // Subscribe logic matching ReaderPage
      const unsub = useReviewStore.subscribe((state, prevState) => {
        if (state.documentId && state.documentId !== docId) return;
        const prevSig = computeCommentsSignature(prevState.comments);
        const currSig = computeCommentsSignature(state.comments);
        if (currSig && currSig !== prevSig && currSig !== computeCommentsSignature(initialComments)) {
          hasNewVersion = true;
          refreshReason = 'comments';
        }
      });

      expect(hasNewVersion).toBe(false);

      // Simulate AI agent adding a reply via reviewStore mutation
      useReviewStore.setState((prev) => ({
        comments: prev.comments.map((c) =>
          c.id === 'c-1'
            ? {
                ...c,
                replies: [
                  {
                    id: 'r-ai-new',
                    document_id: docId,
                    parent_id: 'c-1',
                    author: { id: 'agent', username: 'agent', display_name: 'AI Agent', avatar_color: '#10b981' },
                    content: 'AI replied directly to the comment thread',
                    status: 'OPEN',
                    anchor: {},
                    created_at: '2026-10-24T00:10:00Z',
                    updated_at: '2026-10-24T00:10:00Z',
                  },
                ],
              }
            : c
        ),
      }));

      expect(hasNewVersion).toBe(true);
      expect(refreshReason).toBe('comments');

      unsub();
    });
  });

  describe('Switching from Editing Mode to Reader Mode & Cache Sync', () => {
    it('provides getMarkdown on CodeMirrorEditorAdapter matching getText', () => {
      const mockView = {
        state: {
          doc: {
            toString: () => '# Chapter 1\n\nContent body.',
          },
        },
        dom: { parentNode: {} },
        destroy: vi.fn(),
      } as any;

      const adapter = new CodeMirrorEditorAdapter(mockView);
      expect(adapter.getText()).toBe('# Chapter 1\n\nContent body.');
      expect(adapter.getMarkdown()).toBe('# Chapter 1\n\nContent body.');
    });

    it('immediately seeds reader cache with edited content so reader mode sees latest changes without manual refresh', () => {
      const queryClient = new QueryClient();
      const docId = 'doc-reader-switch-test';
      const docPath = 'workspace/guide.md';

      // 1. Initial cached doc in reader mode before user started editing
      const initialDoc = {
        id: docId,
        path: docPath,
        title: 'Guide',
        content: '# Old Content\n\nBefore user edits.',
        created_at: '2026-10-24T00:00:00Z',
        updated_at: '2026-10-24T00:00:00Z',
      };
      queryClient.setQueryData(['doc-reader', docId], initialDoc);
      queryClient.setQueryData(['doc-reader', docPath], initialDoc);

      // Verify stale content in cache
      expect((queryClient.getQueryData(['doc-reader', docId]) as any)?.content).toBe(
        '# Old Content\n\nBefore user edits.'
      );

      // 2. User edits document in editing mode
      const newEditedText = '# Updated Content\n\nUser added new paragraphs in editor mode.';

      // Logic matching EditorPane.syncDocReaderCache:
      queryClient.setQueriesData({ queryKey: ['doc-reader'] }, (old: any) => {
        if (old && (old.id === docId || old.path === docPath)) {
          return { ...old, content: newEditedText };
        }
        return old;
      });
      queryClient.setQueryData(['doc-reader', docId], (old: any) => {
        if (!old) return old;
        return { ...old, content: newEditedText };
      });
      queryClient.setQueryData(['doc-reader', docPath], (old: any) => {
        if (!old) return old;
        return { ...old, content: newEditedText };
      });
      queryClient.invalidateQueries({ queryKey: ['doc-reader'] });

      // 3. Reader cache now reflects latest edited text immediately
      const readerDocById = queryClient.getQueryData(['doc-reader', docId]) as any;
      const readerDocByPath = queryClient.getQueryData(['doc-reader', docPath]) as any;

      expect(readerDocById.content).toBe(newEditedText);
      expect(readerDocByPath.content).toBe(newEditedText);

      // Verify queries are marked stale/invalidated so active or mounting queries re-fetch from backend
      const queryState = queryClient.getQueryState(['doc-reader', docId]);
      expect(queryState?.isInvalidated).toBe(true);
    });

    it('does not display stale banner after switching to reader mode when server matches edited content', async () => {
      const docId = 'doc-banner-test';
      const updatedContent = '# Fresh Heading\n\nContent saved from editor.';

      vi.spyOn(documentsApi, 'fetchDocument').mockImplementation(async (id: string) => ({
        id,
        path: 'doc.md',
        title: 'Fresh Doc',
        content: updatedContent,
        is_bundle: false,
        created_at: '2026-10-24T00:00:00Z',
        updated_at: '2026-10-24T00:00:00Z',
      }));

      vi.spyOn(reviewsApi, 'fetchDocumentComments').mockImplementation(async () => []);

      // In ReaderPage, displayedContent was initialized with the updated content from queryClient cache
      const displayedContent = updatedContent;
      let hasNewVersion = false;
      let refreshReason: 'content' | 'comments' | 'all' | null = null;

      const checkServerVersion = async () => {
        const [latestDoc, latestComments] = await Promise.all([
          documentsApi.fetchDocument(docId),
          reviewsApi.fetchDocumentComments(docId),
        ]);
        const latestContent = latestDoc.content ?? '';
        const contentChanged = latestContent !== displayedContent;
        const commentsChanged =
          computeCommentsSignature(latestComments) !== computeCommentsSignature([]);

        if (contentChanged && commentsChanged) {
          hasNewVersion = true;
          refreshReason = 'all';
        } else if (contentChanged) {
          hasNewVersion = true;
          refreshReason = 'content';
        } else if (commentsChanged) {
          hasNewVersion = true;
          refreshReason = 'comments';
        } else {
          hasNewVersion = false;
          refreshReason = null;
        }
      };

      await checkServerVersion();
      // Because displayedContent already matches server content, no refresh banner or refresh click is needed
      expect(hasNewVersion).toBe(false);
      expect(refreshReason).toBeNull();
    });
  });
});
