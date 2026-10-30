import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { useUIStore } from '../../src/stores/uiStore';
import { useDialogStore, sortDialogMessages } from '../../src/stores/dialogStore';
import * as dialogApi from '../../src/api/dialogs';
import { DialogMessage } from '../../src/types/dialog';
import { EditorToolbar } from '../../src/components/editor/EditorToolbar';
import { DialogSidecar } from '../../src/components/dialog/DialogSidecar';
import { computeReplacementChange } from '../../src/utils/diffPatcher';

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

  it('prevents writing and sending prompts when no dialog is selected', async () => {
    useDialogStore.setState({ activeDialogId: null });
    const postSpy = vi.spyOn(dialogApi, 'postMessage');

    // Store level: sendMessage does nothing if no activeDialogId
    await useDialogStore.getState().sendMessage('Hello into the void');
    expect(postSpy).not.toHaveBeenCalled();
    expect(useDialogStore.getState().messages).toHaveLength(0);

    // Component level: render DialogSidecar when activeDialogId is null
    const html = renderToStaticMarkup(React.createElement(DialogSidecar, { documentId: 'doc-test' }));
    expect(html).toContain('disabled=""');
    expect(html).toContain('Select or create a dialog to write a prompt...');
    expect(html).toContain('No Dialog Selected');
    expect(html).toContain('Select or create a dialog to start chatting');
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
    expect(html).toContain('data-testid="suggesting-mode-toggle"');
    expect(html).toContain('Direct Editing Mode');
    expect(html).toContain('data-testid="toggle-in-text-reviews-btn"');
    expect(html).toContain('Hide Reviews in Text');
  });

  it('stores line_start in context snapshot when Ask Agent is triggered with editor selection', () => {
    useDialogStore.getState().setContextSnapshot({
      document_id: 'doc-1',
      document_title: 'example.md',
      selected_text: 'const a = 1;',
      line_start: 42,
    });

    const snap = useDialogStore.getState().contextSnapshot;
    expect(snap?.line_start).toBe(42);
    expect(snap?.selected_text).toBe('const a = 1;');
  });

  it('verifies direct edit changes are accurately computed without selection fallback', () => {
    const doc = [
      'Line 1',
      'Line 2: error here',
      'Line 3',
    ].join('\n');

    const change = computeReplacementChange(doc, 'Line 2: error here', 'Line 2: fixed here', 2);
    expect(change).not.toBeNull();
    expect(change?.from).toBe(doc.indexOf('Line 2: error here'));
    expect(change?.insert).toBe('Line 2: fixed here');

    const patched = doc.slice(0, change!.from) + change!.insert + doc.slice(change!.to);
    expect(patched).toContain('Line 2: fixed here');
    expect(patched).not.toContain('error here');
  });

  it('parses markdown formatting in AI assistant responses in the chat view', () => {
    const testDialog = {
      id: 'dlg-md-test',
      user_id: 'u1',
      title: 'Markdown Test Dialog',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      message_count: 2,
    };
    const testMessages: any[] = [
      {
        id: 'm-user',
        dialog_id: 'dlg-md-test',
        user_id: 'u1',
        role: 'user',
        content: 'Show me python code and a list',
        created_at: '2026-10-24T00:00:00Z',
      },
      {
        id: 'm-assistant',
        dialog_id: 'dlg-md-test',
        user_id: 'agent',
        role: 'assistant',
        content: 'Here is **bold** text and code:\n```python\nprint("hello")\n```\n- Item 1\n- Item 2',
        created_at: '2026-10-24T00:00:01Z',
      },
    ];

    useDialogStore.setState({
      activeDialogId: 'dlg-md-test',
      dialogs: [testDialog],
      messages: testMessages,
    });

    const html = renderToStaticMarkup(
      React.createElement(DialogSidecar, {
        documentId: 'doc-1',
        documentTitle: 'test.md',
      })
    );

    expect(html).toContain('data-testid="ai-markdown-parsed"');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<pre><code class="language-python">');
    expect(html).toContain('<li><p>Item 1</p></li>');
  });

  it('renders stop-prompt-btn and cancel-waiting-btn when isGenerating is true', () => {
    const testDialog = {
      id: 'dlg-stop-test',
      user_id: 'u1',
      title: 'Stop Test Dialog',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      message_count: 1,
    };

    useDialogStore.setState({
      activeDialogId: 'dlg-stop-test',
      dialogs: [testDialog],
      messages: [],
      isGenerating: true,
      generatingStartTime: Date.now() - 5000,
      agentStatus: {
        online: true,
        agent_name: 'Local Agent',
        connected_at: new Date().toISOString(),
        capabilities: [],
      },
    });

    const html = renderToStaticMarkup(
      React.createElement(DialogSidecar, {
        documentId: 'doc-1',
        documentTitle: 'test.md',
      })
    );

    // Stop button in composer
    expect(html).toContain('data-testid="stop-prompt-btn"');
    expect(html).not.toContain('data-testid="send-prompt-btn"');

    // Cancel waiting button in thinking banner
    expect(html).toContain('data-testid="cancel-waiting-btn"');
    expect(html).toContain('data-testid="agent-waiting-state"');
  });

  it('stopGeneration calls stopDialogPrompt API and resets isGenerating', async () => {
    const stopSpy = vi.spyOn(dialogApi, 'stopDialogPrompt').mockResolvedValue(undefined);

    const mockWs = {
      readyState: 1, // OPEN
      send: vi.fn(),
      close: vi.fn(),
    } as unknown as WebSocket;

    useDialogStore.setState({
      activeDialogId: 'dlg-stop-call',
      isGenerating: true,
      generatingStartTime: Date.now(),
      streamingContent: 'Partial generation...',
      activeToolActivity: { tool: 'grep', status: 'running' },
      ws: mockWs,
    });

    await useDialogStore.getState().stopGeneration();

    expect(mockWs.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'stop_prompt', dialog_id: 'dlg-stop-call' })
    );
    expect(stopSpy).toHaveBeenCalledWith('dlg-stop-call');

    const state = useDialogStore.getState();
    expect(state.isGenerating).toBe(false);
    expect(state.generatingStartTime).toBeNull();
    expect(state.streamingContent).toBe('');
    expect(state.activeToolActivity).toBeNull();
  });

  it('resets isGenerating when agent disconnects (agent_status online: false)', () => {
    useDialogStore.setState({
      activeDialogId: 'dlg-disconnect',
      isGenerating: true,
      generatingStartTime: Date.now(),
      streamingContent: 'Waiting for stream...',
      activeToolActivity: { tool: 'local_git', status: 'executing' },
      agentStatus: {
        online: true,
        agent_name: 'Local Agent',
        connected_at: new Date().toISOString(),
        capabilities: [],
      },
    });

    let onMessageHandler: any;
    const mockWs = {
      readyState: 1,
      send: vi.fn(),
      close: vi.fn(),
      set onmessage(fn: any) {
        onMessageHandler = fn;
      },
      get onmessage() {
        return onMessageHandler;
      },
    };

    const originalWindow = (global as any).window;
    const originalWs = global.WebSocket;
    (global as any).window = {
      location: { protocol: 'http:', host: 'localhost:18080' },
    };
    (global as any).WebSocket = vi.fn().mockImplementation(() => mockWs);

    try {
      useDialogStore.getState().connectDialogWs('dlg-disconnect');

      // Dispatch agent_status { online: false }
      onMessageHandler({
        data: JSON.stringify({
          type: 'agent_status',
          online: false,
          user_id: 'u1',
        }),
      });

      const state = useDialogStore.getState();
      expect(state.agentStatus.online).toBe(false);
      expect(state.isGenerating).toBe(false);
      expect(state.generatingStartTime).toBeNull();
      expect(state.activeToolActivity).toBeNull();
      expect(state.streamingContent).toBe('');
    } finally {
      global.WebSocket = originalWs;
      (global as any).window = originalWindow;
    }
  });

  it('handles prompt_failed and prompt_stopped WebSocket events', () => {
    useDialogStore.setState({
      activeDialogId: 'dlg-failed',
      isGenerating: true,
      generatingStartTime: Date.now(),
      streamingContent: 'Unfinished content',
      messages: [],
    });

    let onMessageHandler: any;
    const mockWs = {
      readyState: 1,
      send: vi.fn(),
      close: vi.fn(),
      set onmessage(fn: any) {
        onMessageHandler = fn;
      },
      get onmessage() {
        return onMessageHandler;
      },
    };

    const originalWindow = (global as any).window;
    const originalWs = global.WebSocket;
    (global as any).window = {
      location: { protocol: 'http:', host: 'localhost:18080' },
    };
    (global as any).WebSocket = vi.fn().mockImplementation(() => mockWs);

    try {
      useDialogStore.getState().connectDialogWs('dlg-failed');

      // Dispatch prompt_failed event
      onMessageHandler({
        data: JSON.stringify({
          type: 'prompt_failed',
          dialog_id: 'dlg-failed',
          error: 'Agent disconnected while generating response',
          message: {
            id: 'm-fail-1',
            dialog_id: 'dlg-failed',
            role: 'assistant',
            content: '⚠️ Agent disconnected',
            created_at: new Date().toISOString(),
          },
        }),
      });

      const state = useDialogStore.getState();
      expect(state.isGenerating).toBe(false);
      expect(state.generatingStartTime).toBeNull();
      expect(state.streamingContent).toBe('');
      expect(state.messages.some((m) => m.id === 'm-fail-1')).toBe(true);
    } finally {
      global.WebSocket = originalWs;
      (global as any).window = originalWindow;
    }
  });

  it('reconnects dialog WebSocket with backoff when socket closes', () => {
    vi.useFakeTimers();
    let closeHandler: any;
    let openHandler: any;

    let wsInstanceCount = 0;
    const mockWsInstances: any[] = [];

    const mockWsFactory = () => {
      wsInstanceCount++;
      const instance = {
        readyState: 1,
        send: vi.fn(),
        close: vi.fn(),
        set onopen(fn: any) {
          openHandler = fn;
        },
        get onopen() {
          return openHandler;
        },
        set onclose(fn: any) {
          closeHandler = fn;
        },
        get onclose() {
          return closeHandler;
        },
        set onmessage(fn: any) {},
        get onmessage() {
          return () => {};
        },
        set onerror(fn: any) {},
        get onerror() {
          return () => {};
        },
      };
      mockWsInstances.push(instance);
      return instance;
    };

    const originalWindow = (global as any).window;
    const originalWs = global.WebSocket;
    (global as any).window = {
      location: { protocol: 'http:', host: 'localhost:18080' },
    };
    (global as any).WebSocket = vi.fn().mockImplementation(mockWsFactory);

    try {
      useDialogStore.setState({ activeDialogId: 'dlg-recon' });
      useDialogStore.getState().connectDialogWs('dlg-recon');

      expect(wsInstanceCount).toBe(1);
      expect(useDialogStore.getState().wsStatus).toBe('connecting');

      // Trigger socket open
      if (openHandler) openHandler();
      expect(useDialogStore.getState().wsStatus).toBe('connected');

      // Trigger socket drop
      if (closeHandler) closeHandler();
      expect(useDialogStore.getState().wsStatus).toBe('connecting');

      // Advance timers for backoff delay
      vi.advanceTimersByTime(3000);

      // Verify reconnection occurred
      expect(wsInstanceCount).toBe(2);
    } finally {
      useDialogStore.getState().disconnectDialogWs();
      vi.useRealTimers();
      global.WebSocket = originalWs;
      (global as any).window = originalWindow;
    }
  });

  it('reconcileMessages fetches messages and clears isGenerating if assistant reply exists', async () => {
    const userMsg: DialogMessage = {
      id: 'm-user-1',
      dialog_id: 'dlg-rec',
      user_id: 'u1',
      role: 'user',
      content: 'Explain CRDTs',
      created_at: new Date(Date.now() - 5000).toISOString(),
    };
    const assistantMsg: DialogMessage = {
      id: 'm-asst-1',
      dialog_id: 'dlg-rec',
      user_id: '',
      role: 'assistant',
      content: 'CRDTs allow conflict-free replicated edits.',
      created_at: new Date(Date.now() - 1000).toISOString(),
    };

    vi.spyOn(dialogApi, 'fetchMessages').mockResolvedValue([userMsg, assistantMsg]);

    useDialogStore.setState({
      activeDialogId: 'dlg-rec',
      isGenerating: true,
      generatingStartTime: Date.now() - 5000,
      messages: [userMsg],
      streamingContent: 'partial...',
      activeToolActivity: { tool: 'search', status: 'done' },
    });

    await useDialogStore.getState().reconcileMessages('dlg-rec');

    const state = useDialogStore.getState();
    expect(state.isGenerating).toBe(false);
    expect(state.generatingStartTime).toBeNull();
    expect(state.streamingContent).toBe('');
    expect(state.activeToolActivity).toBeNull();
    expect(state.messages).toHaveLength(2);
    expect(state.messages[1].id).toBe('m-asst-1');
  });

  it('reconcileMessages keeps isGenerating true if no assistant reply has arrived yet', async () => {
    const userMsg: DialogMessage = {
      id: 'm-user-2',
      dialog_id: 'dlg-rec-pending',
      user_id: 'u1',
      role: 'user',
      content: 'Thinking in progress...',
      created_at: new Date().toISOString(),
    };

    vi.spyOn(dialogApi, 'fetchMessages').mockResolvedValue([userMsg]);

    useDialogStore.setState({
      activeDialogId: 'dlg-rec-pending',
      isGenerating: true,
      generatingStartTime: Date.now() - 2000,
      messages: [userMsg],
    });

    await useDialogStore.getState().reconcileMessages('dlg-rec-pending');

    const state = useDialogStore.getState();
    expect(state.isGenerating).toBe(true);
    expect(state.generatingStartTime).not.toBeNull();
    expect(state.messages).toHaveLength(1);
  });

  it('times out pending prompt after timeout period and appends visible error message', async () => {
    vi.useFakeTimers();

    const userMsg: DialogMessage = {
      id: 'm-user-timeout',
      dialog_id: 'dlg-timeout',
      user_id: 'u1',
      role: 'user',
      content: 'Slow task that hangs',
      created_at: new Date(Date.now() - 95000).toISOString(),
    };

    vi.spyOn(dialogApi, 'fetchMessages').mockResolvedValue([userMsg]);

    useDialogStore.setState({
      activeDialogId: 'dlg-timeout',
      isGenerating: true,
      generatingStartTime: Date.now() - 95000,
      messages: [userMsg],
      agentStatus: { online: true, agent_name: 'TestAgent', connected_at: null, capabilities: [] },
    });

    // Start fallback prompt polling
    const { startPendingPromptPolling, stopPendingPromptPolling } = await import('../../src/stores/dialogStore');
    startPendingPromptPolling('dlg-timeout');

    // Advance by polling interval (3000ms)
    await vi.advanceTimersByTimeAsync(3500);

    const state = useDialogStore.getState();
    expect(state.isGenerating).toBe(false);
    expect(state.generatingStartTime).toBeNull();
    const timeoutMsg = state.messages.find((m) => m.content.includes('Request Timed Out'));
    expect(timeoutMsg).toBeDefined();
    expect(timeoutMsg?.role).toBe('assistant');

    stopPendingPromptPolling();
    vi.useRealTimers();
  });

  it('renders dialog-ws-disconnected-badge and polling text in DialogSidecar when socket is disconnected', () => {
    useDialogStore.setState({
      activeDialogId: 'dlg-offline-ui',
      dialogs: [
        {
          id: 'dlg-offline-ui',
          user_id: 'u1',
          title: 'Offline Test Thread',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ],
      wsStatus: 'disconnected',
      isGenerating: true,
      generatingStartTime: Date.now() - 4000,
      messages: [],
      agentStatus: { online: true, agent_name: 'LocalAgent', connected_at: null, capabilities: [] },
    });

    const html = renderToStaticMarkup(React.createElement(DialogSidecar, {}));
    expect(html).toContain('data-testid="dialog-ws-disconnected-badge"');
    expect(html).toContain('Disconnected');
    expect(html).toContain('stream disconnected, polling...');
  });
});
