import { apiFetch, ApiError } from './client';

export interface DocumentCheckout {
  id: string;
  document_id: string;
  fs_path: string;
  user_id: string;
  username: string;
  display_name: string;
  checked_out_at: string;
  is_checked_out_by_me?: boolean;
}

export interface BinaryRevision {
  id: string;
  document_id: string;
  revision_number: number;
  fs_path: string;
  byte_size: number;
  sha256_hash: string;
  user_id: string;
  username: string;
  display_name: string;
  created_at: string;
  summary: string;
}

export interface CheckoutStatusResponse {
  is_checked_out: boolean;
  checkout?: DocumentCheckout;
}

/**
 * Checks out a document, acquiring an exclusive lock on it.
 */
export async function checkoutDocument(path: string): Promise<DocumentCheckout> {
  const res = await apiFetch('/api/v1/workspaces/checkouts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  });

  if (!res.ok) {
    const errorJson = await res.json().catch(() => ({}));
    throw new ApiError(
      res.status,
      res.statusText,
      errorJson.error || 'Failed to checkout document'
    );
  }

  return res.json();
}

/**
 * Cancels a document checkout, releasing the exclusive lock.
 */
export async function cancelCheckout(path: string): Promise<void> {
  const res = await apiFetch('/api/v1/workspaces/checkouts', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  });

  if (!res.ok) {
    const errorJson = await res.json().catch(() => ({}));
    throw new ApiError(
      res.status,
      res.statusText,
      errorJson.error || 'Failed to cancel checkout'
    );
  }
}

/**
 * Checks in a modified document, creating a historical revision and replacing active content.
 */
export async function checkinDocument(
  path: string,
  content: Blob | File | ArrayBuffer | string,
  summary: string = ''
): Promise<{ success: boolean; revision: BinaryRevision }> {
  const query = new URLSearchParams({
    path,
    summary,
  });

  const headers: Record<string, string> = {
    'Content-Type': 'application/octet-stream',
  };

  const res = await apiFetch(`/api/v1/workspaces/checkins?${query.toString()}`, {
    method: 'POST',
    headers,
    body: content,
  });

  if (!res.ok) {
    const errorJson = await res.json().catch(() => ({}));
    throw new ApiError(
      res.status,
      res.statusText,
      errorJson.error || 'Failed to check in document'
    );
  }

  return res.json();
}

/**
 * Lists all active checkouts held by the current user.
 */
export async function fetchMyCheckouts(): Promise<DocumentCheckout[]> {
  const res = await apiFetch('/api/v1/workspaces/checkouts');
  if (!res.ok) {
    throw new ApiError(res.status, res.statusText, 'Failed to list checkouts');
  }
  const data = await res.json();
  if (Array.isArray(data)) {
    return data;
  }
  if (data && Array.isArray(data.checkouts)) {
    return data.checkouts;
  }
  return [];
}

/**
 * Fetches checkout lock status for a specific file path.
 */
export async function fetchCheckoutStatus(path: string): Promise<CheckoutStatusResponse> {
  const query = new URLSearchParams({ path });
  const res = await apiFetch(`/api/v1/workspaces/checkouts/status?${query.toString()}`);
  if (!res.ok) {
    throw new ApiError(res.status, res.statusText, 'Failed to fetch checkout status');
  }
  return res.json();
}

/**
 * Lists all previous binary revisions for a file.
 */
export async function fetchBinaryRevisions(path: string): Promise<BinaryRevision[]> {
  const query = new URLSearchParams({ path });
  const res = await apiFetch(`/api/v1/workspaces/checkouts/history?${query.toString()}`);
  if (!res.ok) {
    throw new ApiError(res.status, res.statusText, 'Failed to fetch revision history');
  }
  const data = await res.json();
  if (Array.isArray(data)) {
    return data;
  }
  if (data && Array.isArray(data.revisions)) {
    return data.revisions;
  }
  return [];
}

/**
 * Builds the URL to download a specific historical binary revision.
 */
export function getBinaryRevisionDownloadUrl(path: string, rev: number): string {
  const query = new URLSearchParams({
    path,
    rev: rev.toString(),
  });
  return `/api/v1/workspaces/checkouts/history/download?${query.toString()}`;
}
