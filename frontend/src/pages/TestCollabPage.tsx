import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CollaborativeEditor } from '../components/editor/CollaborativeEditor';
import { CmeCollabProvider, CollabConnectionStatus } from '../api/collabProvider';
import { Wifi, WifiOff, Users } from 'lucide-react';
import { Badge } from '../components/common/Badge';

export const TestCollabPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const initialDocId = searchParams.get('docId') || 'a99979aa-d727-443a-ab3a-e7ee7f39a8ed';
  const [roomId, setRoomId] = useState(initialDocId);
  
  // Alice state
  const [aliceConnected, setAliceConnected] = useState(true);
  const [aliceStatus, setAliceStatus] = useState<CollabConnectionStatus>('disconnected');
  
  // Bob state
  const [bobConnected, setBobConnected] = useState(true);
  const [bobStatus, setBobStatus] = useState<CollabConnectionStatus>('disconnected');

  // Alice Provider
  const aliceProvider = useMemo(() => {
    return new CmeCollabProvider(roomId);
  }, [roomId]);

  // Bob Provider
  const bobProvider = useMemo(() => {
    return new CmeCollabProvider(roomId);
  }, [roomId]);

  useEffect(() => {
    const unsubAlice = aliceProvider.onStatus(setAliceStatus);
    if (aliceConnected) {
      aliceProvider.connect();
    } else {
      aliceProvider.disconnect();
    }
    return () => {
      unsubAlice();
    };
  }, [aliceProvider, aliceConnected]);

  useEffect(() => {
    const unsubBob = bobProvider.onStatus(setBobStatus);
    if (bobConnected) {
      bobProvider.connect();
    } else {
      bobProvider.disconnect();
    }
    return () => {
      unsubBob();
    };
  }, [bobProvider, bobConnected]);

  useEffect(() => {
    return () => {
      aliceProvider.destroy();
      bobProvider.destroy();
    };
  }, [aliceProvider, bobProvider]);

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      {/* Test Harness Controls */}
      <div className="bg-cme-bg-surface border border-cme-border-base rounded-xl p-4 flex flex-wrap items-center justify-between gap-4 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-cme-primary/10 text-cme-primary">
            <Users className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-cme-text-base">
              Dual-Peer Collaboration & Cursor Test Harness
            </h1>
            <p className="text-xs text-cme-text-muted">
              Live WebSocket CRDT synchronization, presence caret propagation & offline partition merging.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-cme-text-muted">Room:</span>
          <input
            type="text"
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
            className="px-2.5 py-1 text-xs font-mono rounded border border-cme-border-base bg-cme-bg-subtle text-cme-text-base focus:outline-none focus:ring-1 focus:ring-cme-primary"
          />
        </div>
      </div>

      {/* Side-by-Side Dual Editor Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Alice Editor Pane */}
        <div className="space-y-3 p-4 rounded-xl border border-pink-500/20 bg-pink-500/5" data-testid="alice-pane">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-pink-500" />
              <span className="text-sm font-bold text-cme-text-base">Alice</span>
              <Badge
                variant={aliceStatus === 'connected' ? 'success' : aliceStatus === 'connecting' ? 'warning' : 'neutral'}
                size="sm"
              >
                {aliceStatus}
              </Badge>
            </div>

            <button
              onClick={() => setAliceConnected(!aliceConnected)}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium border transition-colors ${
                aliceConnected
                  ? 'border-rose-500/30 text-rose-600 dark:text-rose-400 hover:bg-rose-500/10'
                  : 'border-emerald-500/30 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10'
              }`}
              data-testid="alice-toggle-net"
            >
              {aliceConnected ? (
                <>
                  <WifiOff className="w-3.5 h-3.5" />
                  <span>Disconnect Network</span>
                </>
              ) : (
                <>
                  <Wifi className="w-3.5 h-3.5" />
                  <span>Reconnect Network</span>
                </>
              )}
            </button>
          </div>

          <div data-testid="alice-editor">
            <CollaborativeEditor
              provider={aliceProvider}
              user={{ name: 'Alice', color: '#ec4899' }}
            />
          </div>
        </div>

        {/* Bob Editor Pane */}
        <div className="space-y-3 p-4 rounded-xl border border-blue-500/20 bg-blue-500/5" data-testid="bob-pane">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-blue-500" />
              <span className="text-sm font-bold text-cme-text-base">Bob</span>
              <Badge
                variant={bobStatus === 'connected' ? 'success' : bobStatus === 'connecting' ? 'warning' : 'neutral'}
                size="sm"
              >
                {bobStatus}
              </Badge>
            </div>

            <button
              onClick={() => setBobConnected(!bobConnected)}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium border transition-colors ${
                bobConnected
                  ? 'border-rose-500/30 text-rose-600 dark:text-rose-400 hover:bg-rose-500/10'
                  : 'border-emerald-500/30 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10'
              }`}
              data-testid="bob-toggle-net"
            >
              {bobConnected ? (
                <>
                  <WifiOff className="w-3.5 h-3.5" />
                  <span>Disconnect Network</span>
                </>
              ) : (
                <>
                  <Wifi className="w-3.5 h-3.5" />
                  <span>Reconnect Network</span>
                </>
              )}
            </button>
          </div>

          <div data-testid="bob-editor">
            <CollaborativeEditor
              provider={bobProvider}
              user={{ name: 'Bob', color: '#3b82f6' }}
            />
          </div>
        </div>
      </div>
    </div>
  );
};
