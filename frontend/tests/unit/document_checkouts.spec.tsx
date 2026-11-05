import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { CheckedOutPage } from '../../src/pages/CheckedOutPage';
import { CheckinModal } from '../../src/components/checkouts/CheckinModal';
import { BinaryHistoryModal } from '../../src/components/checkouts/BinaryHistoryModal';
import * as checkoutsApi from '../../src/api/checkouts';
import { getBinaryRevisionDownloadUrl } from '../../src/api/checkouts';
import { isFileSystemAccessSupported, saveCheckedOutFile } from '../../src/utils/localCheckoutStorage';

vi.mock('../../src/api/checkouts', async (importOriginal) => {
  const actual = await importOriginal<typeof checkoutsApi>();
  return {
    ...actual,
    fetchMyCheckouts: vi.fn(),
    fetchBinaryRevisions: vi.fn(),
    checkoutDocument: vi.fn(),
    cancelCheckout: vi.fn(),
    checkinDocument: vi.fn(),
  };
});

describe('Document Checkouts & Revision History', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
  });

  const mockCheckouts: checkoutsApi.DocumentCheckout[] = [
    {
      id: 'co-1',
      document_id: 'doc-uuid-1',
      fs_path: 'financials/Q3_Budget.xlsx',
      user_id: 'u-1',
      username: 'alice',
      display_name: 'Alice Analyst',
      checked_out_at: '2026-11-05T08:30:00Z',
      is_checked_out_by_me: true,
    },
    {
      id: 'co-2',
      document_id: 'doc-uuid-2',
      fs_path: 'contracts/Vendor_Agreement.docx',
      user_id: 'u-1',
      username: 'alice',
      display_name: 'Alice Analyst',
      checked_out_at: '2026-11-05T09:00:00Z',
      is_checked_out_by_me: true,
    },
  ];

  const mockRevisions: checkoutsApi.BinaryRevision[] = [
    {
      id: 'rev-2',
      document_id: 'doc-uuid-1',
      revision_number: 2,
      fs_path: 'financials/Q3_Budget.xlsx',
      byte_size: 45200,
      sha256_hash: 'abcdef1234567890',
      user_id: 'u-1',
      username: 'alice',
      display_name: 'Alice Analyst',
      created_at: '2026-11-05T10:00:00Z',
      summary: 'Updated department headcount',
    },
    {
      id: 'rev-1',
      document_id: 'doc-uuid-1',
      revision_number: 1,
      fs_path: 'financials/Q3_Budget.xlsx',
      byte_size: 41000,
      sha256_hash: '123456abcdef7890',
      user_id: 'u-2',
      username: 'bob',
      display_name: 'Bob Director',
      created_at: '2026-11-04T16:00:00Z',
      summary: 'Initial draft from template',
    },
  ];

  it('renders CheckedOutPage with active checkouts table and actions', () => {
    queryClient.setQueryData(['my-checkouts'], mockCheckouts);

    const html = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <CheckedOutPage />
        </MemoryRouter>
      </QueryClientProvider>
    );

    expect(html).toContain('Checked Out Documents');
    expect(html).toContain('Q3_Budget.xlsx');
    expect(html).toContain('financials/Q3_Budget.xlsx');
    expect(html).toContain('Vendor_Agreement.docx');
    expect(html).toContain('contracts/Vendor_Agreement.docx');
    expect(html).toContain('Check In');
    expect(html).toContain('Download');
    expect(html).toContain('History');
    expect(html).toContain('Cancel');
  });

  it('handles nested { checkouts: [...] } response shape gracefully without blank screen', () => {
    queryClient.setQueryData(['my-checkouts'], { checkouts: mockCheckouts } as any);

    const html = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <CheckedOutPage />
        </MemoryRouter>
      </QueryClientProvider>
    );

    expect(html).toContain('Checked Out Documents');
    expect(html).toContain('Q3_Budget.xlsx');
    expect(html).toContain('financials/Q3_Budget.xlsx');
  });

  it('handles nested { checkouts: [] } response shape in CheckedOutPage without error', () => {
    queryClient.setQueryData(['my-checkouts'], { checkouts: [] } as any);

    const html = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <CheckedOutPage />
        </MemoryRouter>
      </QueryClientProvider>
    );

    expect(html).toContain('No Checked Out Documents');
  });

  it('renders CheckedOutPage empty state when user has no active checkouts', () => {
    queryClient.setQueryData(['my-checkouts'], []);

    const html = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <CheckedOutPage />
        </MemoryRouter>
      </QueryClientProvider>
    );

    expect(html).toContain('No Checked Out Documents');
    expect(html).toContain('When you check out a non-markdown file');
  });

  it('renders CheckinModal with dropzone and change summary input', () => {
    const html = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <CheckinModal
          isOpen={true}
          onClose={vi.fn()}
          path="financials/Q3_Budget.xlsx"
          filename="Q3_Budget.xlsx"
        />
      </QueryClientProvider>
    );

    expect(html).toContain('Check In Document');
    expect(html).toContain('financials/Q3_Budget.xlsx');
    expect(html).toContain('Click or drag &amp; drop updated file');
    expect(html).toContain('Revision Summary (optional)');
    expect(html).toContain('Replaces current active version in CME');
  });

  it('does not render CheckinModal when isOpen is false', () => {
    const html = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <CheckinModal
          isOpen={false}
          onClose={vi.fn()}
          path="financials/Q3_Budget.xlsx"
          filename="Q3_Budget.xlsx"
        />
      </QueryClientProvider>
    );

    expect(html).toBe('');
  });

  it('renders BinaryHistoryModal with historical revision table', () => {
    queryClient.setQueryData(['checkout-history', 'financials/Q3_Budget.xlsx'], mockRevisions);

    const html = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <BinaryHistoryModal
          isOpen={true}
          onClose={vi.fn()}
          path="financials/Q3_Budget.xlsx"
          filename="Q3_Budget.xlsx"
        />
      </QueryClientProvider>
    );

    expect(html).toContain('Revision History');
    expect(html).toContain('financials/Q3_Budget.xlsx');
    expect(html).toContain('#2');
    expect(html).toContain('Updated department headcount');
    expect(html).toContain('Alice Analyst');
    expect(html).toContain('#1');
    expect(html).toContain('Initial draft from template');
    expect(html).toContain('Bob Director');
    expect(html).toContain('Download Revision #2');
    expect(html).toContain('Download Revision #1');
  });

  it('handles nested { revisions: [...] } response shape in BinaryHistoryModal gracefully', () => {
    queryClient.setQueryData(
      ['checkout-history', 'financials/Q3_Budget.xlsx'],
      { revisions: mockRevisions } as any
    );

    const html = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <BinaryHistoryModal
          isOpen={true}
          onClose={vi.fn()}
          path="financials/Q3_Budget.xlsx"
          filename="Q3_Budget.xlsx"
        />
      </QueryClientProvider>
    );

    expect(html).toContain('Revision History');
    expect(html).toContain('#2');
    expect(html).toContain('Alice Analyst');
  });

  it('renders BinaryHistoryModal empty state when no historical revisions exist', () => {
    queryClient.setQueryData(['checkout-history', 'financials/Q3_Budget.xlsx'], []);

    const html = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <BinaryHistoryModal
          isOpen={true}
          onClose={vi.fn()}
          path="financials/Q3_Budget.xlsx"
          filename="Q3_Budget.xlsx"
        />
      </QueryClientProvider>
    );

    expect(html).toContain('No historical revisions found');
    expect(html).toContain('Historical revisions are archived automatically');
  });

  it('constructs correct binary revision download URL', () => {
    const url = getBinaryRevisionDownloadUrl('financials/Q3_Budget.xlsx', 2);
    expect(url).toBe('/api/v1/workspaces/checkouts/history/download?path=financials%2FQ3_Budget.xlsx&rev=2');
  });

  it('falls back to browser download in localCheckoutStorage when File System Access API is not active', async () => {
    const mockClick = vi.fn();
    const mockA = { href: '', download: '', click: mockClick } as any;
    const originalDoc = globalThis.document;
    const originalCreateObjectURL = globalThis.URL?.createObjectURL;
    const originalRevokeObjectURL = globalThis.URL?.revokeObjectURL;

    // @ts-expect-error mock document in node environment
    globalThis.document = {
      createElement: vi.fn(() => mockA),
      body: {
        appendChild: vi.fn(),
        removeChild: vi.fn(),
      },
    };
    if (globalThis.URL) {
      globalThis.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
      globalThis.URL.revokeObjectURL = vi.fn();
    }

    try {
      const blob = new Blob(['mock binary content'], { type: 'application/octet-stream' });
      const result = await saveCheckedOutFile('test.docx', blob);
      expect(result.method).toBe('download');
      expect(globalThis.document.createElement).toHaveBeenCalledWith('a');
      expect(mockClick).toHaveBeenCalled();
    } finally {
      globalThis.document = originalDoc;
      if (globalThis.URL) {
        globalThis.URL.createObjectURL = originalCreateObjectURL;
        globalThis.URL.revokeObjectURL = originalRevokeObjectURL;
      }
    }
  });
});
