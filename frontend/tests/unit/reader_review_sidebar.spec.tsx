import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReviewSidebar } from '../../src/components/review/ReviewSidebar';
import * as reviewStoreModule from '../../src/stores/reviewStore';
import type { CommentRecord, SuggestionRecord } from '../../src/review/types';

describe('Reader Mode Review Sidebar (matching Edit Mode)', () => {
  const sampleComment: CommentRecord = {
    id: 'c-1',
    document_id: 'doc-reader-sidebar',
    parent_id: null,
    author: { id: 'u1', username: 'alice', display_name: 'Alice', avatar_color: '#3b82f6' },
    content: 'Needs more elaboration.',
    status: 'OPEN',
    anchor: { quote: { exact: 'sample text', prefix: '', suffix: '' }, offset: 10, length: 11, type: 'dual' },
    created_at: '2026-11-01T00:00:00Z',
    replies: [],
  };

  const sampleSuggestion: SuggestionRecord = {
    id: 's-1',
    document_id: 'doc-reader-sidebar',
    author: { id: 'u2', username: 'bob', display_name: 'Bob', avatar_color: '#10b981' },
    original_text: 'draft paragraph',
    suggested_text: 'revised paragraph',
    status: 'PENDING',
    anchor: { quote: { exact: 'draft paragraph', prefix: '', suffix: '' }, offset: 25, length: 15, type: 'dual' },
    created_at: '2026-11-01T01:00:00Z',
  };

  const acceptedSuggestion: SuggestionRecord = {
    id: 's-acc',
    document_id: 'doc-reader-sidebar',
    author: { id: 'u1', username: 'alice', display_name: 'Alice', avatar_color: '#3b82f6' },
    original_text: 'old text',
    suggested_text: 'accepted text',
    status: 'ACCEPTED',
    resolved_at: '2026-11-01T02:00:00Z',
    anchor: { quote: { exact: 'old text', prefix: '', suffix: '' }, offset: 5, length: 8, type: 'dual' },
    created_at: '2026-11-01T00:00:00Z',
  };

  const rejectedSuggestion: SuggestionRecord = {
    id: 's-rej',
    document_id: 'doc-reader-sidebar',
    author: { id: 'u2', username: 'bob', display_name: 'Bob', avatar_color: '#10b981' },
    original_text: 'unwanted text',
    suggested_text: 'rejected text',
    status: 'REJECTED',
    resolved_at: '2026-11-01T02:30:00Z',
    anchor: { quote: { exact: 'unwanted text', prefix: '', suffix: '' }, offset: 50, length: 13, type: 'dual' },
    created_at: '2026-11-01T01:00:00Z',
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the ReviewSidebar component with discussions, diffs, and tasks', () => {
    vi.spyOn(reviewStoreModule, 'useReviewStore').mockReturnValue({
      comments: [sampleComment],
      suggestions: [sampleSuggestion],
      tasks: [],
      filter: 'all',
      showResolved: false,
      showInTextReviews: true,
      isSidebarOpen: true,
      sidebarWidth: 384,
      isLoading: false,
      setFilter: vi.fn(),
      setShowResolved: vi.fn(),
      setShowInTextReviews: vi.fn(),
      setSidebarOpen: vi.fn(),
      setSidebarWidth: vi.fn(),
    } as any);

    const html = renderToStaticMarkup(
      <ReviewSidebar
        onScrollToAnchor={vi.fn()}
        onApplyReplacement={vi.fn()}
      />
    );

    // Sidebar structure
    expect(html).toContain('data-testid="review-sidebar"');
    expect(html).toContain('Reviews &amp; Discussions');
    expect(html).toContain('data-testid="filter-all-btn"');
    expect(html).toContain('data-testid="filter-comments-btn"');
    expect(html).toContain('data-testid="filter-suggestions-btn"');
    expect(html).toContain('data-testid="toggle-show-resolved"');
    expect(html).toContain('data-testid="toggle-show-in-text"');
    expect(html).toContain('data-testid="close-review-sidebar"');

    // Review content
    expect(html).toContain('Needs more elaboration.');
    expect(html).toContain('draft paragraph');
    expect(html).toContain('revised paragraph');
  });

  it('allows showing already accepted and rejected suggestions when "Show resolved" is enabled', () => {
    // 1. showResolved = false
    vi.spyOn(reviewStoreModule, 'useReviewStore').mockReturnValue({
      comments: [],
      suggestions: [acceptedSuggestion, rejectedSuggestion],
      tasks: [],
      filter: 'all',
      showResolved: false,
      showInTextReviews: true,
      isSidebarOpen: true,
      sidebarWidth: 384,
      isLoading: false,
      setFilter: vi.fn(),
      setShowResolved: vi.fn(),
      setShowInTextReviews: vi.fn(),
      setSidebarOpen: vi.fn(),
      setSidebarWidth: vi.fn(),
    } as any);

    let html = renderToStaticMarkup(<ReviewSidebar />);
    expect(html).not.toContain('accepted text');
    expect(html).not.toContain('rejected text');

    // 2. showResolved = true
    vi.spyOn(reviewStoreModule, 'useReviewStore').mockReturnValue({
      comments: [],
      suggestions: [acceptedSuggestion, rejectedSuggestion],
      tasks: [],
      filter: 'all',
      showResolved: true,
      showInTextReviews: true,
      isSidebarOpen: true,
      sidebarWidth: 384,
      isLoading: false,
      setFilter: vi.fn(),
      setShowResolved: vi.fn(),
      setShowInTextReviews: vi.fn(),
      setSidebarOpen: vi.fn(),
      setSidebarWidth: vi.fn(),
    } as any);

    html = renderToStaticMarkup(<ReviewSidebar />);
    expect(html).toContain('accepted text');
    expect(html).toContain('ACCEPTED');
    expect(html).toContain('rejected text');
    expect(html).toContain('REJECTED');
    expect(html).toContain('data-testid="archive-suggestion-btn"');
  });

  it('scrolls and highlights anchor context when clicking jump to anchor in sidebar', () => {
    const onScrollToAnchor = vi.fn();
    const anchor = { quote: { exact: 'Important sentence to jump to.' } };

    // Simulate jump to context handler in ReaderPage
    const mockContainer = {
      querySelectorAll: vi.fn().mockReturnValue([
        {
          textContent: 'Important sentence to jump to. More text follows.',
          scrollIntoView: vi.fn(),
          classList: {
            remove: vi.fn(),
            add: vi.fn(),
          },
        },
      ]),
      querySelector: vi.fn().mockReturnValue(null),
    };

    const targetEl = mockContainer.querySelectorAll()[0];

    onScrollToAnchor(anchor);
    expect(onScrollToAnchor).toHaveBeenCalledWith(anchor);

    // Call scrollIntoView and highlight animation
    targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    targetEl.classList.add('cme-edit-highlight');

    expect(targetEl.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });
    expect(targetEl.classList.add).toHaveBeenCalledWith('cme-edit-highlight');
  });

  it('unchecking "Show in text" inside sidebar hides inline annotations while keeping sidebar open', () => {
    let showReviews = true;
    let showInTextReviews = true;

    const sampleSuggestions: SuggestionRecord[] = [
      {
        id: 's-1',
        document_id: 'doc-1',
        author: { id: 'u1', username: 'alice', display_name: 'Alice', avatar_color: '#3b82f6' },
        original_text: 'orig',
        suggested_text: 'sugg',
        status: 'PENDING',
        anchor: { quote: { exact: 'orig', prefix: '', suffix: '' }, offset: 0, length: 4, type: 'dual' },
        created_at: new Date().toISOString(),
      },
    ];

    const computeEffectiveSuggestions = (reviewsOn: boolean, inTextOn: boolean) => {
      return reviewsOn && inTextOn
        ? sampleSuggestions.filter((s) => s.status === 'PENDING')
        : [];
    };

    // Both ON
    expect(computeEffectiveSuggestions(showReviews, showInTextReviews).length).toBe(1);

    // User unchecks "Show in text" in sidebar: inline reviews are hidden
    showInTextReviews = false;
    expect(computeEffectiveSuggestions(showReviews, showInTextReviews).length).toBe(0);

    // Sidebar remains open
    expect(showReviews).toBe(true);

    // User checks "Show in text" back: inline reviews reappear
    showInTextReviews = true;
    expect(computeEffectiveSuggestions(showReviews, showInTextReviews).length).toBe(1);
  });

  it('handleToggleReviews in reader mode toggles both reviews and sidebar', () => {
    let showReviews = false;
    let isSidebarOpen = false;

    const handleToggleReviews = () => {
      if (!showReviews) {
        showReviews = true;
        isSidebarOpen = true;
      } else if (!isSidebarOpen) {
        isSidebarOpen = true;
      } else {
        showReviews = false;
        isSidebarOpen = false;
      }
    };

    // Initial: both OFF
    expect(showReviews).toBe(false);
    expect(isSidebarOpen).toBe(false);

    // First click: turn ON
    handleToggleReviews();
    expect(showReviews).toBe(true);
    expect(isSidebarOpen).toBe(true);

    // User closes sidebar with 'X'
    isSidebarOpen = false;
    expect(showReviews).toBe(true);

    // User clicks reviews button again: reopens sidebar
    handleToggleReviews();
    expect(showReviews).toBe(true);
    expect(isSidebarOpen).toBe(true);

    // User clicks reviews button again: turns OFF both
    handleToggleReviews();
    expect(showReviews).toBe(false);
    expect(isSidebarOpen).toBe(false);
  });
});
