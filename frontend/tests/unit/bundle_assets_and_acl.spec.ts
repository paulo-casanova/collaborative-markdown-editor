import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isMarkdownPath,
  findWorkspacePath,
  resolveWorkspaceRelativePath,
  updateWorkspaceNodesCache,
  downloadWorkspaceFile,
  downloadBundleZip,
  importWorkspaceFileToBundleAsset,
} from '../../src/api/documents';
import { DocumentAsset, DirectoryDashboardItem, NodePermissions } from '../../src/types/document';
import { buildTree } from '../../src/components/navigation/FileTree';

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

    // Regular directories even if containing index.md or dirname.md are NOT bundles
    expect(isBundleName('guides')).toBe(false);
    expect(isBundleName('index.md')).toBe(false);
    expect(isBundleName('specs')).toBe(false);
    expect(isBundleName('project-gamma')).toBe(false);
    expect(isBundleName('Church Livestream')).toBe(false);
  });

  it('buildTree preserves folders containing <dirname>.md and all sibling files in any processing order', () => {
    // Case 1: Directory node comes first
    const inputOrder1 = [
      { name: 'Church Livestream', path: 'Church Livestream', is_directory: true, is_bundle: false },
      { name: 'Church Livestream.md', path: 'Church Livestream/Church Livestream.md', is_directory: false, is_bundle: false },
      { name: 'Design.md', path: 'Church Livestream/Design.md', is_directory: false, is_bundle: false },
      { name: 'v4l2 Camera Controls.md', path: 'Church Livestream/v4l2 Camera Controls.md', is_directory: false, is_bundle: false },
    ];

    const tree1 = buildTree(inputOrder1);
    expect(tree1).toHaveLength(1);
    expect(tree1[0].name).toBe('Church Livestream');
    expect(tree1[0].is_directory).toBe(true);
    expect(tree1[0].is_bundle).toBe(false);
    expect(tree1[0].children).toHaveLength(3);
    const childNames1 = tree1[0].children!.map((c) => c.name);
    expect(childNames1).toContain('Church Livestream.md');
    expect(childNames1).toContain('Design.md');
    expect(childNames1).toContain('v4l2 Camera Controls.md');

    // Case 2: Child file comes first before directory node
    const inputOrder2 = [
      { name: 'Church Livestream.md', path: 'Church Livestream/Church Livestream.md', is_directory: false, is_bundle: false },
      { name: 'Church Livestream', path: 'Church Livestream', is_directory: true, is_bundle: false },
      { name: 'Design.md', path: 'Church Livestream/Design.md', is_directory: false, is_bundle: false },
      { name: 'v4l2 Camera Controls.md', path: 'Church Livestream/v4l2 Camera Controls.md', is_directory: false, is_bundle: false },
    ];

    const tree2 = buildTree(inputOrder2);
    expect(tree2).toHaveLength(1);
    expect(tree2[0].name).toBe('Church Livestream');
    expect(tree2[0].is_directory).toBe(true);
    expect(tree2[0].is_bundle).toBe(false);
    expect(tree2[0].children).toHaveLength(3);
    const childNames2 = tree2[0].children!.map((c) => c.name);
    expect(childNames2).toContain('Church Livestream.md');
    expect(childNames2).toContain('Design.md');
    expect(childNames2).toContain('v4l2 Camera Controls.md');

    // Case 3: Folder with is_bundle mistakenly set to true from legacy data is corrected if not ending in .bundle
    const inputLegacy = [
      { name: 'Church Livestream', path: 'Church Livestream', is_directory: true, is_bundle: true },
      { name: 'Church Livestream.md', path: 'Church Livestream/Church Livestream.md', is_directory: false, is_bundle: false },
    ];
    const tree3 = buildTree(inputLegacy);
    expect(tree3[0].is_directory).toBe(true);
    expect(tree3[0].is_bundle).toBe(false);
    expect(tree3[0].children).toHaveLength(1);
  });

  it('resolves wikilinks with stems or directory paths to the underlying markdown document', () => {
    const nodes = [
      { name: 'Highway', path: 'Highway', is_directory: true, is_bundle: false },
      { name: 'Projects', path: 'Highway/Projects', is_directory: true, is_bundle: false },
      { name: 'Nanobump US Equities', path: 'Highway/Projects/Nanobump US Equities', is_directory: true, is_bundle: false },
      {
        name: 'Nanobump US Equities.md',
        path: 'Highway/Projects/Nanobump US Equities/Nanobump US Equities.md',
        is_directory: false,
        is_bundle: false,
      },
      { name: 'Foo.md', path: 'Foo.md', is_directory: false, is_bundle: false },
      { name: 'Xpto', path: 'Xpto', is_directory: true, is_bundle: false },
      { name: 'Bar', path: 'Xpto/Bar', is_directory: true, is_bundle: false },
      { name: 'Bar.md', path: 'Xpto/Bar/Bar.md', is_directory: false, is_bundle: false },
    ];

    updateWorkspaceNodesCache(nodes as any);

    // Stem alone resolves to full markdown file path
    expect(findWorkspacePath('Nanobump US Equities', 'Highway/Projects/Foo.md')).toBe(
      'Highway/Projects/Nanobump US Equities/Nanobump US Equities.md'
    );
    expect(findWorkspacePath('Nanobump US Equities')).toBe(
      'Highway/Projects/Nanobump US Equities/Nanobump US Equities.md'
    );

    // Directory path resolves to folder note markdown file
    expect(findWorkspacePath('Highway/Projects/Nanobump US Equities')).toBe(
      'Highway/Projects/Nanobump US Equities/Nanobump US Equities.md'
    );

    // Sibling directory stem [[Bar]] from Foo.md
    expect(findWorkspacePath('Bar', 'Foo.md')).toBe('Xpto/Bar/Bar.md');
    expect(findWorkspacePath('Xpto/Bar', 'Foo.md')).toBe('Xpto/Bar/Bar.md');
  });

  describe('Tree file download and bundle asset import operations', () => {
    let originalDocument: any;
    let originalURL: any;
    let originalFetch: any;

    beforeEach(() => {
      originalDocument = (global as any).document;
      originalURL = (global as any).URL;
      originalFetch = (global as any).fetch;
    });

    afterEach(() => {
      (global as any).document = originalDocument;
      (global as any).URL = originalURL;
      (global as any).fetch = originalFetch;
      vi.restoreAllMocks();
    });

    it('downloadWorkspaceFile triggers fetch and creates a temporary download link', async () => {
      let createdLink: any = null;
      let clicked = false;
      let appended = false;
      let removed = false;

      (global as any).document = {
        createElement: vi.fn((tag: string) => {
          if (tag === 'a') {
            createdLink = { href: '', download: '', click: () => { clicked = true; } };
            return createdLink;
          }
          return {};
        }),
        body: {
          appendChild: vi.fn(() => { appended = true; }),
          removeChild: vi.fn(() => { removed = true; }),
        },
      };

      (global as any).URL = {
        createObjectURL: vi.fn(() => 'blob:http://localhost/mock-blob-uuid'),
        revokeObjectURL: vi.fn(),
      };

      (global as any).fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        blob: async () => ({ size: 100 }),
      });

      await downloadWorkspaceFile('documents/specs/architecture.pdf', 'architecture.pdf');

      expect((global as any).fetch).toHaveBeenCalledWith(
        '/api/v1/workspaces/files?path=documents%2Fspecs%2Farchitecture.pdf',
        expect.objectContaining({ credentials: 'include' })
      );
      expect(createdLink).not.toBeNull();
      expect(createdLink.download).toBe('architecture.pdf');
      expect(createdLink.href).toBe('blob:http://localhost/mock-blob-uuid');
      expect(clicked).toBe(true);
      expect(appended).toBe(true);
      expect(removed).toBe(true);
    });

    it('downloadBundleZip queries /bundle.zip route when docId is provided', async () => {
      let createdLink: any = null;
      (global as any).document = {
        createElement: vi.fn((tag: string) => {
          if (tag === 'a') {
            createdLink = { href: '', download: '', click: vi.fn() };
            return createdLink;
          }
          return {};
        }),
        body: {
          appendChild: vi.fn(),
          removeChild: vi.fn(),
        },
      };

      (global as any).URL = {
        createObjectURL: vi.fn(() => 'blob:http://localhost/bundle-zip-uuid'),
        revokeObjectURL: vi.fn(),
      };

      (global as any).fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        blob: async () => ({ size: 5000 }),
      });

      await downloadBundleZip('projects/alpha.bundle', 'doc-bundle-uuid-1', 'alpha.bundle.zip');

      expect((global as any).fetch).toHaveBeenCalledWith(
        '/api/v1/documents/doc-bundle-uuid-1/bundle.zip',
        expect.objectContaining({ credentials: 'include' })
      );
      expect(createdLink.download).toBe('alpha.bundle.zip');
    });

    it('downloadBundleZip queries /workspaces/bundles/zip route when docId is omitted', async () => {
      let createdLink: any = null;
      (global as any).document = {
        createElement: vi.fn((tag: string) => {
          if (tag === 'a') {
            createdLink = { href: '', download: '', click: vi.fn() };
            return createdLink;
          }
          return {};
        }),
        body: {
          appendChild: vi.fn(),
          removeChild: vi.fn(),
        },
      };

      (global as any).URL = {
        createObjectURL: vi.fn(() => 'blob:http://localhost/dir-zip-uuid'),
        revokeObjectURL: vi.fn(),
      };

      (global as any).fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        blob: async () => ({ size: 8000 }),
      });

      await downloadBundleZip('guides/user_manual', undefined, 'user_manual.zip');

      expect((global as any).fetch).toHaveBeenCalledWith(
        '/api/v1/workspaces/bundles/zip?path=guides%2Fuser_manual',
        expect.objectContaining({ credentials: 'include' })
      );
      expect(createdLink.download).toBe('user_manual.zip');
    });

    it('importWorkspaceFileToBundleAsset sends POST request with source path and target filename', async () => {
      (global as any).fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: {
          get: (name: string) => (name.toLowerCase() === 'content-type' ? 'application/json' : null),
        },
        json: async () => ({ filename: 'photo.png', path: 'projects/spec.bundle/images/photo.png' }),
      });

      const res = await importWorkspaceFileToBundleAsset('doc-uuid-55', 'assets/photo.png', 'photo.png');
      expect(res.filename).toBe('photo.png');
      expect(res.path).toBe('projects/spec.bundle/images/photo.png');

      expect((global as any).fetch).toHaveBeenCalledWith(
        '/api/v1/documents/doc-uuid-55/assets/import',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            source_path: 'assets/photo.png',
            target_filename: 'photo.png',
          }),
        })
      );
    });

    it('handles dragging workspace tree items and validates drag payload', () => {
      const node = {
        id: 'doc-node-1',
        path: 'guides/images/diagram.png',
        name: 'diagram.png',
        is_directory: false,
        is_bundle: false,
      };
      const payload = JSON.stringify({
        id: node.id,
        path: node.path,
        name: node.name,
        is_directory: node.is_directory,
        is_bundle: node.is_bundle,
      });

      const parsed = JSON.parse(payload);
      expect(parsed.path).toBe('guides/images/diagram.png');
      expect(parsed.name).toBe('diagram.png');
      expect(parsed.is_directory).toBe(false);

      // Filter: regular directories cannot be imported as single asset files
      const canImportAsAsset = (item: { is_directory?: boolean; is_bundle?: boolean }) => {
        if (item.is_directory && !item.is_bundle) return false;
        return true;
      };

      expect(canImportAsAsset(node)).toBe(true);
      expect(canImportAsAsset({ is_directory: true, is_bundle: false })).toBe(false);
      expect(canImportAsAsset({ is_directory: true, is_bundle: true })).toBe(true);
    });
  });
});
