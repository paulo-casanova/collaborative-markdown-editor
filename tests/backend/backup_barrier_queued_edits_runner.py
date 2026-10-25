#!/usr/bin/env python3
"""
Test script for Issue #23:
Verifies that edits sent via WebSocket while a backup barrier is active are queued and applied upon barrier release.
"""

import asyncio
import json
import urllib.request
import websockets
import sys

async def main():
    base_url = sys.argv[1] # e.g. http://127.0.0.1:18097
    ws_url = sys.argv[2]   # e.g. ws://127.0.0.1:18097/ws/collab/<doc_id>
    token = sys.argv[3]
    doc_id = sys.argv[4]

    print("[TEST 23] Connecting WebSocket client 1 (Alice)...")
    async with websockets.connect(
        ws_url,
        additional_headers={"Authorization": f"Bearer {token}"}
    ) as alice_ws:
        init_frame = await alice_ws.recv()
        assert init_frame[0] == 0x00 and init_frame[1] == 0x01
        await alice_ws.send(b"\x00\x01\x00")
        step2 = await alice_ws.recv()
        assert step2[0] == 0x00 and step2[1] == 0x02
        delta = step2[2:]
        print("  - Alice handshake complete and synced")

        print("[TEST 23] Connecting WebSocket client 2 (Bob)...")
        async with websockets.connect(
            ws_url,
            additional_headers={"Authorization": f"Bearer {token}"}
        ) as bob_ws:
            await bob_ws.recv()
            await bob_ws.send(b"\x00\x01\x00")
            await bob_ws.recv()
            print("  - Bob handshake complete and synced")

            # Step 1: Engage Backup Barrier on server
            print("\n[TEST 23] Engaging backup barrier on server (POST /api/v1/admin/backup/prepare)...")
            req = urllib.request.Request(
                f"{base_url}/api/v1/admin/backup/prepare",
                headers={"Authorization": f"Bearer {token}"},
                method="POST"
            )
            with urllib.request.urlopen(req) as resp:
                data = json.loads(resp.read().decode())
                assert data["barrier_active"] is True
                print("  - Backup barrier is now ACTIVE")

            # Step 2: While barrier is active, Alice sends a SyncUpdate (0x00 0x03)
            print("\n[TEST 23] Alice sends SyncUpdate (0x00 0x03) while barrier is active...")
            update_frame = b"\x00\x03" + delta
            await alice_ws.send(update_frame)

            # Bob should NOT receive it yet while barrier is active (it is queued in memory)
            received_early = False
            try:
                msg = await asyncio.wait_for(bob_ws.recv(), timeout=0.3)
                if msg[0] == 0x00 and msg[1] == 0x03:
                    received_early = True
            except asyncio.TimeoutError:
                received_early = False

            print(f"  - Received by Bob during barrier? {'YES (unexpected)' if received_early else 'NO (correctly queued)'}")
            assert not received_early, "Update should be queued, not delivered during active barrier"
            assert alice_ws.state.name == "OPEN"

            # Step 3: Release Barrier on server
            print("\n[TEST 23] Releasing backup barrier on server (POST /api/v1/admin/backup/release)...")
            req_rel = urllib.request.Request(
                f"{base_url}/api/v1/admin/backup/release",
                headers={"Authorization": f"Bearer {token}"},
                method="POST"
            )
            with urllib.request.urlopen(req_rel) as resp:
                data = json.loads(resp.read().decode())
                assert data["barrier_active"] is False
                print("  - Backup barrier is now RELEASED")

            # Step 4: Bob must now receive the queued update!
            print("\n[TEST 23] Checking if Bob receives the queued update after barrier release...")
            bob_msg = await asyncio.wait_for(bob_ws.recv(), timeout=2.0)
            assert bob_msg[0] == 0x00 and bob_msg[1] == 0x03, "Bob must receive the queued SyncUpdate"
            print("  ✓ Bob successfully received the queued update after barrier release!")

            # Step 5: Normal subsequent edit works
            print("\n[TEST 23] Verifying subsequent edits work normally...")
            await alice_ws.send(b"\x00\x03" + delta)
            bob_msg2 = await asyncio.wait_for(bob_ws.recv(), timeout=2.0)
            assert bob_msg2[0] == 0x00 and bob_msg2[1] == 0x03
            print("  ✓ Subsequent edit delivered immediately to Bob!")

    print("\n====================================================================")
    print("=== ALL BACKUP BARRIER QUEUED EDIT TESTS PASSED!                 ===")
    print("====================================================================")

if __name__ == "__main__":
    asyncio.run(main())
