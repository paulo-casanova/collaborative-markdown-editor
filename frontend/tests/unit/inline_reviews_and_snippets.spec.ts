import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  parseCodeFenceHeader,
  extractSnippetFromText,
  getSnippetCacheKey,
  setSnippetState,
  getSnippetState,
} from '../../src/utils/snippetSync';
import {
  InlineSuggestionWidget,
  InlineCommentThreadWidget,
} from '../../src/components/editor/codemirror/inlineReviewPlugin';
import { useReviewStore } from '../../src/stores/reviewStore';
import { SuggestionRecord, CommentRecord } from '../../src/review/types';

// Lightweight DOM mock for Node environment in unit tests
class MockDOMElement {
  public tagName: string;
  public className: string = '';
  public _innerHTML: string = '';
  public _textContent: string = '';
  public attributes: Record<string, string> = {};
  public children: MockDOMElement[] = [];
  public eventListeners: Record<string, ((e: any) => void)[]> = {};
  public disabled: boolean = false;
  public value: string = '';

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
  }

  get innerHTML(): string {
    return this._innerHTML;
  }

  set innerHTML(val: string) {
    this._innerHTML = val;
    this._textContent = val.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  get textContent(): string {
    return this._textContent || this.children.map((c) => c.textContent).join(' ');
  }

  set textContent(val: string) {
    this._textContent = val;
    this._innerHTML = val;
  }

  setAttribute(name: string, value: string) {
    this.attributes[name] = value;
  }

  getAttribute(name: string): string | null {
    return this.attributes[name] ?? null;
  }

  appendChild(child: MockDOMElement) {
    this.children.push(child);
    return child;
  }

  addEventListener(event: string, cb: (e: any) => void) {
    this.eventListeners[event] = this.eventListeners[event] || [];
    this.eventListeners[event].push(cb);
  }

  click() {
    (this.eventListeners['click'] || []).forEach((cb) => cb({ stopPropagation: () => {} }));
  }

  querySelector(selector: string): MockDOMElement | null {
    const clean = selector.trim();
    if (clean.startsWith('[data-testid="') && clean.endsWith('"]')) {
      const targetId = clean.slice(14, -2);
      return this._find((el) => el.getAttribute('data-testid') === targetId);
    }
    if (clean.startsWith('.')) {
      const cls = clean.slice(1);
      return this._find((el) => el.className.split(' ').includes(cls));
    }
    if (clean === 'input') {
      return this._find((el) => el.tagName === 'INPUT');
    }
    return null;
  }

  private _find(predicate: (el: MockDOMElement) => boolean): MockDOMElement | null {
    if (predicate(this)) return this;
    for (const child of this.children) {
      const match = child._find(predicate);
      if (match) return match;
    }
    return null;
  }
}

if (typeof globalThis.document === 'undefined') {
  (globalThis as any).document = {
    createElement(tagName: string) {
      return new MockDOMElement(tagName);
    },
  };
}

describe('Step 8.4: Dynamic External Code Snippet Synchronization', () => {
  it('parses extended code fence headers into language, source, and marker', () => {
    const res1 = parseCodeFenceHeader('cpp|https://example.com/sample.cpp|main_loop');
    expect(res1.isSnippet).toBe(true);
    expect(res1.language).toBe('cpp');
    expect(res1.source).toBe('https://example.com/sample.cpp');
    expect(res1.marker).toBe('main_loop');

    const res2 = parseCodeFenceHeader('python|/src/utils/calc.py|calculate_tax');
    expect(res2.isSnippet).toBe(true);
    expect(res2.language).toBe('python');
    expect(res2.source).toBe('/src/utils/calc.py');
    expect(res2.marker).toBe('calculate_tax');

    const res3 = parseCodeFenceHeader('typescript');
    expect(res3.isSnippet).toBe(false);
    expect(res3.language).toBe('typescript');
    expect(res3.source).toBe('');
    expect(res3.marker).toBe('');
  });

  it('extracts snippet enclosed by [marker] ... [/marker] boundaries', () => {
    const sourceCode = `
#include <iostream>

// [main_loop]
int count = 0;
while (count < 10) {
    std::cout << count << std::endl;
    count++;
}
// [/main_loop]

int helper() { return 42; }
`;
    const res = extractSnippetFromText(sourceCode, 'main_loop');
    expect(res.error).toBeUndefined();
    expect(res.code).toContain('int count = 0;');
    expect(res.code).toContain('std::cout << count << std::endl;');
    expect(res.code).not.toContain('helper');
    expect(res.code).not.toContain('// [main_loop]');
    expect(res.code).not.toContain('// [/main_loop]');
  });

  it('extracts snippet enclosed by Doxygen style repeated [marker]', () => {
    const doxygenSource = `
//! [calc]
def add(a, b):
    return a + b
//! [calc]
`;
    const res = extractSnippetFromText(doxygenSource, 'calc');
    expect(res.error).toBeUndefined();
    expect(res.code).toContain('def add(a, b):');
    expect(res.code).toContain('return a + b');
  });

  it('returns clean error without throwing when marker is missing in source', () => {
    const sourceCode = `
int a = 1;
int b = 2;
`;
    const res = extractSnippetFromText(sourceCode, 'non_existent_marker');
    expect(res.error).toBe("Marker 'non_existent_marker' not found in source");
    expect(res.code).toBe('');
  });

  it('caches snippet states and allows status updates', () => {
    const key = getSnippetCacheKey('https://example.com/foo.cpp', 'worker');
    expect(key).toBe('https://example.com/foo.cpp|worker');

    setSnippetState('https://example.com/foo.cpp', 'worker', {
      status: 'synced',
      code: 'int worker_id = 1;',
    });

    const state = getSnippetState('https://example.com/foo.cpp', 'worker');
    expect(state).toBeDefined();
    expect(state?.status).toBe('synced');
    expect(state?.code).toBe('int worker_id = 1;');
  });
});

describe('Step 8.3: Inline Code-Diff Reviews & In-Document Discussions', () => {
  beforeEach(() => {
    useReviewStore.setState({
      documentId: 'doc-123',
      comments: [],
      suggestions: [],
      tasks: [],
    });
  });

  it('renders InlineSuggestionWidget as a unified diff block with Accept and Reject buttons', () => {
    const suggestion: SuggestionRecord = {
      id: 'sugg-1',
      document_id: 'doc-123',
      author: {
        id: 'u1',
        username: 'alice',
        display_name: 'Alice Casanova',
        avatar_color: '#3b82f6',
      },
      status: 'PENDING',
      original_text: 'old text that needs fix',
      suggested_text: 'new improved text',
      anchor: { offset: 10, length: 23, quote: { exact: 'old text that needs fix', prefix: '', suffix: '' } },
      created_at: new Date().toISOString(),
    };

    const widget = new InlineSuggestionWidget(suggestion, { start: 10, end: 33 });
    const mockView = {
      dispatch: vi.fn(),
    } as any;

    const dom = widget.toDOM(mockView);
    expect(dom).toBeDefined();
    expect(dom.getAttribute('data-testid')).toBe('inline-suggestion-widget');
    expect(dom.getAttribute('data-suggestion-id')).toBe('sugg-1');

    // Deletion row in red
    const deletion = dom.querySelector('.diff-deletion');
    expect(deletion).toBeDefined();
    expect(deletion?.textContent).toContain('old text that needs fix');

    // Addition row in green
    const addition = dom.querySelector('.diff-addition');
    expect(addition).toBeDefined();
    expect(addition?.textContent).toContain('new improved text');

    // Accept & Reject buttons
    const acceptBtn = dom.querySelector('[data-testid="accept-suggestion-btn"]');
    const rejectBtn = dom.querySelector('[data-testid="reject-suggestion-btn"]');
    expect(acceptBtn).toBeDefined();
    expect(rejectBtn).toBeDefined();
  });

  it('applies suggestion to editor when Accept button is clicked', async () => {
    const acceptSpy = vi.spyOn(useReviewStore.getState(), 'acceptSuggestion').mockImplementation(
      async (_id, onLocalApply) => {
        onLocalApply?.();
        return {} as any;
      }
    );

    const suggestion: SuggestionRecord = {
      id: 'sugg-apply',
      document_id: 'doc-123',
      author: { id: 'u1', username: 'alice', display_name: 'Alice', avatar_color: '#3b82f6' },
      status: 'PENDING',
      original_text: 'hello',
      suggested_text: 'world',
      anchor: {},
      created_at: new Date().toISOString(),
    };

    const widget = new InlineSuggestionWidget(suggestion, { start: 5, end: 10 });
    const mockView = {
      dispatch: vi.fn(),
    } as any;

    const dom = widget.toDOM(mockView);
    const acceptBtn = dom.querySelector('[data-testid="accept-suggestion-btn"]') as any;
    expect(acceptBtn).not.toBeNull();

    acceptBtn.click();
    expect(acceptSpy).toHaveBeenCalledWith('sugg-apply', expect.any(Function));
    expect(mockView.dispatch).toHaveBeenCalledWith({
      changes: {
        from: 5,
        to: 10,
        insert: 'world',
      },
    });
  });

  it('renders InlineCommentThreadWidget with root comment, replies, resolve button, and inline reply form', () => {
    const comment: CommentRecord = {
      id: 'c-1',
      document_id: 'doc-123',
      parent_id: null,
      author: {
        id: 'u2',
        username: 'bob',
        display_name: 'Bob',
        avatar_color: '#ec4899',
      },
      content: '**Critical**: Please clarify this clause.',
      status: 'OPEN',
      anchor: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      replies: [
        {
          id: 'c-2',
          document_id: 'doc-123',
          parent_id: 'c-1',
          author: { id: 'u1', username: 'alice', display_name: 'Alice', avatar_color: '#3b82f6' },
          content: 'Updated with more details.',
          status: 'OPEN',
          anchor: {},
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ],
    };

    const widget = new InlineCommentThreadWidget(comment, { start: 10, end: 20 });
    const mockView = { dispatch: vi.fn() } as any;

    const dom = widget.toDOM(mockView);
    expect(dom).toBeDefined();
    expect(dom.getAttribute('data-testid')).toBe('inline-comment-widget');
    expect(dom.getAttribute('data-comment-id')).toBe('c-1');

    // Author and content
    expect(dom.textContent).toContain('Bob');
    expect(dom.textContent).toContain('Critical');

    // Nested reply
    expect(dom.textContent).toContain('Alice');
    expect(dom.textContent).toContain('Updated with more details.');

    // Controls
    expect(dom.querySelector('[data-testid="resolve-comment-btn"]')).not.toBeNull();
    expect(dom.querySelector('[data-testid="delete-comment-btn"]')).not.toBeNull();
    expect(dom.querySelector('[data-testid="inline-reply-input"]')).not.toBeNull();
    expect(dom.querySelector('[data-testid="inline-reply-submit-btn"]')).not.toBeNull();
  });

  it('toggles showInTextReviews state in useReviewStore to show/hide in-text reviews', () => {
    expect(useReviewStore.getState().showInTextReviews).toBe(true);

    useReviewStore.getState().toggleInTextReviews();
    expect(useReviewStore.getState().showInTextReviews).toBe(false);

    useReviewStore.getState().setShowInTextReviews(true);
    expect(useReviewStore.getState().showInTextReviews).toBe(true);
  });
});
