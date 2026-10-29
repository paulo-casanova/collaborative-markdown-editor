import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { useUIStore } from '../../src/stores/uiStore';
import { useDialogStore, sortDialogMessages } from '../../src/stores/dialogStore';
import * as dialogApi from '../../src/api/dialogs';
import { DialogMessage } from '../../src/types/dialog';
import { EditorToolbar } from '../../src/components/editor/EditorToolbar';

describe('Dialogs & Local Agent Subsystem (Phase 3)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useUIStore.setState({
      dialogSidecarOpen: false,
    });
    useDialogStore.setState({
      dialogs: [],
      activeDialogId: null,
      messages: [],
      isLoading: false,
      isSending: false,
      isGenerating: false,
      generatingStartTime: null,
      agentStatus: {
        online: false,
        agent_name: '',
        connected_at: null,
        capabilities: [],
      },
      streamingContent: '',
      activeToolActivity: null,
      diffProposals: [],
      contextSnapshot: null,
      pairingModalOpen: false,
      ws: null,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('toggles dialogSidecarOpen correctly in UIStore', () => {
    expect(useUIStore.getState().dialogSidecarOpen).toBe(false);

    useUIStore.getState().toggleDialogSidecar();
    expect(useUIStore.getState().dialogSidecarOpen).toBe(true);

    useUIStore.getState().toggleDialogSidecar();
    expect(useUIStore.getState().dialogSidecarOpen).toBe(false);

    useUIStore.getState().setDialogSidecarOpen(true);
    expect(useUIStore.getState().dialogSidecarOpen).toBe(true);
  });

  it('manages context snapshot attachments in DialogStore', () => {
    expect(useDialogStore.getState().contextSnapshot).toBeNull();

    useDialogStore.getState().setContextSnapshot({
      document_id: 'doc-123',
      document_title: 'architecture.md',
      selected_text: 'export interface AgentConfig',
      line_start: 45,
    });

    const snapshot = useDialogStore.getState().contextSnapshot;
    expect(snapshot).not.toBeNull();
    expect(snapshot?.document_title).toBe('architecture.md');
    expect(snapshot?.selected_text).toBe('export interface AgentConfig');
    expect(snapshot?.line_start).toBe(45);

    useDialogStore.getState().clearContextSnapshot();
    expect(useDialogStore.getState().contextSnapshot).toBeNull();
  });

  it('accumulates streaming token deltas and tool activity in DialogStore', () => {
    expect(useDialogStore.getState().streamingContent).toBe('');
    expect(useDialogStore.getState().activeToolActivity).toBeNull();

    // Simulate incoming token stream frames
    useDialogStore.setState((s) => ({ streamingContent: s.streamingContent + 'Hello' }));
    useDialogStore.setState((s) => ({ streamingContent: s.streamingContent + ' world!' }));
    expect(useDialogStore.getState().streamingContent).toBe('Hello world!');

    // Simulate tool activity event
    useDialogStore.setState({
      activeToolActivity: {
        tool: 'git_log',
        status: 'reading commits',
      },
    });
    expect(useDialogStore.getState().activeToolActivity?.tool).toBe('git_log');
    expect(useDialogStore.getState().activeToolActivity?.status).toBe('reading commits');

    // Simulate diff proposal
    useDialogStore.setState((s) => ({
      diffProposals: [
        ...s.diffProposals,
        {
          id: 'diff-1',
          dialog_id: 'dlg-1',
          diff: '--- a/file\n+++ b/file',
        },
      ],
    }));
    expect(useDialogStore.getState().diffProposals).toHaveLength(1);
    expect(useDialogStore.getState().diffProposals[0].id).toBe('diff-1');
  });

  it('loads and selects dialogs and fetches messages', async () => {
    const mockDialogs = [
      {
        id: 'dlg-1',
        user_id: 'u-1',
        title: 'Project Roadmap Chat',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ];
    const mockMessages = [
      {
        id: 'msg-1',
        dialog_id: 'dlg-1',
        user_id: 'u-1',
        role: 'user' as const,
        content: 'What are the main priorities?',
        created_at: new Date().toISOString(),
      },
    ];

    vi.spyOn(dialogApi, 'fetchDialogs').mockResolvedValue(mockDialogs);
    vi.spyOn(dialogApi, 'fetchMessages').mockResolvedValue(mockMessages);

    await useDialogStore.getState().loadDialogs();

    expect(useDialogStore.getState().dialogs).toHaveLength(1);
    expect(useDialogStore.getState().dialogs[0].title).toBe('Project Roadmap Chat');
    expect(useDialogStore.getState().activeDialogId).toBe('dlg-1');
    expect(useDialogStore.getState().messages).toHaveLength(1);
    expect(useDialogStore.getState().messages[0].content).toBe('What are the main priorities?');
  });

  it('renames a dialog and updates local state', async () => {
    useDialogStore.setState({
      dialogs: [
        {
          id: 'dlg-1',
          user_id: 'u-1',
          title: 'Old Title',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ],
      activeDialogId: 'dlg-1',
    });

    vi.spyOn(dialogApi, 'updateDialog').mockResolvedValue({
      id: 'dlg-1',
      user_id: 'u-1',
      title: 'New Architecture Discussion',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    await useDialogStore.getState().renameDialog('dlg-1', 'New Architecture Discussion');

    expect(dialogApi.updateDialog).toHaveBeenCalledWith('dlg-1', 'New Architecture Discussion');
    expect(useDialogStore.getState().dialogs[0].title).toBe('New Architecture Discussion');
  });

  it('sends a prompt message and appends it to state', async () => {
    useDialogStore.setState({ activeDialogId: 'dlg-1' });

    const postedMsg = {
      id: 'msg-user-99',
      dialog_id: 'dlg-1',
      user_id: 'u-1',
      role: 'user' as const,
      content: 'Can you refactor this function?',
      created_at: new Date().toISOString(),
      agent_dispatched: true,
    };

    vi.spyOn(dialogApi, 'postMessage').mockResolvedValue(postedMsg);

    await useDialogStore.getState().sendMessage('Can you refactor this function?');

    expect(dialogApi.postMessage).toHaveBeenCalledWith(
      'dlg-1',
      'Can you refactor this function?',
      undefined,
      'user'
    );
    expect(useDialogStore.getState().messages).toHaveLength(1);
    expect(useDialogStore.getState().messages[0].id).toBe('msg-user-99');
  });

  it('manages agent pairing modal state and queries agent presence', async () => {
    expect(useDialogStore.getState().pairingModalOpen).toBe(false);

    vi.spyOn(dialogApi, 'fetchAgentStatus').mockResolvedValue({
      online: true,
      agent_name: 'WorkstationDaemon',
      connected_at: new Date().toISOString(),
      capabilities: ['ollama', 'bash', 'git'],
    });

    useDialogStore.getState().setPairingModalOpen(true);
    expect(useDialogStore.getState().pairingModalOpen).toBe(true);

    await useDialogStore.getState().refreshAgentStatus();
    expect(useDialogStore.getState().agentStatus.online).toBe(true);
    expect(useDialogStore.getState().agentStatus.agent_name).toBe('WorkstationDaemon');
    expect(useDialogStore.getState().agentStatus.capabilities).toContain('ollama');

    useDialogStore.getState().setPairingModalOpen(false);
    expect(useDialogStore.getState().pairingModalOpen).toBe(false);
  });

  it('supports attaching selected text snapshots and toggling dialog sidecar for Reader Mode', () => {
    useUIStore.getState().setDialogSidecarOpen(false);
    expect(useUIStore.getState().dialogSidecarOpen).toBe(false);

    // Simulate clicking "Ask Agent" on text selection in Reader Mode
    useDialogStore.getState().setContextSnapshot({
      document_id: 'doc-reader-1',
      document_title: 'Specification Document',
      document_path: '/docs/spec.md',
      selected_text: '### Section 3: Agentic Architecture',
    });
    useUIStore.getState().setDialogSidecarOpen(true);

    expect(useUIStore.getState().dialogSidecarOpen).toBe(true);
    expect(useDialogStore.getState().contextSnapshot).toEqual({
      document_id: 'doc-reader-1',
      document_title: 'Specification Document',
      document_path: '/docs/spec.md',
      selected_text: '### Section 3: Agentic Architecture',
    });

    // Clear snapshot after dispatch
    useDialogStore.getState().clearContextSnapshot();
    expect(useDialogStore.getState().contextSnapshot).toBeNull();
  });

  it('supports resetting a dialog to an earlier message via resetDialogToMessage', async () => {
    useDialogStore.setState({
      activeDialogId: 'dlg-1',
      messages: [
        {
          id: 'msg-1',
          dialog_id: 'dlg-1',
          user_id: 'u-1',
          role: 'user',
          content: 'First question',
          created_at: new Date().toISOString(),
        },
        {
          id: 'msg-2',
          dialog_id: 'dlg-1',
          user_id: 'u-1',
          role: 'assistant',
          content: 'First answer',
          created_at: new Date().toISOString(),
        },
        {
          id: 'msg-3',
          dialog_id: 'dlg-1',
          user_id: 'u-1',
          role: 'user',
          content: 'Second question',
          created_at: new Date().toISOString(),
        },
      ],
    });

    vi.spyOn(dialogApi, 'truncateDialog').mockResolvedValue([
      {
        id: 'msg-1',
        dialog_id: 'dlg-1',
        user_id: 'u-1',
        role: 'user',
        content: 'First question',
        created_at: new Date().toISOString(),
      },
      {
        id: 'msg-2',
        dialog_id: 'dlg-1',
        user_id: 'u-1',
        role: 'assistant',
        content: 'First answer',
        created_at: new Date().toISOString(),
      },
    ]);

    await useDialogStore.getState().resetDialogToMessage('msg-2');
    expect(dialogApi.truncateDialog).toHaveBeenCalledWith('dlg-1', 'msg-2', false);
    expect(useDialogStore.getState().messages).toHaveLength(2);
    expect(useDialogStore.getState().messages.map((m) => m.id)).toEqual(['msg-1', 'msg-2']);
  });

  it('supports forking a dialog into a new thread via forkDialog', async () => {
    useDialogStore.setState({
      activeDialogId: 'dlg-1',
      dialogs: [
        {
          id: 'dlg-1',
          user_id: 'u-1',
          title: 'Source Dialog',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ],
    });

    const forkedDialog = {
      id: 'dlg-forked-2',
      user_id: 'u-1',
      title: 'Fork of Source Dialog',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    vi.spyOn(dialogApi, 'forkDialog').mockResolvedValue(forkedDialog);
    vi.spyOn(dialogApi, 'fetchMessages').mockResolvedValue([]);

    const result = await useDialogStore.getState().forkDialog('msg-2', 'Custom Branch');
    expect(dialogApi.forkDialog).toHaveBeenCalledWith('dlg-1', 'msg-2', 'Custom Branch');
    expect(result?.id).toBe('dlg-forked-2');
    expect(useDialogStore.getState().activeDialogId).toBe('dlg-forked-2');
    expect(useDialogStore.getState().dialogs.some((d) => d.id === 'dlg-forked-2')).toBe(true);
  });

  it('tracks isGenerating state and generatingStartTime while awaiting agent response', async () => {
    useDialogStore.setState({
      activeDialogId: 'dlg-1',
      agentStatus: {
        online: true,
        agent_name: 'LocalGemini',
        connected_at: new Date().toISOString(),
        capabilities: ['gemini'],
      },
    });

    expect(useDialogStore.getState().isGenerating).toBe(false);
    expect(useDialogStore.getState().generatingStartTime).toBeNull();

    vi.spyOn(dialogApi, 'postMessage').mockResolvedValue({
      id: 'msg-gen-1',
      dialog_id: 'dlg-1',
      user_id: 'u-1',
      role: 'user',
      content: 'Hello, please review this file',
      created_at: new Date().toISOString(),
      agent_dispatched: true,
    });

    await useDialogStore.getState().sendMessage('Hello, please review this file');

    expect(useDialogStore.getState().isGenerating).toBe(true);
    expect(useDialogStore.getState().generatingStartTime).not.toBeNull();
    expect(typeof useDialogStore.getState().generatingStartTime).toBe('number');
  });

  it('manages agentActions in DialogStore and updates action statuses', () => {
    expect(useDialogStore.getState().agentActions).toEqual([]);

    // Add direct_edit action
    const action1 = {
      id: 'act-1',
      dialog_id: 'dlg-1',
      document_id: 'doc-1',
      action: 'direct_edit',
      payload: { diff: '--- a/doc.md\n+++ b/doc.md\n@@ -1 +1 @@\n-old\n+new' },
      status: 'pending' as const,
      timestamp: Date.now(),
    };

    // Add add_suggestion action
    const action2 = {
      id: 'act-2',
      dialog_id: 'dlg-1',
      document_id: 'doc-1',
      action: 'add_suggestion',
      payload: { original_text: 'old text', suggested_text: 'new suggestion' },
      status: 'pending' as const,
      timestamp: Date.now(),
    };

    useDialogStore.setState({ agentActions: [action1, action2] });
    expect(useDialogStore.getState().agentActions.length).toBe(2);

    // Mark action1 applied
    useDialogStore.getState().updateAgentActionStatus('act-1', 'applied');
    expect(useDialogStore.getState().agentActions[0].status).toBe('applied');

    // Mark action2 failed
    useDialogStore.getState().updateAgentActionStatus('act-2', 'failed', 'Invalid anchor');
    expect(useDialogStore.getState().agentActions[1].status).toBe('failed');
    expect(useDialogStore.getState().agentActions[1].error).toBe('Invalid anchor');
  });

  it('clears agentActions upon selecting or deleting dialogs', async () => {
    useDialogStore.setState({
      activeDialogId: 'dlg-1',
      agentActions: [
        {
          id: 'act-1',
          dialog_id: 'dlg-1',
          action: 'add_comment',
          payload: { content: 'test comment' },
          status: 'applied',
          timestamp: Date.now(),
        },
      ],
    });

    vi.spyOn(dialogApi, 'fetchMessages').mockResolvedValue([]);
    await useDialogStore.getState().selectDialog('dlg-2');
    expect(useDialogStore.getState().agentActions).toEqual([]);
  });

  it('preserves comments and suggestions inside context snapshot', () => {
    const comments = [
      { id: 'c-1', author: 'Alice', content: 'Consider refactoring', status: 'OPEN', quote: 'function foo()' },
    ];
    const suggestions = [
      { id: 's-1', author: 'Bob', original_text: 'let a = 1', suggested_text: 'const a = 1', status: 'PENDING' },
    ];

    useDialogStore.getState().setContextSnapshot({
      document_id: 'doc-123',
      document_title: 'test.md',
      comments,
      suggestions,
    });

    const snap = useDialogStore.getState().contextSnapshot;
    expect(snap?.comments).toHaveLength(1);
    expect(snap?.comments[0].content).toBe('Consider refactoring');
    expect(snap?.suggestions).toHaveLength(1);
    expect(snap?.suggestions[0].suggested_text).toBe('const a = 1');
  });

  it('sortDialogMessages enforces prompt-before-response ordering on identical timestamps', () => {
    const messages: DialogMessage[] = [
      {
        id: 'msg-assist-1',
        dialog_id: 'dlg-1',
        role: 'assistant',
        content: 'Assistant answer',
        created_at: '2026-10-29T10:00:00.000Z',
      },
      {
        id: 'msg-user-1',
        dialog_id: 'dlg-1',
        role: 'user',
        content: 'User prompt',
        created_at: '2026-10-29T10:00:00.000Z',
      },
      {
        id: 'msg-assist-0',
        dialog_id: 'dlg-1',
        role: 'assistant',
        content: 'Earlier response',
        created_at: '2026-10-29T09:55:00.000Z',
      },
      {
        id: 'msg-user-2',
        dialog_id: 'dlg-1',
        role: 'user',
        content: 'Follow-up question',
        created_at: '2026-10-29T10:05:00.000Z',
      },
    ];

    const sorted = sortDialogMessages(messages);
    expect(sorted.map((m) => m.id)).toEqual([
      'msg-assist-0',
      'msg-user-1',
      'msg-assist-1',
      'msg-user-2',
    ]);
  });

  it('optimistically displays user prompt immediately when sendMessage is called', async () => {
    useDialogStore.setState({
      activeDialogId: 'dlg-test',
      messages: [],
      agentStatus: {
        online: true,
        agent_name: 'test-agent',
        connected_at: '2026-10-29T10:00:00Z',
        capabilities: ['edit'],
      },
    });

    let resolvePostMessage: (msg: DialogMessage) => void;
    const pendingPromise = new Promise<DialogMessage>((res) => {
      resolvePostMessage = res;
    });

    vi.spyOn(dialogApi, 'postMessage').mockReturnValue(pendingPromise);

    const sendCall = useDialogStore.getState().sendMessage('Summarize this document');

    // Immediately after invocation, the optimistic user message must be present in messages
    const stateDuring = useDialogStore.getState();
    expect(stateDuring.isSending).toBe(true);
    expect(stateDuring.isGenerating).toBe(true);
    expect(stateDuring.messages.length).toBe(1);
    expect(stateDuring.messages[0].role).toBe('user');
    expect(stateDuring.messages[0].content).toBe('Summarize this document');
    expect(stateDuring.messages[0].id).toMatch(/^temp-user-/);

    // Now resolve the server response
    resolvePostMessage!({
      id: 'server-msg-101',
      dialog_id: 'dlg-test',
      role: 'user',
      content: 'Summarize this document',
      created_at: new Date().toISOString(),
      agent_dispatched: true,
    });

    await sendCall;

    const stateAfter = useDialogStore.getState();
    expect(stateAfter.isSending).toBe(false);
    expect(stateAfter.messages.length).toBe(1);
    expect(stateAfter.messages[0].id).toBe('server-msg-101');
    expect(stateAfter.messages[0].content).toBe('Summarize this document');
  });

  it('provides Ask Agent in editor selection context and opens AI sidecar', () => {
    expect(useUIStore.getState().dialogSidecarOpen).toBe(false);
    expect(useDialogStore.getState().contextSnapshot).toBeNull();

    // Trigger Ask Agent context snapshot packaging
    useDialogStore.getState().setContextSnapshot({
      document_id: 'doc-456',
      document_title: 'readme.md',
      document_path: '/docs/readme.md',
      selected_text: '# Installation Guide',
    });
    useUIStore.getState().setDialogSidecarOpen(true);

    expect(useUIStore.getState().dialogSidecarOpen).toBe(true);
    expect(useDialogStore.getState().contextSnapshot).toEqual({
      document_id: 'doc-456',
      document_title: 'readme.md',
      document_path: '/docs/readme.md',
      selected_text: '# Installation Guide',
    });

    // Render EditorToolbar to verify toolbar-ask-agent-btn exists
    const mockEditor: any = {
      state: {
        selection: { empty: false, from: 1, to: 10 },
        doc: { textBetween: () => 'some text' },
      },
      on: () => {},
      off: () => {},
      can: () => ({
        undo: () => false,
        redo: () => false,
        chain: () => ({
          focus: () => ({
            undo: () => ({ run: () => false }),
            redo: () => ({ run: () => false }),
          }),
        }),
      }),
      chain: () => ({
        focus: () => ({
          undo: () => ({ run: () => false }),
          redo: () => ({ run: () => false }),
        }),
      }),
      isActive: () => false,
      getText: () => 'some text in editor',
    };

    const html = renderToStaticMarkup(
      React.createElement(EditorToolbar, {
        editor: mockEditor,
        documentId: 'doc-456',
        documentTitle: 'readme.md',
        documentPath: '/docs/readme.md',
      })
    );

    expect(html).toContain('data-testid="toolbar-ask-agent-btn"');
    expect(html).toContain('Ask your AI agent about selected text');
  });
});
