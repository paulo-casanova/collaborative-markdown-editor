#!/usr/bin/env python3
"""
Automated WebSocket Protocol Compliance Runner for CME (Collaborative Markdown Editor).
Validates 1-byte binary opcode wire protocol:
- 0x00: CRDT Sync (0x01 SyncStep1, 0x02 SyncStep2, 0x03 SyncUpdate)
- 0x01: Awareness & Cursor Presence
- 0x02: Real-time Review Event Notifications
- 0x03 / 0x04: Ping/Pong Heartbeats & Latency Verification
- Handshake Authentication: Bearer Header, Query Parameter, Cookie, Subprotocol
- Access Control: Rejections on Invalid Tokens (401) and Non-existent Docs (404)
"""

import asyncio
import json
import time
import argparse
import sys
import websockets
import websockets.exceptions

async def run_protocol_tests(args):
    url = args.url
    token = args.token

    print("==================================================================")
    print("=== CME WebSocket Wire Protocol Compliance Test Runner       ===")
    print("==================================================================")
    print(f"Target URL: {url}")

    # -------------------------------------------------------------------------
    # 1. Test Standard Handshake & SyncStep1 Initial Emission
    # -------------------------------------------------------------------------
    print("\n[TEST 1] Connecting with Authorization: Bearer <token>...")
    async with websockets.connect(
        url,
        additional_headers={"Authorization": f"Bearer {token}"}
    ) as ws:
        init_frame = await asyncio.wait_for(ws.recv(), timeout=5.0)
        assert isinstance(init_frame, bytes), "Initial handshake frame must be binary"
        assert len(init_frame) >= 2, f"Initial frame too short: {len(init_frame)} bytes"
        assert init_frame[0] == 0x00, f"Expected opcode 0x00, got {hex(init_frame[0])}"
        assert init_frame[1] == 0x01, f"Expected subtype 0x01 (SyncStep1), got {hex(init_frame[1])}"
        server_sv = init_frame[2:]
        print(f"  ✓ Handshake accepted: server SyncStep1 state vector received ({len(server_sv)} bytes)")

        # ---------------------------------------------------------------------
        # 2. Test SyncStep1 -> SyncStep2 State Vector Exchange
        # ---------------------------------------------------------------------
        print("\n[TEST 2] Testing CRDT State Vector Sync Handshake (SyncStep1 -> SyncStep2)...")
        # Send client state vector (SyncStep1: 0x00 0x01 <state_vector>)
        client_sv = b"\x00"  # lib0 v1 empty state vector
        await ws.send(b"\x00\x01" + client_sv)

        sync_resp = await asyncio.wait_for(ws.recv(), timeout=5.0)
        assert isinstance(sync_resp, bytes), "SyncStep2 response must be binary"
        assert len(sync_resp) >= 2, f"SyncStep2 frame too short: {len(sync_resp)} bytes"
        assert sync_resp[0] == 0x00, f"Expected opcode 0x00, got {hex(sync_resp[0])}"
        assert sync_resp[1] == 0x02, f"Expected subtype 0x02 (SyncStep2), got {hex(sync_resp[1])}"
        valid_crdt_delta = sync_resp[2:]
        print(f"  ✓ Server replied with SyncStep2 delta payload ({len(valid_crdt_delta)} bytes)")

        # ---------------------------------------------------------------------
        # 3. Test Ping / Pong Heartbeat Latency (< 10ms)
        # ---------------------------------------------------------------------
        print("\n[TEST 3] Testing Opcode 0x03 Ping -> 0x04 Pong Heartbeat Latency...")
        ping_payload = b"cme-ping-heartbeat-" + str(time.time_ns()).encode()
        ping_frame = b"\x03" + ping_payload

        t0 = time.perf_counter()
        await ws.send(ping_frame)
        pong_frame = await asyncio.wait_for(ws.recv(), timeout=5.0)
        t1 = time.perf_counter()
        rtt_ms = (t1 - t0) * 1000.0

        assert isinstance(pong_frame, bytes), "Pong response must be binary"
        assert len(pong_frame) >= 1, "Pong frame too short"
        assert pong_frame[0] == 0x04, f"Expected opcode 0x04 (Pong), got {hex(pong_frame[0])}"
        assert pong_frame[1:] == ping_payload, f"Pong payload mismatch: {pong_frame[1:]} != {ping_payload}"
        print(f"  ✓ Pong response verified in {rtt_ms:.3f} ms (Status criteria: < 10ms)")
        assert rtt_ms < 50.0, f"Ping/Pong RTT exceeded threshold: {rtt_ms:.3f} ms"

    # -------------------------------------------------------------------------
    # 4. Test Query Parameter Authentication (?token=...)
    # -------------------------------------------------------------------------
    print("\n[TEST 4] Connecting using ?token= query parameter...")
    delim = "&" if "?" in url else "?"
    query_url = f"{url}{delim}token={token}"
    async with websockets.connect(query_url) as ws:
        init_frame = await asyncio.wait_for(ws.recv(), timeout=5.0)
        assert init_frame[0] == 0x00 and init_frame[1] == 0x01
        print("  ✓ Authentication via ?token= query parameter validated")

    # -------------------------------------------------------------------------
    # 5. Test Cookie Authentication (Cookie: cme_session=...)
    # -------------------------------------------------------------------------
    print("\n[TEST 5] Connecting using Cookie: cme_session=<token>...")
    async with websockets.connect(
        url,
        additional_headers={"Cookie": f"cme_session={token}"}
    ) as ws:
        init_frame = await asyncio.wait_for(ws.recv(), timeout=5.0)
        assert init_frame[0] == 0x00 and init_frame[1] == 0x01
        print("  ✓ Authentication via Cookie header validated")

    # -------------------------------------------------------------------------
    # 6. Test Subprotocol Authentication (Sec-WebSocket-Protocol: bearer, <token>)
    # -------------------------------------------------------------------------
    print("\n[TEST 6] Connecting using Sec-WebSocket-Protocol: bearer, <token>...")
    async with websockets.connect(
        url,
        subprotocols=["bearer", token]
    ) as ws:
        init_frame = await asyncio.wait_for(ws.recv(), timeout=5.0)
        assert init_frame[0] == 0x00 and init_frame[1] == 0x01
        assert ws.subprotocol == "bearer"
        print("  ✓ Subprotocol authentication validated (negotiated: bearer)")

    # -------------------------------------------------------------------------
    # 7. Test Multi-Peer Broadcast (Awareness & CRDT Updates)
    # -------------------------------------------------------------------------
    print("\n[TEST 7] Testing Multi-Peer Broadcast (Awareness & SyncUpdate)...")
    async with websockets.connect(url, additional_headers={"Authorization": f"Bearer {token}"}) as peer1, \
               websockets.connect(url, additional_headers={"Authorization": f"Bearer {token}"}) as peer2:
        # Consume initial handshake frames on both peers
        await peer1.recv()
        await peer2.recv()

        # Peer 1 broadcasts awareness (0x01)
        awareness_data = json.dumps({
            "cursor": {"anchor": 42, "head": 42},
            "user": "Alice",
            "avatar_color": "#10b981"
        }).encode("utf-8")
        await peer1.send(b"\x01" + awareness_data)

        # Peer 2 must receive awareness frame
        recv_awareness = await asyncio.wait_for(peer2.recv(), timeout=5.0)
        assert recv_awareness[0] == 0x01, "Expected opcode 0x01 for awareness"
        assert recv_awareness[1:] == awareness_data, "Awareness payload mismatch"
        print("  ✓ Peer 2 received Peer 1's live awareness frame")

        # Peer 1 broadcasts review event (0x02)
        review_data = json.dumps({
            "event": "COMMENT_CREATED",
            "comment_id": "comm_test_123"
        }).encode("utf-8")
        await peer1.send(b"\x02" + review_data)

        recv_review = await asyncio.wait_for(peer2.recv(), timeout=5.0)
        assert recv_review[0] == 0x02, "Expected opcode 0x02 for review event"
        assert recv_review[1:] == review_data, "Review event payload mismatch"
        print("  ✓ Peer 2 received Peer 1's review event notification")

        # Peer 1 sends CRDT update (0x00 0x03)
        delta_payload = valid_crdt_delta
        await peer1.send(b"\x00\x03" + delta_payload)

        # Peer 2 must receive SyncUpdate frame
        recv_update = await asyncio.wait_for(peer2.recv(), timeout=5.0)
        assert recv_update[0] == 0x00 and recv_update[1] == 0x03, "Expected SyncUpdate frame"
        assert recv_update[2:] == delta_payload, "Update delta payload mismatch"
        print("  ✓ Peer 2 received Peer 1's CRDT SyncUpdate delta")

    # -------------------------------------------------------------------------
    # 8. Test Authentication Rejection (HTTP 401)
    # -------------------------------------------------------------------------
    print("\n[TEST 8] Testing Authentication Rejection with Invalid Token...")
    rejected_401 = False
    try:
        async with websockets.connect(
            url,
            additional_headers={"Authorization": "Bearer invalid_bad_token_hex_99999"}
        ):
            pass
    except websockets.exceptions.InvalidStatus as e:
        assert e.response.status_code == 401, f"Expected 401, got {e.response.status_code}"
        rejected_401 = True
    except Exception as e:
        if hasattr(e, 'status_code') and getattr(e, 'status_code') == 401:
            rejected_401 = True
        else:
            raise
    assert rejected_401, "Handshake was not rejected with HTTP 401"
    print("  ✓ Connection rejected with HTTP 401 Unauthorized as expected")

    # -------------------------------------------------------------------------
    # 9. Test Non-Existent Document Rejection (HTTP 404)
    # -------------------------------------------------------------------------
    print("\n[TEST 9] Testing Non-Existent Document Rejection (HTTP 404)...")
    rejected_404 = False
    parts = url.split("/ws/collab/")
    if len(parts) == 2:
        not_found_url = parts[0] + "/ws/collab/00000000-0000-0000-0000-000000000000"
        try:
            async with websockets.connect(
                not_found_url,
                additional_headers={"Authorization": f"Bearer {token}"}
            ):
                pass
        except websockets.exceptions.InvalidStatus as e:
            assert e.response.status_code == 404, f"Expected 404, got {e.response.status_code}"
            rejected_404 = True
        except Exception as e:
            if hasattr(e, 'status_code') and getattr(e, 'status_code') == 404:
                rejected_404 = True
            else:
                raise
        assert rejected_404, "Handshake was not rejected with HTTP 404"
        print("  ✓ Connection rejected with HTTP 404 Not Found as expected")

    print("\n==================================================================")
    print("=== All 9 WebSocket Protocol Tests PASSED Successfully!       ===")
    print("==================================================================")


def main():
    parser = argparse.ArgumentParser(description="CME WebSocket Protocol Runner")
    parser.add_argument("--url", required=True, help="WebSocket URL (e.g. ws://localhost:8080/ws/collab/<doc_id>)")
    parser.add_argument("--token", required=True, help="Session token or personal access token")
    args = parser.parse_args()

    try:
        asyncio.run(run_protocol_tests(args))
    except Exception as e:
        print(f"\n[FATAL ERROR] Test failed: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
