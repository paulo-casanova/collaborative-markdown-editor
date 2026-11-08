import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TokensModal } from '../../src/components/auth/TokensModal';
import * as authApi from '../../src/api/auth';
import { useUIStore } from '../../src/stores/uiStore';

vi.mock('../../src/api/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof authApi>();
  return {
    ...actual,
    listTokens: vi.fn(),
    createToken: vi.fn(),
    deleteToken: vi.fn(),
  };
});

describe('TokensModal PAT Management', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
    useUIStore.setState({ tokensModalOpen: true });
  });

  it('renders tokens with custom descriptions, prefixes, created dates, and last used times', () => {
    const mockTokens: authApi.PatToken[] = [
      {
        token_hash: 'hash-ci-agent-1234',
        name: 'CI Automation Agent',
        token_prefix: 'cme_ci_9',
        created_at: '2026-11-01T10:00:00Z',
        last_used_at: '2026-11-08T18:00:00Z',
      },
      {
        token_hash: 'hash-llm-script-5678',
        name: 'LLM Document Fetcher',
        token_prefix: 'cme_llm1',
        created_at: '2026-11-05T12:00:00Z',
        last_used_at: undefined,
      },
    ];

    vi.mocked(authApi.listTokens).mockReturnValue(Promise.resolve(mockTokens));
    queryClient.setQueryData(['auth-tokens'], mockTokens);

    const html = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <TokensModal />
      </QueryClientProvider>
    );

    // Verifies names/descriptions
    expect(html).toContain('CI Automation Agent');
    expect(html).toContain('LLM Document Fetcher');

    // Verifies prefixes
    expect(html).toContain('cme_ci_9••••••••');
    expect(html).toContain('cme_llm1••••••••');

    // Verifies last used tracking
    expect(html).toContain('Used ');
    expect(html).toContain('Never used');

    // Verifies revoke button presence
    expect(html).toContain('title="Revoke token"');
  });

  it('renders default fallback name if token has no custom description', () => {
    const mockTokens: authApi.PatToken[] = [
      {
        token_hash: 'hash-legacy-token',
        name: '',
        token_prefix: '',
        created_at: '2026-10-15T08:00:00Z',
      },
    ];

    queryClient.setQueryData(['auth-tokens'], mockTokens);

    const html = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <TokensModal />
      </QueryClientProvider>
    );

    expect(html).toContain('Personal Access Token');
    expect(html).toContain('Never used');
  });

  it('does not render modal when tokensModalOpen is false', () => {
    useUIStore.setState({ tokensModalOpen: false });

    const html = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <TokensModal />
      </QueryClientProvider>
    );

    expect(html).toBe('');
  });
});
