import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { useUIStore } from '../../src/stores/uiStore';
import { useDialogStore } from '../../src/stores/dialogStore';
import * as dialogApi from '../../src/api/dialogs';

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
});
