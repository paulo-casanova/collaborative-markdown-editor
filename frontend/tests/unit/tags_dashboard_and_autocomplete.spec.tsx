import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { TagsView } from '../../src/components/tags/TagsView';
import * as tagsApi from '../../src/api/tags';
import { tagCompletionSource } from '../../src/components/editor/codemirror/tagAutocomplete';

vi.mock('../../src/api/tags', () => ({
  fetchTags: vi.fn(),
  fetchTagDocuments: vi.fn(),
}));

describe('TagsView & Tags Autocomplete', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
  });

  const mockTags: tagsApi.TagSummary[] = [
    { tag: 'project/core', document_count: 3, occurrence_count: 5 },
    { tag: 'architecture', document_count: 2, occurrence_count: 3 },
    { tag: 'v1-release', document_count: 1, occurrence_count: 1 },
  ];

  const mockTagDocs: tagsApi.TagDocumentsResponse = {
    tag: 'project/core',
    total_documents: 2,
    documents: [
      {
        id: 'doc-uuid-1',
        title: 'Release Roadmap',
        path: 'plans/release.md',
        updated_at: new Date(Date.now() - 3600000).toISOString(),
        occurrence_count: 2,
        occurrences: [
          { heading_anchor: 'q4-milestones', line_number: 14 },
          { heading_anchor: 'deliverables', line_number: 45 },
        ],
      },
      {
        id: 'doc-uuid-2',
        title: 'Architecture Spec',
        path: 'specs/arch.md',
        updated_at: new Date(Date.now() - 7200000).toISOString(),
        occurrence_count: 1,
        occurrences: [{ heading_anchor: 'system-overview', line_number: 8 }],
      },
    ],
  };

  it('renders tags explorer list, document counts, and matched document cards', () => {
    queryClient.setQueryData(['tags'], mockTags);
    queryClient.setQueryData(['tag-documents', 'project/core'], mockTagDocs);

    const html = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <TagsView selectedTag="project/core" />
        </MemoryRouter>
      </QueryClientProvider>
    );

    // Verify left column tag explorer
    expect(html).toContain('Tags Explorer');
    expect(html).toContain('#project/core');
    expect(html).toContain('#architecture');
    expect(html).toContain('#v1-release');
    expect(html).toContain('>3</span>');

    // Verify right column matched documents
    expect(html).toContain('Release Roadmap');
    expect(html).toContain('plans/release.md');
    expect(html).toContain('q4-milestones');
    expect(html).toContain('deliverables');

    expect(html).toContain('Architecture Spec');
    expect(html).toContain('specs/arch.md');
    expect(html).toContain('system-overview');

    // Verify action links
    expect(html).toContain('href="/documents/doc-uuid-1"');
    expect(html).toContain('href="/docs/doc-uuid-1"');
    expect(html).toContain('href="/documents/doc-uuid-1#q4-milestones"');
  });

  it('renders empty state when no tags exist', () => {
    queryClient.setQueryData(['tags'], []);

    const html = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <TagsView />
        </MemoryRouter>
      </QueryClientProvider>
    );

    expect(html).toContain('No tags found across documents');
    expect(html).toContain('No Tag Selected');
  });

  it('tagCompletionSource triggers on # prefix and resolves candidates', async () => {
    vi.mocked(tagsApi.fetchTags).mockResolvedValue([
      { tag: 'project/core', document_count: 4, occurrence_count: 6 },
      { tag: 'project/frontend', document_count: 2, occurrence_count: 3 },
    ]);

    const mockContext: any = {
      matchBefore: (regex: RegExp) => {
        const text = 'Check #proj';
        const match = regex.exec(text);
        return match ? { from: 6, to: 11, text: '#proj' } : null;
      },
      state: {
        doc: {
          sliceString: (from: number, to: number) => 'Check #proj'.slice(from, to),
        },
      },
    };

    const res = await tagCompletionSource(mockContext);
    expect(res).not.toBeNull();
    expect(res?.options).toHaveLength(2);
    expect(res?.options[0].label).toBe('#project/core');
    expect(res?.options[0].displayLabel).toBe('#project/core');
    expect(res?.options[0].detail).toBe('4 docs');
    expect(res?.options[0].apply).toBe('#project/core ');
  });

  it('tagCompletionSource ignores # in words without preceding delimiter', async () => {
    const mockContextNoDelimiter: any = {
      matchBefore: (regex: RegExp) => {
        const text = 'word#proj';
        const match = regex.exec(text);
        return match ? { from: 4, to: 9, text: '#proj' } : null;
      },
      state: {
        doc: {
          sliceString: (from: number, to: number) => 'word#proj'.slice(from, to),
        },
      },
    };

    const res = await tagCompletionSource(mockContextNoDelimiter);
    expect(res).toBeNull();
  });
});
