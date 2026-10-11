#!/usr/bin/env python3
"""
CME WebSocket Review Event Listener.
Connects to /ws/collab/:document_id and listens for Opcode 0x02 Review Events.
Appends received events to a JSON Lines (JSONL) file for integration test verification.
"""

import sys
import argparse
import asyncio
import json
from pathlib import Path
import websockets

async def listen_for_events(url: str, token: str, events_file: str, max_events: int = 0):
    print(f"[LISTENER] Connecting to {url}...")
    events_path = Path(events_file)
    events_path.parent.mkdir(parents=True, exist_ok=True)
    if events_path.exists():
        events_path.unlink()

    event_count = 0
    async with websockets.connect(
        url,
        additional_headers={"Authorization": f"Bearer {token}"}
    ) as ws:
        print("[LISTENER] Connected and authenticated. Listening for frames...")
        # Write ready flag file or marker
        ready_path = events_path.with_suffix(".ready")
        ready_path.write_text("READY\n")

        async for message in ws:
            if not isinstance(message, bytes) or len(message) < 2:
                continue

            opcode = message[0]
            if opcode == 0x02: # Opcode 0x02: Review Event Notification
                payload_str = message[1:].decode("utf-8")
                print(f"[LISTENER] Received Review Event: {payload_str}")
                with open(events_path, "a", encoding="utf-8") as f:
                    f.write(payload_str + "\n")
                    f.flush()
                event_count += 1
                if max_events > 0 and event_count >= max_events:
                    print(f"[LISTENER] Reached target event count ({max_events}). Exiting.")
                    break
            elif opcode == 0x00: # CRDT Sync
                subtype = message[1]
                print(f"[LISTENER] Received CRDT Sync frame (subtype: {hex(subtype)}, length: {len(message)} bytes)")


def main():
    parser = argparse.ArgumentParser(description="CME Review Event Listener")
    parser.add_argument("--url", required=True, help="WebSocket URL")
    parser.add_argument("--token", required=True, help="Auth token")
    parser.add_argument("--events-file", required=True, help="Path to write JSONL review events")
    parser.add_argument("--max-events", type=int, default=0, help="Stop after N events (0 for continuous)")
    args = parser.parse_args()

    try:
        asyncio.run(listen_for_events(args.url, args.token, args.events_file, args.max_events))
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
