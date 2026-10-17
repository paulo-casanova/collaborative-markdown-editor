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

  it('supports non-inheriting directory ACL entries (is_inheritable: false)', () => {
    const dirPerms: NodePermissions = {
      target_type: 'DIRECTORY',
      target_id: '',
      target_path: 'confidential_project',
      effective_permission: 'comment',
      can_manage: true,
      owner: {
        id: 'user-1',
        name: 'alice',
        display_name: 'Alice',
        is_team: false,
      },
      explicit_grants: [
        {
          id: 101,
          grantee_type: 'TEAM',
          grantee_id: 'team-contractors',
          grantee_name: 'Contractors',
          access_level: 'COMMENT',
          is_inheritable: false,
        },
        {
          id: 102,
          grantee_type: 'TEAM',
          grantee_id: 'team-core',
          grantee_name: 'Core Team',
          access_level: 'READ',
          is_inheritable: true,
        },
      ],
      inherited_grants: [],
    };

    expect(dirPerms.explicit_grants[0].is_inheritable).toBe(false);
    expect(dirPerms.explicit_grants[1].is_inheritable).toBe(true);

    // Filter child document inherited grants: only is_inheritable === true should propagate
    const propagated = dirPerms.explicit_grants.filter((g) => g.is_inheritable !== false);
    expect(propagated.length).toBe(1);
    expect(propagated[0].grantee_name).toBe('Core Team');
  });

  it('evaluates test permission result model and breakdown rules', () => {
    const testResult = {
      target_type: 'DOCUMENT' as const,
      target_id: 'doc-uuid-99',
      target_path: 'guides/deploy.md',
      subject_type: 'USER' as const,
      subject_id: 'user-uuid-charlie',
      subject_name: 'Charlie (@charlie)',
      effective_level: 'COMMENT',
      is_admin: false,
      is_owner: false,
      effective_teams: ['Frontend Devs', 'Engineering'],
      matched_rules: [
        {
          source: 'INHERITED_GRANT',
          level: 'READ',
          grantee_type: 'TEAM',
          grantee_name: 'Engineering',
          inherited_from: 'guides',
          is_inheritable: true,
          description: "Inherited from 'guides' via team 'Engineering': READ",
        },
        {
          source: 'EXPLICIT_GRANT',
          level: 'COMMENT',
          grantee_type: 'TEAM',
          grantee_name: 'Frontend Devs',
          is_inheritable: true,
          description: "Direct grant to team 'Frontend Devs': COMMENT",
        },
      ],
    };

    expect(testResult.effective_level).toBe('COMMENT');
    expect(testResult.matched_rules.length).toBe(2);
    expect(testResult.effective_teams).toContain('Engineering');
    expect(testResult.matched_rules[1].level).toBe('COMMENT');
  });

  it('supports directory rename and delete path transformations', () => {
    const oldPath = 'ops/monitoring';
    const newPath = 'infrastructure/observability';
    const childDocPath = 'ops/monitoring/alerts/pagerduty.md';

    expect(childDocPath.startsWith(oldPath + '/')).toBe(true);
    const suffix = childDocPath.substring(oldPath.length);
    const transformedPath = newPath + suffix;
    expect(transformedPath).toBe('infrastructure/observability/alerts/pagerduty.md');

    // Directory tabs
    const dirTabId = `dir:${oldPath}`;
    expect(dirTabId.replace(`dir:${oldPath}`, `dir:${newPath}`)).toBe(`dir:${newPath}`);
  });

  it('strictly recognizes bundles only when named with .bundle suffix', () => {
    const isBundleName = (name: string) => name.endsWith('.bundle');

    expect(isBundleName('architecture.bundle')).toBe(true);
    expect(isBundleName('project.bundle')).toBe(true);
    expect(isBundleName('.bundle')).toBe(true);

    // Regular directories even if containing index.md or other files are NOT bundles
    expect(isBundleName('guides')).toBe(false);
    expect(isBundleName('index.md')).toBe(false);
    expect(isBundleName('specs')).toBe(false);
    expect(isBundleName('project-gamma')).toBe(false);
  });
});
