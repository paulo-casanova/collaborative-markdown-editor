import { describe, it, expect } from 'vitest';
import { isMarkdownPath, findWorkspacePath, resolveWorkspaceRelativePath } from '../../src/api/documents';
import { DocumentAsset, DirectoryDashboardItem, NodePermissions } from '../../src/types/document';

describe('Bundle Assets & Additive ACL types and logic', () => {
  it('correctly identifies bundle documents as markdown paths', () => {
    expect(isMarkdownPath('docs/architecture.bundle', true)).toBe(true);
    expect(isMarkdownPath('docs/architecture.bundle')).toBe(true);
    expect(isMarkdownPath('docs/specs.md')).toBe(true);
    expect(isMarkdownPath('docs/diagram.png')).toBe(false);
  });

  it('generates correct bundle relative markdown references for assets', () => {
    const imgAsset: DocumentAsset = {
      name: 'architecture.png',
      relative_path: 'docs/manual.bundle/images/architecture.png',
      bundle_relative_path: 'images/architecture.png',
      size_bytes: 45000,
      is_image: true,
      last_modified: '2026-10-16T12:00:00Z',
      url: '/api/v1/workspaces/files?path=docs/manual.bundle/images/architecture.png',
    };

    const getInsertMarkdown = (asset: DocumentAsset) => {
      const refPath = asset.bundle_relative_path || asset.name;
      if (asset.is_image) {
        return `![${asset.name}](${refPath})`;
      }
      return `[${asset.name}](${refPath})`;
    };

    expect(getInsertMarkdown(imgAsset)).toBe('![architecture.png](images/architecture.png)');

    const fileAsset: DocumentAsset = {
      name: 'spec.pdf',
      relative_path: 'docs/manual.bundle/spec.pdf',
      bundle_relative_path: 'spec.pdf',
      size_bytes: 120000,
      is_image: false,
      last_modified: '2026-10-16T12:00:00Z',
      url: '/api/v1/workspaces/files?path=docs/manual.bundle/spec.pdf',
    };

    expect(getInsertMarkdown(fileAsset)).toBe('[spec.pdf](spec.pdf)');
  });

  it('resolves relative links inside document bundle correctly', () => {
    const currentDoc = 'docs/manual.bundle/index.md';
    const assetRef = 'images/diagram.png';
    const resolved = resolveWorkspaceRelativePath(assetRef, currentDoc);
    expect(resolved).toBe('docs/manual.bundle/images/diagram.png');
  });

  it('models additive ACL permission hierarchy correctly', () => {
    const mockPerms: NodePermissions = {
      target_type: 'DOCUMENT',
      target_id: 'doc-uuid-1',
      target_path: 'engineering/specs/api.md',
      effective_permission: 'edit',
      can_manage: true,
      owner: {
        id: 'user-uuid-1',
        name: 'alice',
        display_name: 'Alice',
        is_team: false,
      },
      explicit_grants: [
        {
          id: 10,
          grantee_type: 'USER',
          grantee_id: 'user-uuid-2',
          grantee_name: 'Bob',
          access_level: 'EDIT',
        },
      ],
      inherited_grants: [
        {
          id: 5,
          grantee_type: 'USER',
          grantee_id: 'user-uuid-2',
          grantee_name: 'Bob',
          access_level: 'READ',
          inherited_from: 'engineering',
        },
      ],
    };

    // Bob has READ from parent 'engineering' and EDIT explicitly on the document:
    // Additive effective permission is MAX(READ, EDIT) = EDIT
    expect(mockPerms.effective_permission).toBe('edit');
    expect(mockPerms.explicit_grants.length).toBe(1);
    expect(mockPerms.inherited_grants.length).toBe(1);
    expect(mockPerms.inherited_grants[0].inherited_from).toBe('engineering');
  });
});
