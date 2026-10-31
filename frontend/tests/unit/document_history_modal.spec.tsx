import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DocumentHistoryModal } from '../../src/components/history/DocumentHistoryModal';
import { DocumentRevisionSummary } from '../../src/api/documents';

describe('DocumentHistoryModal Component', () => {
  const sampleRevisions: DocumentRevisionSummary[] = [
    {
      id: 'rev-3',
      document_id: 'doc-1',
      revision_number: 3,
      author_id: 'u-1',
      author_name: 'Alice Developer',
      created_at: new Date(Date.now() - 1000 * 60 * 15).toISOString(), // 15m ago
      byte_size: 4500,
      is_latest: true,
    },
    {
      id: 'rev-2',
      document_id: 'doc-1',
      revision_number: 2,
      author_id: 'u-2',
      author_name: 'Bob Architect',
      created_at: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString(), // 3h ago
      byte_size: 4100,
      is_latest: false,
    },
    {
      id: 'rev-1',
      document_id: 'doc-1',
      revision_number: 1,
      author_id: 'u-1',
      author_name: 'Alice Developer',
      created_at: new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString(), // 2d ago
      byte_size: 3200,
      is_latest: false,
    },
  ];

  it('does not render when isOpen is false', () => {
    const html = renderToStaticMarkup(
      <DocumentHistoryModal
        isOpen={false}
        onClose={vi.fn()}
        documentId="doc-1"
        documentTitle="Architecture Guide"
        revisions={sampleRevisions}
        selectedRevisionNumber={null}
        onSelectRevision={vi.fn()}
        onReturnToLatest={vi.fn()}
      />
    );
    expect(html).toBe('');
  });

  it('renders wider revision history window with resize controls and maximize button', () => {
    const html = renderToStaticMarkup(
      <DocumentHistoryModal
        isOpen={true}
        onClose={vi.fn()}
        documentId="doc-1"
        documentTitle="Architecture Guide"
        revisions={sampleRevisions}
        selectedRevisionNumber={null}
        onSelectRevision={vi.fn()}
        onReturnToLatest={vi.fn()}
      />
    );

    // Modal container & testids
    expect(html).toContain('data-testid="reader-history-modal"');
    expect(html).toContain('data-testid="history-modal-container"');
    expect(html).toContain('data-testid="close-history-modal-btn"');

    // Maximize button
    expect(html).toContain('data-testid="history-modal-maximize-btn"');
    expect(html).toContain('Maximize window');

    // Resize handles
    expect(html).toContain('data-testid="history-modal-resize-right"');
    expect(html).toContain('data-testid="history-modal-resize-left"');
    expect(html).toContain('data-testid="history-modal-resize-bottom"');
    expect(html).toContain('data-testid="history-modal-resizer"');

    // Default wide styling width (980px default)
    expect(html).toContain('width:980px');
    expect(html).toContain('height:650px');
  });

  it('renders table columns including Revision, Author, Date, Size, Change, and Action', () => {
    const html = renderToStaticMarkup(
      <DocumentHistoryModal
        isOpen={true}
        onClose={vi.fn()}
        documentId="doc-1"
        documentTitle="Architecture Guide"
        revisions={sampleRevisions}
        selectedRevisionNumber={2}
        onSelectRevision={vi.fn()}
        onReturnToLatest={vi.fn()}
      />
    );

    // Table header columns
    expect(html).toContain('Revision');
    expect(html).toContain('Author');
    expect(html).toContain('Date &amp; Time');
    expect(html).toContain('Size');
    expect(html).toContain('Change');
    expect(html).toContain('Action');

    // Revisions rows
    expect(html).toContain('data-testid="revisions-table"');
    expect(html).toContain('v3');
    expect(html).toContain('v2');
    expect(html).toContain('v1');

    // Authors
    expect(html).toContain('Alice Developer');
    expect(html).toContain('Bob Architect');

    // Status Badges
    expect(html).toContain('data-testid="latest-badge"');
    expect(html).toContain('Latest');
    expect(html).toContain('data-testid="viewing-badge"');
    expect(html).toContain('Viewing');

    // Size Change Diff calculations
    // rev 3: 4500 - 4100 = +400 B
    expect(html).toContain('+400 B');
    // rev 2: 4100 - 3200 = +900 B
    expect(html).toContain('+900 B');
    // rev 1: initial revision
    expect(html).toContain('Initial');

    // Return to latest button when historical revision (v2) is selected
    expect(html).toContain('data-testid="history-return-latest-btn"');
    expect(html).toContain('Back to Latest Version');
  });

  it('renders search and filter bar when document has multiple revisions', () => {
    const html = renderToStaticMarkup(
      <DocumentHistoryModal
        isOpen={true}
        onClose={vi.fn()}
        documentId="doc-1"
        documentTitle="Architecture Guide"
        revisions={sampleRevisions}
        selectedRevisionNumber={null}
        onSelectRevision={vi.fn()}
        onReturnToLatest={vi.fn()}
      />
    );

    expect(html).toContain('data-testid="history-search-input"');
    expect(html).toContain('placeholder="Filter by author or revision..."');
    expect(html).toContain('Showing 3 of 3 revisions');
  });

  it('renders empty state when revision list is empty', () => {
    const html = renderToStaticMarkup(
      <DocumentHistoryModal
        isOpen={true}
        onClose={vi.fn()}
        documentId="doc-1"
        documentTitle="Architecture Guide"
        revisions={[]}
        selectedRevisionNumber={null}
        onSelectRevision={vi.fn()}
        onReturnToLatest={vi.fn()}
      />
    );

    expect(html).toContain('No historical revisions recorded yet.');
    expect(html).not.toContain('data-testid="revisions-table"');
  });

  it('renders loading state when isLoading is true', () => {
    const html = renderToStaticMarkup(
      <DocumentHistoryModal
        isOpen={true}
        onClose={vi.fn()}
        documentId="doc-1"
        documentTitle="Architecture Guide"
        revisions={[]}
        selectedRevisionNumber={null}
        onSelectRevision={vi.fn()}
        onReturnToLatest={vi.fn()}
        isLoading={true}
      />
    );

    expect(html).toContain('Loading revision history...');
  });
});
