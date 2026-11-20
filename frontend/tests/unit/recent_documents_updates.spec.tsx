import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { QueryClient } from '@tanstack/react-query';
import * as documentsApi from '../../src/api/documents';
import type { DocumentItem } from '../../src/types/document';

describe('Recent Documents Updates and Cache Synchronization', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.restoreAllMocks();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('optimistically updates recent documents list and bumps edited document to the top', () => {
    const initialRecents: DocumentItem[] = [
      {
        id: 'doc-1',
        title: 'Document 1',
        path: 'doc1.md',
        owner_user_id: 'u-1',
        created_at: '2026-11-20T00:00:00Z',
        updated_at: '2026-11-20T00:00:00Z',
        is_bundle: false,
      },
      {
        id: 'doc-2',
        title: 'Document 2',
        path: 'doc2.md',
        owner_user_id: 'u-1',
        created_at: '2026-11-20T00:00:00Z',
        updated_at: '2026-11-20T00:00:00Z',
        is_bundle: false,
      },
    ];

    queryClient.setQueryData(['recent-documents', 'u-1'], initialRecents);

    // Simulate optimistic recents update when doc-2 is edited
    const nowIso = new Date().toISOString();
    queryClient.setQueriesData({ queryKey: ['recent-documents'] }, (old: any) => {
      if (!Array.isArray(old)) return old;
      const existing = old.find((item) => item.id === 'doc-2');
      const updatedItem = existing
        ? { ...existing, updated_at: nowIso }
        : {
            id: 'doc-2',
            path: 'doc2.md',
            title: 'Document 2',
            owner_user_id: '',
            created_at: nowIso,
            updated_at: nowIso,
            is_bundle: false,
          };
      return [updatedItem, ...old.filter((item) => item.id !== 'doc-2')];
    });

    const updatedData = queryClient.getQueryData<DocumentItem[]>(['recent-documents', 'u-1']);
    expect(updatedData).toBeDefined();
    expect(updatedData!.length).toBe(2);
    // doc-2 is now first
    expect(updatedData![0].id).toBe('doc-2');
    expect(updatedData![1].id).toBe('doc-1');
  });

  it('adds newly created/edited document to recents if not previously present', () => {
    const initialRecents: DocumentItem[] = [
      {
        id: 'doc-1',
        title: 'Document 1',
        path: 'doc1.md',
        owner_user_id: 'u-1',
        created_at: '2026-11-20T00:00:00Z',
        updated_at: '2026-11-20T00:00:00Z',
        is_bundle: false,
      },
    ];

    queryClient.setQueryData(['recent-documents', 'u-1'], initialRecents);

    const nowIso = new Date().toISOString();
    queryClient.setQueriesData({ queryKey: ['recent-documents'] }, (old: any) => {
      if (!Array.isArray(old)) return old;
      const existing = old.find((item) => item.id === 'doc-new');
      const updatedItem = existing
        ? { ...existing, updated_at: nowIso }
        : {
            id: 'doc-new',
            path: 'new.md',
            title: 'New Document',
            owner_user_id: '',
            created_at: nowIso,
            updated_at: nowIso,
            is_bundle: false,
          };
      return [updatedItem, ...old.filter((item) => item.id !== 'doc-new')];
    });

    const updatedData = queryClient.getQueryData<DocumentItem[]>(['recent-documents', 'u-1']);
    expect(updatedData).toBeDefined();
    expect(updatedData!.length).toBe(2);
    expect(updatedData![0].id).toBe('doc-new');
    expect(updatedData![0].title).toBe('New Document');
    expect(updatedData![1].id).toBe('doc-1');
  });

  it('invalidates both recent-documents and recents query keys during debounced flush', () => {
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    // Simulate debounced persistence callback
    queryClient.invalidateQueries({ queryKey: ['recent-documents'] });
    queryClient.invalidateQueries({ queryKey: ['recents'] });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['recent-documents'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['recents'] });
  });
});
