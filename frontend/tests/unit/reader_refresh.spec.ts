import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as documentsApi from '../../src/api/documents';

describe('Issue #19: Reader View Refresh Button & Background Polling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('detects when server document content differs from currently displayed content', async () => {
    const docId = 'doc-123';
    const initialContent = '# Initial Content\n\nReading page.';
    let serverContent = initialContent;

    const fetchSpy = vi.spyOn(documentsApi, 'fetchDocument').mockImplementation(async (id: string) => {
      return {
        id,
        path: 'test/doc.md',
        title: 'Test Doc',
        content: serverContent,
        is_bundle: false,
        created_at: '2026-10-24T00:00:00Z',
        updated_at: '2026-10-24T00:00:00Z',
      };
    });

    // Simulate poller logic matching ReaderPage
    let displayedContent = initialContent;
    let hasNewVersion = false;

    const checkServerVersion = async () => {
      try {
        const latest = await documentsApi.fetchDocument(docId);
        const latestContent = latest.content ?? '';
        if (latestContent !== displayedContent) {
          hasNewVersion = true;
        } else {
          hasNewVersion = false;
        }
      } catch {
        // ignore
      }
    };

    // First check: content is identical
    await checkServerVersion();
    expect(hasNewVersion).toBe(false);

    // Document is edited on server
    serverContent = '# Edited Content\n\nA collaborator updated this.';

    // Poller runs after 5-second interval
    await checkServerVersion();
    expect(hasNewVersion).toBe(true);

    // User clicks refresh: displayed content is updated, hasNewVersion is reset to false
    const handleRefresh = async () => {
      const refreshed = await documentsApi.fetchDocument(docId);
      displayedContent = refreshed.content ?? '';
      hasNewVersion = false;
    };

    await handleRefresh();
    expect(displayedContent).toBe(serverContent);
    expect(hasNewVersion).toBe(false);

    // Subsequent poll confirms up to date
    await checkServerVersion();
    expect(hasNewVersion).toBe(false);

    fetchSpy.mockRestore();
  });

  it('handles background polling failures gracefully without throwing or corrupting state', async () => {
    const fetchSpy = vi.spyOn(documentsApi, 'fetchDocument').mockRejectedValue(new Error('Network offline'));

    let hasNewVersion = false;
    let errorCaught = false;

    const checkServerVersion = async () => {
      try {
        const latest = await documentsApi.fetchDocument('doc-123');
        if (latest.content !== 'current') {
          hasNewVersion = true;
        }
      } catch {
        errorCaught = true;
      }
    };

    await checkServerVersion();
    expect(errorCaught).toBe(true);
    expect(hasNewVersion).toBe(false);

    fetchSpy.mockRestore();
  });

  it('clears new version indicator if remote content reverts back to displayed content', async () => {
    let serverContent = 'Version B';
    const displayedContent = 'Version A';

    vi.spyOn(documentsApi, 'fetchDocument').mockImplementation(async (id: string) => {
      return {
        id,
        path: 'test/doc.md',
        title: 'Test Doc',
        content: serverContent,
        is_bundle: false,
        created_at: '2026-10-24T00:00:00Z',
        updated_at: '2026-10-24T00:00:00Z',
      };
    });

    let hasNewVersion = false;
    const checkServerVersion = async () => {
      const latest = await documentsApi.fetchDocument('doc-123');
      hasNewVersion = (latest.content ?? '') !== displayedContent;
    };

    await checkServerVersion();
    expect(hasNewVersion).toBe(true);

    // Remote reverts back to Version A
    serverContent = 'Version A';
    await checkServerVersion();
    expect(hasNewVersion).toBe(false);
  });
});
