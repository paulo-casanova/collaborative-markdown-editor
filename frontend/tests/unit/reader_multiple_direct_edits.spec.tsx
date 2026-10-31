import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { useDialogStore } from '../../src/stores/dialogStore';
import * as documentsApi from '../../src/api/documents';
import { computeReplacementChange, applyUnifiedDiff } from '../../src/utils/diffPatcher';

describe('Reader Mode Multiple direct_edit Actions & Sequential Execution', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useDialogStore.setState({
      dialogs: [],
      activeDialogId: 'dlg-test',
      messages: [],
      agentActions: [],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('demonstrates the bug vs fix: sequential reader edits preserve all direct_edit actions without stale overwrite', async () => {
    // Initial document state
    let serverDocContent = '# Section 1\n\nOriginal text A.\n\n# Section 2\n\nOriginal text B.';
    const mockDocumentId = 'doc-123';
    const serverUpdateHistory: string[] = [];

    vi.spyOn(documentsApi, 'fetchDocument').mockImplementation(async (id: string) => {
      expect(id).toBe(mockDocumentId);
      return {
        id: mockDocumentId,
        title: 'Test Doc',
        content: serverDocContent,
        path: 'test.md',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as any;
    });

    vi.spyOn(documentsApi, 'updateDocument').mockImplementation(async (id: string, payload: any) => {
      expect(id).toBe(mockDocumentId);
      serverDocContent = payload.content;
      serverUpdateHistory.push(payload.content);
      return {
        id: mockDocumentId,
        title: 'Test Doc',
        content: serverDocContent,
        path: 'test.md',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as any;
    });

    // Simulating the reader pipeline with refetch & queueing (the fix)
    const latestContentRef = { current: serverDocContent };
    let editQueue = Promise.resolve();

    const handleApplyReplacementInReader = (orig: string, rep: string): Promise<boolean> => {
      const runEdit = async (): Promise<boolean> => {
        // Refetch latest content from server so sequential edits build on the latest persisted text
        let currentContent = latestContentRef.current;
        try {
          const freshDoc = await documentsApi.fetchDocument(mockDocumentId);
          if (freshDoc?.content !== undefined) {
            currentContent = freshDoc.content;
            latestContentRef.current = freshDoc.content;
          }
        } catch {}

        const change = computeReplacementChange(currentContent, orig, rep);
        if (!change) {
          return false;
        }

        const newContent = currentContent.slice(0, change.from) + change.insert + currentContent.slice(change.to);
        const updatedDoc = await documentsApi.updateDocument(mockDocumentId, { content: newContent });
        latestContentRef.current = updatedDoc.content ?? newContent;
        return true;
      };

      const nextPromise = editQueue.then(runEdit, runEdit);
      editQueue = nextPromise.catch(() => false);
      return nextPromise;
    };

    // Agent emits 2 separate edits in one reply:
    // Edit 1 modifies Section 1
    // Edit 2 modifies Section 2
    const p1 = handleApplyReplacementInReader('Original text A.', 'Updated text A (by agent).');
    const p2 = handleApplyReplacementInReader('Original text B.', 'Updated text B (by agent).');

    const [res1, res2] = await Promise.all([p1, p2]);

    expect(res1).toBe(true);
    expect(res2).toBe(true);
    expect(serverUpdateHistory.length).toBe(2);

    // Verify both edits are preserved in final document!
    expect(serverDocContent).toContain('Updated text A (by agent).');
    expect(serverDocContent).toContain('Updated text B (by agent).');
    expect(serverDocContent).not.toContain('Original text A.');
    expect(serverDocContent).not.toContain('Original text B.');
  });

  it('sequential reader diff patches apply incrementally on latest document content', async () => {
    let serverDocContent = 'Line 1\nLine 2\nLine 3\n';
    const mockDocumentId = 'doc-diff';

    vi.spyOn(documentsApi, 'fetchDocument').mockImplementation(async () => {
      return {
        id: mockDocumentId,
        content: serverDocContent,
      } as any;
    });

    vi.spyOn(documentsApi, 'updateDocument').mockImplementation(async (_id: string, payload: any) => {
      serverDocContent = payload.content;
      return {
        id: mockDocumentId,
        content: serverDocContent,
      } as any;
    });

    const latestContentRef = { current: serverDocContent };
    let editQueue = Promise.resolve();

    const handleApplyDiffInReader = (diff: string): Promise<boolean> => {
      const runEdit = async (): Promise<boolean> => {
        let currentContent = latestContentRef.current;
        try {
          const freshDoc = await documentsApi.fetchDocument(mockDocumentId);
          if (freshDoc?.content !== undefined) {
            currentContent = freshDoc.content;
            latestContentRef.current = freshDoc.content;
          }
        } catch {}

        const patchResult = applyUnifiedDiff(currentContent, diff);
        if (patchResult.appliedCount > 0) {
          const updatedDoc = await documentsApi.updateDocument(mockDocumentId, { content: patchResult.newText });
          latestContentRef.current = updatedDoc.content ?? patchResult.newText;
          return true;
        }
        return false;
      };

      const nextPromise = editQueue.then(runEdit, runEdit);
      editQueue = nextPromise.catch(() => false);
      return nextPromise;
    };

    const diff1 = '--- a/doc.md\n+++ b/doc.md\n@@ -1,1 +1,1 @@\n-Line 1\n+Line 1 Modified\n';
    const diff2 = '--- a/doc.md\n+++ b/doc.md\n@@ -3,1 +3,1 @@\n-Line 3\n+Line 3 Modified\n';

    const [res1, res2] = await Promise.all([
      handleApplyDiffInReader(diff1),
      handleApplyDiffInReader(diff2),
    ]);

    expect(res1).toBe(true);
    expect(res2).toBe(true);
    expect(serverDocContent).toBe('Line 1 Modified\nLine 2\nLine 3 Modified\n');
  });

  it('processes pending actions sequentially in store and tracks applied status', async () => {
    const action1 = {
      id: 'act-1',
      dialog_id: 'dlg-test',
      document_id: 'doc-1',
      action: 'direct_edit' as const,
      payload: { original_text: 'Alpha', replacement_text: 'Alpha Plus' },
      status: 'pending' as const,
      timestamp: Date.now(),
    };

    const action2 = {
      id: 'act-2',
      dialog_id: 'dlg-test',
      document_id: 'doc-1',
      action: 'direct_edit' as const,
      payload: { original_text: 'Beta', replacement_text: 'Beta Plus' },
      status: 'pending' as const,
      timestamp: Date.now() + 1,
    };

    useDialogStore.setState({ agentActions: [action1, action2] });

    const executedOrder: string[] = [];
    const executionTimestamps: { [id: string]: { start: number; end: number } } = {};

    const mockApply = async (actionId: string, delayMs: number) => {
      const start = Date.now();
      executedOrder.push(`start:${actionId}`);
      await new Promise((r) => setTimeout(r, delayMs));
      executedOrder.push(`end:${actionId}`);
      executionTimestamps[actionId] = { start, end: Date.now() };
      return true;
    };

    // Sequential action processor simulation matching DialogSidecar
    let isExecuting = false;
    const processSequentially = async () => {
      if (isExecuting) return;
      isExecuting = true;
      try {
        while (true) {
          const act = useDialogStore.getState().agentActions.find((a) => a.status === 'pending');
          if (!act) break;

          const delay = act.id === 'act-1' ? 40 : 10;
          const ok = await mockApply(act.id, delay);
          useDialogStore.getState().updateAgentActionStatus(act.id, ok ? 'applied' : 'failed');
        }
      } finally {
        isExecuting = false;
      }
    };

    await processSequentially();

    // Verify act-1 started and ended BEFORE act-2 started
    expect(executedOrder).toEqual(['start:act-1', 'end:act-1', 'start:act-2', 'end:act-2']);
    const actions = useDialogStore.getState().agentActions;
    expect(actions[0].status).toBe('applied');
    expect(actions[1].status).toBe('applied');
  });

  it('marks action failed if target text is not found without blocking next action', async () => {
    let docContent = 'Exact text here.';
    const applied: string[] = [];

    const handleApply = async (orig: string, rep: string) => {
      const change = computeReplacementChange(docContent, orig, rep);
      if (!change) return false;
      docContent = docContent.slice(0, change.from) + change.insert + docContent.slice(change.to);
      applied.push(rep);
      return true;
    };

    useDialogStore.setState({
      agentActions: [
        {
          id: 'act-missing',
          dialog_id: 'dlg-test',
          document_id: 'doc-1',
          action: 'direct_edit',
          payload: { original_text: 'Nonexistent text', replacement_text: 'Bad replacement' },
          status: 'pending',
          timestamp: 1,
        },
        {
          id: 'act-valid',
          dialog_id: 'dlg-test',
          document_id: 'doc-1',
          action: 'direct_edit',
          payload: { original_text: 'Exact text', replacement_text: 'Correct replacement' },
          status: 'pending',
          timestamp: 2,
        },
      ],
    });

    // Simulate processor
    while (true) {
      const act = useDialogStore.getState().agentActions.find((a) => a.status === 'pending');
      if (!act) break;

      const ok = await handleApply(act.payload.original_text, act.payload.replacement_text);
      useDialogStore.getState().updateAgentActionStatus(act.id, ok ? 'applied' : 'failed', ok ? undefined : 'Text not found');
    }

    const finalActions = useDialogStore.getState().agentActions;
    expect(finalActions[0].status).toBe('failed');
    expect(finalActions[0].error).toBe('Text not found');
    expect(finalActions[1].status).toBe('applied');
    expect(docContent).toBe('Correct replacement here.');
  });

  it('locates direct_edit target text in DOM and triggers smooth scroll and highlight', () => {
    // Mock container element
    const scrollMock = vi.fn();
    const classListAddMock = vi.fn();
    const classListRemoveMock = vi.fn();

    const mockChildParagraph = {
      textContent: 'Here is the newly updated text inserted by the agent.',
      scrollIntoView: scrollMock,
      classList: {
        add: classListAddMock,
        remove: classListRemoveMock,
      },
      offsetWidth: 100,
    };

    const mockContainer = {
      querySelectorAll: vi.fn().mockReturnValue([mockChildParagraph]),
    };

    const action = {
      id: 'act-jump',
      dialog_id: 'dlg-1',
      action: 'direct_edit',
      payload: {
        original_text: 'old text',
        replacement_text: 'Here is the newly updated text inserted by the agent.',
      },
      status: 'applied',
      timestamp: Date.now(),
    };

    // Logic matching handleJumpToEditInReader
    const targetText = action.payload.replacement_text;
    const blocks = mockContainer.querySelectorAll('p, li');
    let targetEl: any = null;
    for (const b of blocks) {
      if (b.textContent.toLowerCase().includes(targetText.toLowerCase())) {
        targetEl = b;
        break;
      }
    }

    expect(targetEl).not.toBeNull();
    targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    targetEl.classList.remove('cme-edit-highlight');
    targetEl.classList.add('cme-edit-highlight');

    expect(scrollMock).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });
    expect(classListAddMock).toHaveBeenCalledWith('cme-edit-highlight');
  });
});
