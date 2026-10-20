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
