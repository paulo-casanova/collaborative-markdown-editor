export class ApiError extends Error {
  constructor(
    public status: number,
    public error: string,
    message: string,
    public timestamp?: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const TOKEN_STORAGE_KEY = 'cme_auth_token';

export async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem(TOKEN_STORAGE_KEY) : null;
  const headers = new Headers(options.headers || {});

  if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(endpoint, {
    ...options,
    headers,
    credentials: 'include', // Include cookies for session auth
  });

  if (!response.ok) {
    let errorJson: { error?: string; message?: string; timestamp?: string } = {};
    try {
      errorJson = await response.json();
    } catch {
      // Body is not JSON
    }
    throw new ApiError(
      response.status,
      errorJson.error || 'RequestFailed',
      errorJson.message || `HTTP ${response.status}: ${response.statusText}`,
      errorJson.timestamp
    );
  }

  // Handle 204 No Content
  if (response.status === 204) {
    return {} as T;
  }

  const contentType = response.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    return (await response.json()) as T;
  }

  return (await response.text()) as unknown as T;
}
