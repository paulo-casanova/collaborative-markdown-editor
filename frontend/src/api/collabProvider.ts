import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';

export type CollabConnectionStatus = 'connecting' | 'connected' | 'disconnected';

export interface RemoteUser {
  id?: string;
  name?: string;
  color?: string;
  avatar_color?: string;
  username?: string;
  display_name?: string;
}

export interface ReviewEventPayload {
  event: string;
  document_id: string;
  [key: string]: any;
}

export type StatusListener = (status: CollabConnectionStatus) => void;
export type ReviewEventListener = (payload: ReviewEventPayload) => void;

export class CmeCollabProvider {
  public ydoc: Y.Doc;
  public awareness: Awareness;
  public status: CollabConnectionStatus = 'disconnected';
  public documentId: string;

  private ws: WebSocket | null = null;
  private url: string;
  private token: string | null;
  private shouldConnect = false;
  private reconnectAttempt = 0;
  private reconnectTimer: any = null;
  private pingInterval: any = null;
  private statusListeners = new Set<StatusListener>();
  private reviewEventListeners = new Set<ReviewEventListener>();

  constructor(documentId: string, ydoc?: Y.Doc, token?: string | null, customUrl?: string) {
    this.documentId = documentId;
    this.ydoc = ydoc || new Y.Doc();
    this.awareness = new Awareness(this.ydoc);
    this.token = token || (typeof localStorage !== 'undefined' ? localStorage.getItem('cme_auth_token') : null);

    // Compute WebSocket URL
    if (customUrl) {
      this.url = customUrl;
    } else {
      const protocol = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = typeof window !== 'undefined' ? window.location.host : '127.0.0.1:8080';
      this.url = `${protocol}//${host}/ws/collab/${documentId}`;
    }

    // Listen to local document updates and broadcast SyncUpdate (0x00 0x03)
    this.ydoc.on('update', this.handleLocalDocUpdate);

    // Listen to local awareness changes and broadcast Awareness (0x01)
    this.awareness.on('change', this.handleLocalAwarenessChange);
  }

  public connect() {
    this.shouldConnect = true;
    this.reconnectAttempt = 0;
    this.establishConnection();
  }

  public disconnect() {
    this.shouldConnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    if (this.ws) {
      // Send departure awareness if connected
      this.sendDeparture();
      this.ws.close();
      this.ws = null;
    }
    this.setStatus('disconnected');
  }

  public destroy() {
    this.disconnect();
    this.ydoc.off('update', this.handleLocalDocUpdate);
    this.awareness.off('change', this.handleLocalAwarenessChange);
    this.awareness.destroy();
    this.statusListeners.clear();
    this.reviewEventListeners.clear();
  }

  public onStatus(listener: StatusListener) {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => this.statusListeners.delete(listener);
  }

  public onReviewEvent(listener: ReviewEventListener) {
    this.reviewEventListeners.add(listener);
    return () => this.reviewEventListeners.delete(listener);
  }

  private setStatus(status: CollabConnectionStatus) {
    if (this.status !== status) {
      this.status = status;
      this.statusListeners.forEach((l) => l(status));
    }
  }

  private establishConnection() {
    if (!this.shouldConnect) return;
    if (!this.documentId || this.documentId === 'by-path') {
      this.setStatus('disconnected');
      return;
    }
    this.setStatus('connecting');

    // Build URL with token
    let fullUrl = this.url;
    if (this.token) {
      const sep = fullUrl.includes('?') ? '&' : '?';
      fullUrl = `${fullUrl}${sep}token=${encodeURIComponent(this.token)}`;
    }

    try {
      this.ws = new WebSocket(fullUrl);
      this.ws.binaryType = 'arraybuffer';

      this.ws.onopen = this.handleWsOpen;
      this.ws.onmessage = this.handleWsMessage;
      this.ws.onclose = this.handleWsClose;
      this.ws.onerror = this.handleWsError;
    } catch {
      this.scheduleReconnect();
    }
  }

  private handleWsOpen = () => {
    this.reconnectAttempt = 0;
    this.startPingHeartbeat();
    this.setStatus('connected');

    // Send Client SyncStep1 (0x00 0x01 <state_vector>)
    const stateVector = Y.encodeStateVector(this.ydoc);
    const frame = new Uint8Array(2 + stateVector.length);
    frame[0] = 0x00; // Opcode Sync
    frame[1] = 0x01; // Subtype SyncStep1
    frame.set(stateVector, 2);
    this.send(frame.buffer);

    // Broadcast current local awareness state
    const localState = this.awareness.getLocalState();
    if (localState) {
      this.broadcastAwareness(localState);
    }
  };

  private handleWsMessage = (event: MessageEvent) => {
    if (!(event.data instanceof ArrayBuffer)) {
      return;
    }

    const bytes = new Uint8Array(event.data);
    if (bytes.length < 1) return;

    const opcode = bytes[0];

    switch (opcode) {
      case 0x00: {
        // Opcode 0x00: CRDT Synchronization
        if (bytes.length < 2) return;
        const subtype = bytes[1];
        const payload = bytes.subarray(2);

        if (subtype === 0x01) {
          // Server SyncStep1: Compute diff and reply with SyncStep2 (0x00 0x02)
          const diff = Y.encodeStateAsUpdate(this.ydoc, payload);
          // Only send non-empty update payload (empty lib0 v1 update is 2 bytes: [0, 0])
          if (diff.length > 2) {
            const reply = new Uint8Array(2 + diff.length);
            reply[0] = 0x00;
            reply[1] = 0x02; // SyncStep2
            reply.set(diff, 2);
            this.send(reply.buffer);
          }
        } else if (subtype === 0x02 || subtype === 0x03) {
          // Server SyncStep2 or SyncUpdate: Apply update to local YDoc
          if (payload.length > 0) {
            const ytext = this.ydoc.getText('content');
            const beforeText = ytext.toString();
            Y.applyUpdate(this.ydoc, payload, this);
            const afterText = ytext.toString();

            // Guard against accidental duplication where client and server concurrent root inserts produce text + text
            if (
              beforeText.length > 0 &&
              afterText.length === beforeText.length * 2 &&
              afterText === beforeText + beforeText
            ) {
              console.warn('[CmeCollabProvider] Detected duplicated content merge; deduplicating');
              this.ydoc.transact(() => {
                ytext.delete(beforeText.length, beforeText.length);
              }, this);
            }
          }
          if (this.status !== 'connected') {
            this.setStatus('connected');
          }
        }
        break;
      }

      case 0x01: {
        // Opcode 0x01: Awareness & Cursor Presence
        const rawJson = new TextDecoder().decode(bytes.subarray(1));
        try {
          const data = JSON.parse(rawJson);
          if (data) {
            const clientId = data.clientId !== undefined ? Number(data.clientId) : 999999;
            const state = data.state !== undefined ? data.state : data;
            if (state === null) {
              // Peer departure
              this.awareness.states.delete(clientId);
              this.awareness.meta.delete(clientId);
              this.awareness.emit('change', [{ added: [], updated: [], removed: [clientId] }, this]);
              this.awareness.emit('update', [{ added: [], updated: [], removed: [clientId] }, this]);
            } else {
              // Normalize user info if string or legacy shape
              if (state.user && typeof state.user === 'string') {
                state.user = {
                  name: state.user,
                  color: state.avatar_color || '#3b82f6',
                };
              }
              // Update peer presence
              const isNewPeer = !this.awareness.states.has(clientId);
              const prevClock = this.awareness.meta.get(clientId)?.clock ?? 0;
              this.awareness.states.set(clientId, state);
              this.awareness.meta.set(clientId, { clock: prevClock + 1, lastUpdated: Date.now() });
              this.awareness.emit('change', [
                { added: isNewPeer ? [clientId] : [], updated: isNewPeer ? [] : [clientId], removed: [] },
                this,
              ]);
              this.awareness.emit('update', [
                { added: isNewPeer ? [clientId] : [], updated: isNewPeer ? [] : [clientId], removed: [] },
                this,
              ]);
              if (isNewPeer) {
                const localState = this.awareness.getLocalState();
                if (localState) {
                  this.broadcastAwareness(localState);
                }
              }
            }
          }
        } catch {
          // Ignored unparsable awareness packet
        }
        break;
      }

      case 0x02: {
        // Opcode 0x02: Real-time Review Event Notification
        const rawJson = new TextDecoder().decode(bytes.subarray(1));
        try {
          const payload = JSON.parse(rawJson) as ReviewEventPayload;
          this.reviewEventListeners.forEach((listener) => listener(payload));
        } catch {
          // Ignored
        }
        break;
      }

      case 0x03: {
        // Opcode 0x03: Ping -> Reply with Pong 0x04
        this.send(new Uint8Array([0x04]).buffer);
        break;
      }

      case 0x04: {
        // Opcode 0x04: Pong reply
        break;
      }
    }
  };

  private handleWsClose = () => {
    this.setStatus('disconnected');
    this.stopPingHeartbeat();
    this.scheduleReconnect();
  };

  private handleWsError = () => {
    if (this.ws) {
      this.ws.close();
    }
  };

  private scheduleReconnect() {
    if (!this.shouldConnect) return;
    if (this.reconnectTimer) return;

    // Exponential backoff: 1s, 2s, 4s, 8s, up to 15s max with jitter
    const delay = Math.min(1000 * Math.pow(1.8, this.reconnectAttempt), 15000) + Math.random() * 500;
    this.reconnectAttempt++;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.establishConnection();
    }, delay);
  }

  private handleLocalDocUpdate = (update: Uint8Array, origin: any) => {
    if (origin !== this && this.ws && this.ws.readyState === WebSocket.OPEN) {
      // Send SyncUpdate: 0x00 0x03 <update>
      const frame = new Uint8Array(2 + update.length);
      frame[0] = 0x00;
      frame[1] = 0x03; // SyncUpdate
      frame.set(update, 2);
      this.send(frame.buffer);
    }
  };

  private handleLocalAwarenessChange = (
    changes: { added: number[]; updated: number[]; removed: number[] },
    origin: any
  ) => {
    if (origin !== this && origin !== 'timeout') {
      const localClientId = this.ydoc.clientID;
      if (
        !changes ||
        changes.added.includes(localClientId) ||
        changes.updated.includes(localClientId) ||
        changes.removed.includes(localClientId)
      ) {
        const state = this.awareness.getLocalState();
        this.broadcastAwareness(state);
      }
    }
  };

  private broadcastAwareness(state: any) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const payload = JSON.stringify({
        clientId: this.ydoc.clientID,
        state,
      });
      const encoded = new TextEncoder().encode(payload);
      const frame = new Uint8Array(1 + encoded.length);
      frame[0] = 0x01; // Opcode Awareness
      frame.set(encoded, 1);
      this.send(frame.buffer);
    }
  }

  private sendDeparture() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const payload = JSON.stringify({
        clientId: this.ydoc.clientID,
        state: null,
      });
      const encoded = new TextEncoder().encode(payload);
      const frame = new Uint8Array(1 + encoded.length);
      frame[0] = 0x01;
      frame.set(encoded, 1);
      this.send(frame.buffer);
    }
  }

  private startPingHeartbeat() {
    this.stopPingHeartbeat();
    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.send(new Uint8Array([0x03]).buffer);
        // Keep active peer awareness states fresh and broadcast local awareness so idle cursors never expire
        const now = Date.now();
        this.awareness.meta.forEach((meta, clientId) => {
          if (this.awareness.states.has(clientId)) {
            this.awareness.meta.set(clientId, { clock: meta.clock, lastUpdated: now });
          }
        });
        const localState = this.awareness.getLocalState();
        if (localState) {
          this.broadcastAwareness(localState);
        }
      }
    }, 15000);
  }

  private stopPingHeartbeat() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  private send(data: ArrayBuffer) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(data);
    }
  }
}
