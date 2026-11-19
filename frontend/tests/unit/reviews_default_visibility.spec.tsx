import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useReviewStore } from '../../src/stores/reviewStore';
import { useUIStore } from '../../src/stores/uiStore';
import { renderMarkdown } from '../../src/pages/ReaderPage';
import type { CommentRecord, SuggestionRecord } from '../../src/review/types';

describe('Default Visibility of Comments and Suggestions in Read and Edit Modes', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('Edit Mode Review Defaults', () => {
    it('defaults isSidebarOpen and showInTextReviews to true in reviewStore', () => {
      const state = useReviewStore.getState();
      expect(state.isSidebarOpen).toBe(true);
      expect(state.showInTextReviews).toBe(true);
      expect(state.showResolved).toBe(true);
    });

    it('defaults reviewSidebarOpen to true in uiStore', () => {
      const state = useUIStore.getState();
      expect(state.reviewSidebarOpen).toBe(true);
    });
  });

  describe('Read Mode Review Defaults', () => {
    const sampleMarkdown = `# Product Specification

Here is a paragraph that has an important note for review.

Another section describing the deployment steps.`;

    const sampleComment: CommentRecord = {
      id: 'c-default-1',
      document_id: 'doc-read-default',
      parent_id: null,
      author: { id: 'u1', username: 'alice', display_name: 'Alice', avatar_color: '#3b82f6' },
      content: 'Please verify this paragraph.',
      status: 'OPEN',
      anchor: {
        quote: { exact: 'important note', prefix: 'has an ', suffix: ' for review' },
        offset: sampleMarkdown.indexOf('important note'),
        length: 'important note'.length,
        type: 'dual',
      },
      created_at: '2026-11-01T00:00:00Z',
      replies: [],
    };

    const sampleSuggestion: SuggestionRecord = {
      id: 's-default-1',
      document_id: 'doc-read-default',
      author: { id: 'u2', username: 'bob', display_name: 'Bob', avatar_color: '#10b981' },
      original_text: 'deployment steps',
      suggested_text: 'automated deployment workflow',
      status: 'PENDING',
      anchor: {
        quote: { exact: 'deployment steps', prefix: 'describing the ', suffix: '.' },
        offset: sampleMarkdown.indexOf('deployment steps'),
        length: 'deployment steps'.length,
        type: 'dual',
      },
      created_at: '2026-11-01T01:00:00Z',
    };

    it('populates effectiveComments and effectiveSuggestions by default with showReviews=true and showInTextReviews=true', () => {
      // In ReaderPage, default showReviews is true and reviewStore showInTextReviews is true:
      const showReviews = true;
      const showInTextReviews = useReviewStore.getState().showInTextReviews;
      const isHistorical = false;
      const showNextRevDiff = false;
      const revisionDiffSuggestions: SuggestionRecord[] = [];
      const comments = [sampleComment];
      const suggestions = [sampleSuggestion];
      const showResolved = true;

      const effectiveSuggestions =
        isHistorical && showNextRevDiff
          ? revisionDiffSuggestions
          : showReviews && showInTextReviews
          ? suggestions.filter(
              (s) => s.status !== 'ARCHIVED' && (showResolved || s.status === 'PENDING')
            )
          : [];

      const effectiveComments = showReviews && showInTextReviews ? comments : [];

      expect(effectiveComments.length).toBe(1);
      expect(effectiveComments[0].id).toBe('c-default-1');
      expect(effectiveSuggestions.length).toBe(1);
      expect(effectiveSuggestions[0].id).toBe('s-default-1');
    });

    it('renders comments and suggestions in reader markdown by default', () => {
      const renderCommentCard = (c: CommentRecord) => (
        <div key={c.id} data-testid="mock-comment-card" data-comment-id={c.id}>
          {c.content}
        </div>
      );

      const renderSuggestionCard = (s: SuggestionRecord) => (
        <div key={s.id} data-testid="mock-suggestion-card" data-suggestion-id={s.id}>
          {s.suggested_text}
        </div>
      );

      const elements = renderMarkdown(
        sampleMarkdown,
        () => {},
        null,
        '',
        sampleMarkdown,
        '/test.md',
        false,
        [sampleComment],
        renderCommentCard,
        [sampleSuggestion],
        renderSuggestionCard
      );

      // Verify that inline comment containers and anchor highlights are rendered by default
      const nodesJson = JSON.stringify(elements);
      expect(nodesJson).toContain('inline-comments-container');
      expect(nodesJson).toContain('mock-comment-card');
      expect(nodesJson).toContain('mock-suggestion-card');
      expect(nodesJson).toContain('cme-review-comment-anchor');
    });

    it('keeps review sidebar open by default in both read and edit modes', () => {
      const isSidebarOpen = useReviewStore.getState().isSidebarOpen;
      const showReviews = true;

      // In ReaderPage: {showReviews && isSidebarOpen && <ReviewSidebar ... />}
      const readerSidebarVisible = showReviews && isSidebarOpen;
      expect(readerSidebarVisible).toBe(true);

      // In EditorPane: {isPrimary && isSidebarOpen && <ReviewSidebar ... />}
      const isPrimary = true;
      const editorSidebarVisible = isPrimary && isSidebarOpen;
      expect(editorSidebarVisible).toBe(true);
    });
  });
});
