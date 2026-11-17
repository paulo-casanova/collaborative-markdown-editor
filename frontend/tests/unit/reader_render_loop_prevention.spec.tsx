import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useReviewStore } from '../../src/stores/reviewStore';
import type { CommentRecord, SuggestionRecord } from '../../src/review/types';

describe('ReaderPage review store synchronization and render loop prevention', () => {
  const sampleComment: CommentRecord = {
    id: 'c-test-1',
    document_id: 'doc-test',
    parent_id: null,
    author: { id: 'u1', username: 'alice', display_name: 'Alice', avatar_color: '#3b82f6' },
    content: 'Review comment',
    status: 'OPEN',
    anchor: {},
    created_at: '2026-11-01T00:00:00Z',
    replies: [],
  };

  const sampleSuggestion: SuggestionRecord = {
    id: 's-test-1',
    document_id: 'doc-test',
    author: { id: 'u2', username: 'bob', display_name: 'Bob', avatar_color: '#10b981' },
    original_text: 'old',
    suggested_text: 'new',
    status: 'PENDING',
    anchor: {},
    created_at: '2026-11-01T01:00:00Z',
  };

  beforeEach(() => {
    useReviewStore.setState({
      documentId: 'doc-test',
      comments: [],
      suggestions: [],
      tasks: [],
      isSidebarOpen: false,
    });
  });

  it('demonstrates that { data = [] } destructuring creates a new array reference on each render', () => {
    // When useQuery is loading or disabled, data is undefined
    const queryResult1: { data?: CommentRecord[] } = { data: undefined };
    const queryResult2: { data?: CommentRecord[] } = { data: undefined };

    // Destructuring with default array
    const { data: comments1 = [] } = queryResult1;
    const { data: comments2 = [] } = queryResult2;

    // In JS, [] !== []
    expect(comments1).not.toBe(comments2);
    expect(comments1).toEqual([]);
    expect(comments2).toEqual([]);

    // With module-level static EMPTY_COMMENTS fallback:
    const EMPTY_COMMENTS: CommentRecord[] = [];
    const fixedComments1 = queryResult1.data ?? EMPTY_COMMENTS;
    const fixedComments2 = queryResult2.data ?? EMPTY_COMMENTS;

    // Exact same reference preserved across renders
    expect(fixedComments1).toBe(fixedComments2);
    expect(fixedComments1).toBe(EMPTY_COMMENTS);
  });

  it('demonstrates that whole-store subscription re-renders on review mutations, whereas selectors do not', () => {
    let wholeStoreUpdates = 0;
    let selectorUpdates = 0;

    // 1. Whole-store subscription (like const { ... } = useReviewStore())
    const unsubWhole = useReviewStore.subscribe(() => {
      wholeStoreUpdates++;
    });

    // 2. Selector-based subscription (like useReviewStore((s) => s.isSidebarOpen))
    let currentSidebarOpen = useReviewStore.getState().isSidebarOpen;
    const unsubSelector = useReviewStore.subscribe((state) => {
      if (state.isSidebarOpen !== currentSidebarOpen) {
        currentSidebarOpen = state.isSidebarOpen;
        selectorUpdates++;
      }
    });

    // Mutating comments or suggestions:
    useReviewStore.setState({ comments: [sampleComment] });
    useReviewStore.setState({ suggestions: [sampleSuggestion] });

    // Whole-store subscriber was notified on every review mutation
    expect(wholeStoreUpdates).toBe(2);

    // Selector subscriber was NOT notified because isSidebarOpen did not change
    expect(selectorUpdates).toBe(0);

    // Toggling sidebar triggers selector subscriber
    useReviewStore.setState({ isSidebarOpen: true });
    expect(wholeStoreUpdates).toBe(3);
    expect(selectorUpdates).toBe(1);

    unsubWhole();
    unsubSelector();
  });

  it('demonstrates the infinite loop under the buggy pattern vs single render under the fixed pattern', () => {
    // --- BUGGY PATTERN SIMULATION ---
    // In buggy ReaderPage:
    // 1) const { data: comments = [] } = useQuery(...) produces a new [] on render
    // 2) useEffect sees a new comments ref, checks `if (comments)` (true for []), calls useReviewStore.setState({ comments })
    // 3) useReviewStore() with no selector forces ReaderPage to re-render
    // 4) Loop repeats until limit is reached
    let buggyRenders = 0;
    const MAX_LOOP_THRESHOLD = 50;
    let prevBuggyComments: any = null;

    const simulateBuggyComponentRender = () => {
      buggyRenders++;
      if (buggyRenders > MAX_LOOP_THRESHOLD) {
        return; // Break runaway loop
      }

      // Query data is still undefined
      const queryData = undefined;
      const comments = queryData ?? []; // New array instance each render

      // Effect:
      if (comments !== prevBuggyComments) {
        prevBuggyComments = comments;
        if (comments) {
          // Triggers store update:
          useReviewStore.setState({ comments });
          // Store update triggers re-render because component used useReviewStore() without selector:
          simulateBuggyComponentRender();
        }
      }
    };

    simulateBuggyComponentRender();
    expect(buggyRenders).toBeGreaterThan(MAX_LOOP_THRESHOLD);

    // --- FIXED PATTERN SIMULATION ---
    // 1) const { data: commentsData } = useQuery(...) -> undefined while loading
    // 2) const comments = commentsData ?? EMPTY_COMMENTS -> stable reference
    // 3) useEffect: only if (commentsData) -> does NOT call setState while undefined
    // 4) useReviewStore((s) => s.isSidebarOpen) -> does not subscribe to comments/suggestions
    let fixedRenders = 0;
    const EMPTY_COMMENTS: CommentRecord[] = [];
    let prevFixedCommentsData: any = undefined;

    const simulateFixedComponentRender = () => {
      fixedRenders++;

      // Query data is undefined while loading
      const commentsData: CommentRecord[] | undefined = undefined;
      const comments = commentsData ?? EMPTY_COMMENTS;

      // Effect only runs if commentsData changes and only updates store if defined:
      if (commentsData !== prevFixedCommentsData) {
        prevFixedCommentsData = commentsData;
        if (commentsData) {
          useReviewStore.setState({ comments: commentsData });
        }
      }
    };

    simulateFixedComponentRender();
    // Component renders once and stays completely stable!
    expect(fixedRenders).toBe(1);
    expect(useReviewStore.getState().comments).toEqual([]);
  });

  it('syncs to review store once when query data becomes defined with results', () => {
    let prevCommentsData: CommentRecord[] | undefined = undefined;
    let syncCallCount = 0;

    const simulateRenderWithQueryData = (data: CommentRecord[] | undefined) => {
      const commentsData = data;
      if (commentsData !== prevCommentsData) {
        prevCommentsData = commentsData;
        if (commentsData) {
          useReviewStore.setState({ comments: commentsData });
          syncCallCount++;
        }
      }
    };

    // Render 1: data undefined
    simulateRenderWithQueryData(undefined);
    expect(syncCallCount).toBe(0);

    // Render 2: data undefined again (e.g. parent re-render)
    simulateRenderWithQueryData(undefined);
    expect(syncCallCount).toBe(0);

    // Render 3: query finishes with [sampleComment]
    const serverComments = [sampleComment];
    simulateRenderWithQueryData(serverComments);
    expect(syncCallCount).toBe(1);
    expect(useReviewStore.getState().comments).toEqual([sampleComment]);

    // Render 4: same query data cached by React Query
    simulateRenderWithQueryData(serverComments);
    expect(syncCallCount).toBe(1); // No redundant store update!
  });
});
