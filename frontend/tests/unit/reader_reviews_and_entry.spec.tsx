import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import { useUIStore } from '../../src/stores/uiStore';
import { useReviewStore } from '../../src/stores/reviewStore';
import { createDualAnchor, createQuoteSelector } from '../../src/review/textAnchoring';
import type { NodePermissions } from '../../src/types/document';
import type { UserIdentity } from '../../src/types/auth';

describe('Issue #11 & #12: Default Read Mode and Entry Dashboard', () => {
  beforeEach(() => {
    useUIStore.setState({
      viewMode: 'read',
      sidebarOpen: true,
      breadcrumbs: [],
    });
    useReviewStore.setState({
      documentId: null,
      comments: [],
      suggestions: [],
      pendingCommentSelection: null,
      pendingSuggestionSelection: null,
    });
  });

  it('defaults initial viewMode to "read"', () => {
    expect(useUIStore.getState().viewMode).toBe('read');
  });

  it('allows toggling between "read" and "edit" modes', () => {
    useUIStore.getState().setViewMode('edit');
    expect(useUIStore.getState().viewMode).toBe('edit');

    useUIStore.getState().setViewMode('read');
    expect(useUIStore.getState().viewMode).toBe('read');
  });

  it('resets viewMode to "read" upon successful login event', () => {
    useUIStore.getState().setViewMode('edit');
    expect(useUIStore.getState().viewMode).toBe('edit');

    // Simulate login handler
    useUIStore.getState().setViewMode('read');
    expect(useUIStore.getState().viewMode).toBe('read');
  });
});

describe('Issue #13: Reader Mode Review Permissions & Floating Anchors', () => {
  const dummyDocContent = '# Architecture Design\n\nThis is a collaborative document for review.';

  // Helper matching canComment logic in ReaderPage
  function computeCanComment(
    currentUser: UserIdentity | null,
    nodePerms: NodePermissions | null,
    documentOwnerId?: string
  ): boolean {
    if (!currentUser) return false;
    if (currentUser.is_system_admin || currentUser.is_admin) return true;
    if (documentOwnerId && documentOwnerId === currentUser.id) return true;
    if (nodePerms) {
      if (nodePerms.can_manage) return true;
      const eff = (nodePerms.effective_permission || '').toLowerCase();
      return eff === 'comment' || eff === 'edit' || eff === 'admin';
    }
    return true;
  }

  it('denies comment/suggest permissions for unauthenticated users', () => {
    const can = computeCanComment(null, null);
    expect(can).toBe(false);
  });

  it('grants comment/suggest permissions to system admins regardless of node permissions', () => {
    const adminUser: UserIdentity = {
      id: 'admin-1',
      user_id: 'admin-1',
      username: 'admin',
      display_name: 'Admin',
      is_system_admin: true,
      is_admin: true,
      effective_teams: [],
    };
    const readOnlyPerms: NodePermissions = {
      target_type: 'DOCUMENT',
      target_id: 'doc-1',
      target_path: 'doc.md',
      effective_permission: 'read',
      can_manage: false,
      owner: { id: 'other-user', name: 'Other' },
      explicit_grants: [],
      inherited_grants: [],
    };

    expect(computeCanComment(adminUser, readOnlyPerms)).toBe(true);
  });

  it('grants comment/suggest permissions to the document owner', () => {
    const ownerUser: UserIdentity = {
      id: 'owner-1',
      user_id: 'owner-1',
      username: 'owner',
      display_name: 'Owner',
      is_system_admin: false,
      is_admin: false,
      effective_teams: [],
    };
    const readOnlyPerms: NodePermissions = {
      target_type: 'DOCUMENT',
      target_id: 'doc-1',
      target_path: 'doc.md',
      effective_permission: 'read',
      can_manage: false,
      owner: { id: 'owner-1', name: 'Owner' },
      explicit_grants: [],
      inherited_grants: [],
    };

    expect(computeCanComment(ownerUser, readOnlyPerms, 'owner-1')).toBe(true);
  });

  it('grants permissions when effective_permission is "comment", "edit", or "admin"', () => {
    const normalUser: UserIdentity = {
      id: 'user-2',
      user_id: 'user-2',
      username: 'reviewer',
      display_name: 'Reviewer',
      is_system_admin: false,
      is_admin: false,
      effective_teams: [],
    };

    const basePerms: NodePermissions = {
      target_type: 'DOCUMENT',
      target_id: 'doc-1',
      target_path: 'doc.md',
      effective_permission: 'comment',
      can_manage: false,
      owner: { id: 'someone-else', name: 'Other' },
      explicit_grants: [],
      inherited_grants: [],
    };

    expect(computeCanComment(normalUser, { ...basePerms, effective_permission: 'comment' })).toBe(true);
    expect(computeCanComment(normalUser, { ...basePerms, effective_permission: 'edit' })).toBe(true);
    expect(computeCanComment(normalUser, { ...basePerms, effective_permission: 'admin' })).toBe(true);
  });

  it('denies permissions when effective_permission is "read" or "none" for non-owners', () => {
    const normalUser: UserIdentity = {
      id: 'user-2',
      user_id: 'user-2',
      username: 'reader',
      display_name: 'Reader',
      is_system_admin: false,
      is_admin: false,
      effective_teams: [],
    };

    const basePerms: NodePermissions = {
      target_type: 'DOCUMENT',
      target_id: 'doc-1',
      target_path: 'doc.md',
      effective_permission: 'read',
      can_manage: false,
      owner: { id: 'someone-else', name: 'Other' },
      explicit_grants: [],
      inherited_grants: [],
    };

    expect(computeCanComment(normalUser, { ...basePerms, effective_permission: 'read' })).toBe(false);
    expect(computeCanComment(normalUser, { ...basePerms, effective_permission: 'none' })).toBe(false);
  });

  it('creates valid dual anchors for selected text in raw document content', () => {
    const selectedText = 'collaborative document';
    const start = dummyDocContent.indexOf(selectedText);
    const end = start + selectedText.length;

    const ydoc = new Y.Doc();
    const ytext = ydoc.getText('content');
    ytext.insert(0, dummyDocContent);

    const anchor = createDualAnchor(ytext, start, end, dummyDocContent);

    expect(anchor.type).toBe('dual');
    expect(anchor.quote.exact).toBe('collaborative document');
    expect(anchor.quote.prefix).toBe(dummyDocContent.slice(Math.max(0, start - 32), start));
    expect(anchor.quote.suffix).toBe(dummyDocContent.slice(end, end + 32));
    expect(anchor.offset).toBe(start);
    expect(anchor.yjs.start).toBeDefined();
    expect(anchor.yjs.end).toBeDefined();
  });

  it('sets and clears pending comment selection in review store', () => {
    const quote = createQuoteSelector(dummyDocContent, 0, 12);
    useReviewStore.getState().setPendingCommentSelection({
      start: 0,
      end: 12,
      text: '# Architecture',
      anchor: { quote, type: 'dual' },
    });

    expect(useReviewStore.getState().pendingCommentSelection?.text).toBe('# Architecture');

    useReviewStore.getState().setPendingCommentSelection(null);
    expect(useReviewStore.getState().pendingCommentSelection).toBeNull();
  });

  it('sets and clears pending suggestion selection in review store', () => {
    const quote = createQuoteSelector(dummyDocContent, 0, 12);
    useReviewStore.getState().setPendingSuggestionSelection({
      start: 0,
      end: 12,
      text: '# Architecture',
      anchor: { quote, type: 'dual' },
    });

    expect(useReviewStore.getState().pendingSuggestionSelection?.text).toBe('# Architecture');

    useReviewStore.getState().setPendingSuggestionSelection(null);
    expect(useReviewStore.getState().pendingSuggestionSelection).toBeNull();
  });
});

describe('Issue #14: Inline Comments in Reader Mode', () => {
  // Import renderMarkdown from ReaderPage
  const sampleMarkdown = `# Document Title

This is the first paragraph with important text.

This is the second paragraph with another discussion.`;

  it('renders markdown blocks without comments when reviews are disabled / empty', async () => {
    const { renderMarkdown } = await import('../../src/pages/ReaderPage');
    const elements = renderMarkdown(sampleMarkdown, () => {}, null, '', '', '', false, []);
    expect(elements.length).toBeGreaterThan(0);
    // No inline comments container rendered
    const hasCommentContainer = elements.some(
      (el: any) => el?.props?.['data-testid'] === 'inline-comments-container'
    );
    expect(hasCommentContainer).toBe(false);
  });

  it('renders comment cards inline directly below the anchored block when comments exist', async () => {
    const { renderMarkdown } = await import('../../src/pages/ReaderPage');

    const firstParaQuote = 'important text';
    const firstParaStart = sampleMarkdown.indexOf(firstParaQuote);
    const mockComment: any = {
      id: 'comment-123',
      document_id: 'doc-1',
      content: 'This is an inline review comment',
      status: 'OPEN',
      created_at: new Date().toISOString(),
      author: {
        id: 'u-1',
        username: 'alice',
        display_name: 'Alice',
        avatar_color: '#3b82f6',
      },
      anchor: {
        quote: {
          exact: firstParaQuote,
          prefix: sampleMarkdown.slice(firstParaStart - 10, firstParaStart),
          suffix: sampleMarkdown.slice(firstParaStart + firstParaQuote.length, firstParaStart + firstParaQuote.length + 10),
        },
        offset: firstParaStart,
      },
    };

    const renderCard = (c: any) => {
      return (
        <div key={c.id} data-testid="mock-inline-comment-card" data-comment-id={c.id}>
          {c.content}
        </div>
      );
    };

    const elements = renderMarkdown(
      sampleMarkdown,
      () => {},
      null,
      '',
      '',
      '',
      false,
      [mockComment],
      renderCard
    );

    // Verify inline-comments-container is present
    const commentContainers = elements.filter(
      (el: any) => el?.props?.['data-testid'] === 'inline-comments-container'
    );
    expect(commentContainers.length).toBe(1);

    // The comment card should be rendered inside
    const renderedCard = commentContainers[0]?.props?.children?.[0];
    expect(renderedCard?.props?.['data-testid']).toBe('mock-inline-comment-card');
    expect(renderedCard?.props?.['data-comment-id']).toBe('comment-123');

    // The container should be placed right after the first paragraph (index 2: H1, P1, CommentsContainer, P2)
    const containerIdx = elements.findIndex(
      (el: any) => el?.props?.['data-testid'] === 'inline-comments-container'
    );
    expect(containerIdx).toBe(2);
  });

  it('renders multiple comments under their respective anchored blocks', async () => {
    const { renderMarkdown } = await import('../../src/pages/ReaderPage');

    const quote1 = 'Document Title';
    const quote2 = 'second paragraph';

    const comment1: any = {
      id: 'comment-h1',
      document_id: 'doc-1',
      content: 'Title comment',
      status: 'OPEN',
      created_at: new Date().toISOString(),
      anchor: {
        quote: { exact: quote1 },
        offset: sampleMarkdown.indexOf(quote1),
      },
    };

    const comment2: any = {
      id: 'comment-p2',
      document_id: 'doc-1',
      content: 'Paragraph 2 comment',
      status: 'OPEN',
      created_at: new Date().toISOString(),
      anchor: {
        quote: { exact: quote2 },
        offset: sampleMarkdown.indexOf(quote2),
      },
    };

    const renderCard = (c: any) => (
      <div key={c.id} data-testid="mock-card" data-comment-id={c.id}>
        {c.content}
      </div>
    );

    const elements = renderMarkdown(
      sampleMarkdown,
      () => {},
      null,
      '',
      '',
      '',
      false,
      [comment1, comment2],
      renderCard
    );

    const commentContainers = elements.filter(
      (el: any) => el?.props?.['data-testid'] === 'inline-comments-container'
    );
    expect(commentContainers.length).toBe(2);

    // First comment container appears after heading (index 1)
    expect(elements[1]?.props?.['data-testid']).toBe('inline-comments-container');
    expect(elements[1]?.props?.children?.[0]?.props?.['data-comment-id']).toBe('comment-h1');

    // Second comment container appears after second paragraph (last element)
    const lastElement = elements[elements.length - 1] as any;
    expect(lastElement?.props?.['data-testid']).toBe('inline-comments-container');
    expect(lastElement?.props?.children?.[0]?.props?.['data-comment-id']).toBe('comment-p2');
  });

  it('attaches unanchored comments to the end of the document', async () => {
    const { renderMarkdown } = await import('../../src/pages/ReaderPage');

    const unanchoredComment: any = {
      id: 'comment-unanchored',
      document_id: 'doc-1',
      content: 'General document comment',
      status: 'OPEN',
      created_at: new Date().toISOString(),
      anchor: null,
    };

    const renderCard = (c: any) => (
      <div key={c.id} data-testid="mock-card" data-comment-id={c.id}>
        {c.content}
      </div>
    );

    const elements = renderMarkdown(
      sampleMarkdown,
      () => {},
      null,
      '',
      '',
      '',
      false,
      [unanchoredComment],
      renderCard
    );

    const lastElement = elements[elements.length - 1] as any;
    expect(lastElement?.props?.['data-testid']).toBe('inline-comments-container');
    expect(lastElement?.props?.children?.[0]?.props?.['data-comment-id']).toBe('comment-unanchored');
  });
});
