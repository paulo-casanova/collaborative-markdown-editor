import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AgentActionCard } from '../../src/components/dialog/AgentActionCard';
import { AgentAction } from '../../src/types/dialog';

describe('AgentActionCard', () => {
  it('renders direct_edit action with diff preview and applied status', () => {
    const action: AgentAction = {
      id: 'act-1',
      dialog_id: 'dlg-1',
      action: 'direct_edit',
      payload: {
        original_text: 'old erroneous line',
        replacement_text: 'new corrected line',
      },
      status: 'applied',
      timestamp: Date.now(),
    };

    const html = renderToStaticMarkup(<AgentActionCard action={action} />);
    expect(html).toContain('Direct Edit Applied');
    expect(html).toContain('Applied');
    expect(html).toContain('- old erroneous line');
    expect(html).toContain('+ new corrected line');
  });

  it('renders add_suggestion action with original and proposed text', () => {
    const action: AgentAction = {
      id: 'act-2',
      dialog_id: 'dlg-1',
      action: 'add_suggestion',
      payload: {
        original_text: 'The quick brown fox',
        suggested_text: 'The agile auburn fox',
      },
      status: 'applied',
      timestamp: Date.now(),
    };

    const html = renderToStaticMarkup(<AgentActionCard action={action} />);
    expect(html).toContain('Review Suggestion Added');
    expect(html).toContain('&quot;The quick brown fox&quot;');
    expect(html).toContain('&quot;The agile auburn fox&quot;');
  });

  it('renders reject_suggestion and accept_suggestion actions', () => {
    const rejectAction: AgentAction = {
      id: 'act-3',
      dialog_id: 'dlg-1',
      action: 'reject_suggestion',
      payload: { suggestion_id: 'sugg-99' },
      status: 'applied',
      timestamp: Date.now(),
    };

    const rejectHtml = renderToStaticMarkup(<AgentActionCard action={rejectAction} />);
    expect(rejectHtml).toContain('Suggestion Rejected');
    expect(rejectHtml).toContain('sugg-99');

    const acceptAction: AgentAction = {
      id: 'act-4',
      dialog_id: 'dlg-1',
      action: 'accept_suggestion',
      payload: { suggestion_id: 'sugg-100' },
      status: 'applied',
      timestamp: Date.now(),
    };

    const acceptHtml = renderToStaticMarkup(<AgentActionCard action={acceptAction} />);
    expect(acceptHtml).toContain('Suggestion Accepted');
    expect(acceptHtml).toContain('sugg-100');
  });

  it('renders add_comment and reply_comment actions with status', () => {
    const commentAction: AgentAction = {
      id: 'act-5',
      dialog_id: 'dlg-1',
      action: 'add_comment',
      payload: {
        content: 'Why was this algorithm chosen?',
        target_text: 'eviction policy',
      },
      status: 'applied',
      timestamp: Date.now(),
    };

    const commentHtml = renderToStaticMarkup(<AgentActionCard action={commentAction} />);
    expect(commentHtml).toContain('Comment Created');
    expect(commentHtml).toContain('&quot;Why was this algorithm chosen?&quot;');
    expect(commentHtml).toContain('On: &quot;eviction policy&quot;');

    const replyAction: AgentAction = {
      id: 'act-6',
      dialog_id: 'dlg-1',
      action: 'reply_comment',
      payload: {
        comment_id: 'comm-42',
        content: 'We benchmarked it and it outperformed LRU by 15%.',
      },
      status: 'applied',
      timestamp: Date.now(),
    };

    const replyHtml = renderToStaticMarkup(<AgentActionCard action={replyAction} />);
    expect(replyHtml).toContain('Comment Replied');
    expect(replyHtml).toContain('comm-42');
    expect(replyHtml).toContain('&quot;We benchmarked it and it outperformed LRU by 15%.&quot;');
  });

  it('renders pending and failed status badges correctly', () => {
    const pendingAction: AgentAction = {
      id: 'act-7',
      dialog_id: 'dlg-1',
      action: 'direct_edit',
      payload: { diff: '---' },
      status: 'pending',
      timestamp: Date.now(),
    };

    const pendingHtml = renderToStaticMarkup(<AgentActionCard action={pendingAction} />);
    expect(pendingHtml).toContain('Applying');

    const failedAction: AgentAction = {
      id: 'act-8',
      dialog_id: 'dlg-1',
      action: 'direct_edit',
      payload: { diff: '---' },
      status: 'failed',
      error: 'Target text not found in document',
      timestamp: Date.now(),
    };

    const failedHtml = renderToStaticMarkup(<AgentActionCard action={failedAction} />);
    expect(failedHtml).toContain('Failed');
    expect(failedHtml).toContain('Error: Target text not found in document');
  });
});
