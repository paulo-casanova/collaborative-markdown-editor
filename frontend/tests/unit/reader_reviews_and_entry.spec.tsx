import { describe, it, expect, beforeEach, vi } from 'vitest';
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

  it('renders suggestion cards inline directly below the anchored block when suggestions exist', async () => {
    const { renderMarkdown } = await import('../../src/pages/ReaderPage');

    const quote = 'first paragraph';
    const mockSuggestion: any = {
      id: 'sugg-101',
      document_id: 'doc-1',
      original_text: 'first paragraph',
      suggested_text: 'primary paragraph',
      status: 'PENDING',
      created_at: new Date().toISOString(),
      author: {
        id: 'user-2',
        username: 'editor',
        display_name: 'Editor In Chief',
      },
      anchor: {
        quote: { exact: quote },
        offset: sampleMarkdown.indexOf(quote),
      },
    };

    const renderSuggestionCard = (s: any) => (
      <div key={s.id} data-testid="mock-inline-suggestion-card" data-suggestion-id={s.id}>
        <span>{s.original_text} {'->'} {s.suggested_text}</span>
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
      [],
      undefined,
      [mockSuggestion],
      renderSuggestionCard
    );

    const containers = elements.filter(
      (el: any) => el?.props?.['data-testid'] === 'inline-comments-container'
    );
    expect(containers.length).toBe(1);

    const renderedSuggestion = containers[0]?.props?.children?.[0];
    expect(renderedSuggestion?.props?.['data-testid']).toBe('mock-inline-suggestion-card');
    expect(renderedSuggestion?.props?.['data-suggestion-id']).toBe('sugg-101');

    // Container should follow first paragraph (H1, P1, Container, P2)
    const containerIdx = elements.findIndex(
      (el: any) => el?.props?.['data-testid'] === 'inline-comments-container'
    );
    expect(containerIdx).toBe(2);
  });

  it('renders both comments and suggestions interleaved under their respective blocks', async () => {
    const { renderMarkdown } = await import('../../src/pages/ReaderPage');

    const quoteComment = 'Document Title';
    const quoteSugg = 'second paragraph';

    const mockComment: any = {
      id: 'comment-1',
      document_id: 'doc-1',
      content: 'Comment on title',
      status: 'OPEN',
      created_at: new Date().toISOString(),
      anchor: {
        quote: { exact: quoteComment },
        offset: sampleMarkdown.indexOf(quoteComment),
      },
    };

    const mockSuggestion: any = {
      id: 'sugg-1',
      document_id: 'doc-1',
      original_text: 'second paragraph',
      suggested_text: 'final paragraph',
      status: 'PENDING',
      created_at: new Date().toISOString(),
      anchor: {
        quote: { exact: quoteSugg },
        offset: sampleMarkdown.indexOf(quoteSugg),
      },
    };

    const renderCommentCard = (c: any) => (
      <div key={c.id} data-testid="mock-comment-card" data-comment-id={c.id}>
        {c.content}
      </div>
    );

    const renderSuggestionCard = (s: any) => (
      <div key={s.id} data-testid="mock-suggestion-card" data-suggestion-id={s.id}>
        {s.suggested_text}
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
      [mockComment],
      renderCommentCard,
      [mockSuggestion],
      renderSuggestionCard
    );

    const containers = elements.filter(
      (el: any) => el?.props?.['data-testid'] === 'inline-comments-container'
    );
    expect(containers.length).toBe(2);

    // First container under heading has the comment
    expect(containers[0]?.props?.children?.[0]?.props?.['data-comment-id']).toBe('comment-1');

    // Second container under paragraph 2 has the suggestion
    expect(containers[1]?.props?.children?.[0]?.props?.['data-suggestion-id']).toBe('sugg-1');
  });
});

describe('Reader Mode Suggestion Archiving (Accepted, Rejected, Pending)', () => {
  it('renders archive button for ACCEPTED suggestions in reader view', async () => {
    const { ReaderSuggestionCard } = await import('../../src/pages/ReaderPage');
    const { renderToStaticMarkup } = await import('react-dom/server');

    const acceptedSugg: any = {
      id: 'sugg-accepted-1',
      document_id: 'doc-1',
      original_text: 'old text',
      suggested_text: 'new text',
      status: 'ACCEPTED',
      created_at: new Date().toISOString(),
      author: {
        id: 'user-1',
        username: 'alice',
        display_name: 'Alice',
      },
    };

    const html = renderToStaticMarkup(<ReaderSuggestionCard suggestion={acceptedSugg} />);
    expect(html).toContain('data-testid="archive-suggestion-btn"');
    expect(html).toContain('title="Archive suggestion"');
    expect(html).not.toContain('data-testid="accept-suggestion-btn"');
    expect(html).not.toContain('data-testid="reject-suggestion-btn"');
    expect(html).toContain('ACCEPTED');
  });

  it('renders archive button for REJECTED suggestions in reader view', async () => {
    const { ReaderSuggestionCard } = await import('../../src/pages/ReaderPage');
    const { renderToStaticMarkup } = await import('react-dom/server');

    const rejectedSugg: any = {
      id: 'sugg-rejected-1',
      document_id: 'doc-1',
      original_text: 'unwanted text',
      suggested_text: 'proposals',
      status: 'REJECTED',
      created_at: new Date().toISOString(),
      author: {
        id: 'user-2',
        username: 'bob',
        display_name: 'Bob',
      },
    };

    const html = renderToStaticMarkup(<ReaderSuggestionCard suggestion={rejectedSugg} />);
    expect(html).toContain('data-testid="archive-suggestion-btn"');
    expect(html).toContain('title="Archive suggestion"');
    expect(html).not.toContain('data-testid="accept-suggestion-btn"');
    expect(html).not.toContain('data-testid="reject-suggestion-btn"');
    expect(html).toContain('REJECTED');
  });

  it('renders accept, reject, and archive buttons for PENDING suggestions in reader view', async () => {
    const { ReaderSuggestionCard } = await import('../../src/pages/ReaderPage');
    const { renderToStaticMarkup } = await import('react-dom/server');

    const pendingSugg: any = {
      id: 'sugg-pending-1',
      document_id: 'doc-1',
      original_text: 'draft paragraph',
      suggested_text: 'revised paragraph',
      status: 'PENDING',
      created_at: new Date().toISOString(),
      author: {
        id: 'user-3',
        username: 'charlie',
        display_name: 'Charlie',
      },
    };

    const html = renderToStaticMarkup(<ReaderSuggestionCard suggestion={pendingSugg} />);
    expect(html).toContain('data-testid="accept-suggestion-btn"');
    expect(html).toContain('data-testid="reject-suggestion-btn"');
    expect(html).toContain('data-testid="archive-suggestion-btn"');
    expect(html).toContain('PENDING');
  });

  it('does NOT render archive or action buttons for REVISION_DIFF in reader view', async () => {
    const { ReaderSuggestionCard } = await import('../../src/pages/ReaderPage');
    const { renderToStaticMarkup } = await import('react-dom/server');

    const revisionDiffSugg: any = {
      id: 'rev-diff-1',
      document_id: 'doc-1',
      original_text: 'historical line',
      suggested_text: 'current line',
      status: 'REVISION_DIFF',
      created_at: new Date().toISOString(),
    };

    const html = renderToStaticMarkup(<ReaderSuggestionCard suggestion={revisionDiffSugg} />);
    expect(html).not.toContain('data-testid="archive-suggestion-btn"');
    expect(html).not.toContain('data-testid="accept-suggestion-btn"');
    expect(html).not.toContain('data-testid="reject-suggestion-btn"');
    expect(html).toContain('Next Rev Diff');
  });

  it('invokes onArchive callback with suggestion ID when archive button is triggered', async () => {
    const { ReaderSuggestionCard } = await import('../../src/pages/ReaderPage');
    const onArchive = vi.fn();

    const acceptedSugg: any = {
      id: 'sugg-archive-test',
      document_id: 'doc-1',
      original_text: 'text',
      suggested_text: 'replaced',
      status: 'ACCEPTED',
      created_at: new Date().toISOString(),
    };

    const element = ReaderSuggestionCard({
      suggestion: acceptedSugg,
      onArchive,
    });

    const header = (element as any).props.children[0];
    const actionsContainer = header.props.children[1];
    const archiveBtn = actionsContainer.props.children[1] || actionsContainer.props.children;
    expect(archiveBtn.props['data-testid']).toBe('archive-suggestion-btn');

    archiveBtn.props.onClick();
    expect(onArchive).toHaveBeenCalledTimes(1);
    expect(onArchive).toHaveBeenCalledWith('sugg-archive-test');
  });

  it('only shows PENDING suggestions inline in reader view, omitting ACCEPTED and REJECTED (matching editor view)', async () => {
    const { renderMarkdown } = await import('../../src/pages/ReaderPage');

    const sampleDoc = '# Document\n\nContent here.';
    const acceptedSugg: any = {
      id: 'sugg-accepted',
      document_id: 'doc-1',
      original_text: 'Content here.',
      suggested_text: 'Updated content.',
      status: 'ACCEPTED',
      created_at: new Date().toISOString(),
      anchor: { quote: { exact: 'Content here.' }, offset: 12 },
    };

    const rejectedSugg: any = {
      id: 'sugg-rejected',
      document_id: 'doc-1',
      original_text: 'Content here.',
      suggested_text: 'Discarded content.',
      status: 'REJECTED',
      created_at: new Date().toISOString(),
      anchor: { quote: { exact: 'Content here.' }, offset: 12 },
    };

    const pendingSugg: any = {
      id: 'sugg-pending',
      document_id: 'doc-1',
      original_text: 'Content here.',
      suggested_text: 'Pending content.',
      status: 'PENDING',
      created_at: new Date().toISOString(),
      anchor: { quote: { exact: 'Content here.' }, offset: 12 },
    };

    const renderCard = (s: any) => (
      <div key={s.id} data-testid="test-sugg-card" data-sugg-id={s.id}>{s.suggested_text}</div>
    );

    // Test with ACCEPTED and REJECTED suggestions: neither should be rendered inline
    const elementsResolved = renderMarkdown(
      sampleDoc,
      () => {},
      null,
      '',
      '',
      '',
      false,
      [],
      undefined,
      [acceptedSugg, rejectedSugg],
      renderCard
    );

    const containersResolved = elementsResolved.filter(
      (el: any) => el?.props?.['data-testid'] === 'inline-comments-container'
    );
    expect(containersResolved.length).toBe(0);

    // Test with PENDING suggestion: should be rendered inline
    const elementsPending = renderMarkdown(
      sampleDoc,
      () => {},
      null,
      '',
      '',
      '',
      false,
      [],
      undefined,
      [pendingSugg],
      renderCard
    );

    const containersPending = elementsPending.filter(
      (el: any) => el?.props?.['data-testid'] === 'inline-comments-container'
    );
    expect(containersPending.length).toBe(1);
    expect(containersPending[0]?.props?.children?.[0]?.props?.['data-sugg-id']).toBe('sugg-pending');
  });

  it('renders indented display math (e.g. in list items like 6.4) and multiline matrices without KaTeX errors', async () => {
    const { renderMarkdown } = await import('../../src/pages/ReaderPage');
    const { renderToStaticMarkup } = await import('react-dom/server');

    const sampleDoc = [
      '1. Dynamic Endpoint Resolution:',
      '   $$\\text{Endpoint} = \\text{TargetSideVertex}_{\\text{start}} + \\text{ratio} \\times (\\text{TargetSideVertex}_{\\text{end}} - \\text{TargetSideVertex}_{\\text{start}})$$',
      '',
      'Matrix transform:',
      '$$\\begin{bmatrix}',
      'x \\\\',
      'y',
      '\\end{bmatrix}$$',
    ].join('\n');

    const elements = renderMarkdown(
      sampleDoc,
      () => {},
      null,
      '',
      '',
      '',
      false
    );

    const fullHtml = elements.map((el) => renderToStaticMarkup(el as any)).join('');
    // Must NOT contain KaTeX error in red
    expect(fullHtml).not.toContain('katex-error');
    expect(fullHtml).not.toContain('#cc0000');
    // Must contain KaTeX rendered display math
    expect(fullHtml).toContain('katex-display');
    expect(fullHtml).toContain('Endpoint');
  });
});
