#!/usr/bin/env python3
"""
Test script for Phase 2: Local Agent WebSocket Gateway and Dialog Event Stream.
Validates:
  1. Initial offline status (/api/v1/user/agent/status)
  2. Agent WebSocket connection (/api/v1/agents/ws) and 'agent_ack'
  3. Online status with agent name (/api/v1/user/agent/status)
  4. Dialog Event Stream connection (/ws/dialog/:dialog_id)
  5. Prompt dispatch via POST /api/v1/dialogs/:id/messages
  6. Agent receiving 'prompt_request' and Browser receiving 'user_message'
  7. Agent streaming 'token_stream', 'tool_activity', 'diff_proposal', 'prompt_complete'
  8. Browser receiving all streamed events in real-time
  9. Automatic persistence of assistant message in dialog history
 10. Agent ping/pong heartbeat
 11. Disconnect and transition back to offline status
 12. Rejection of invalid agent tokens
"""

import asyncio
import json
import urllib.request
import sys
import websockets

def http_get(url, token=None):
    headers = {}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, headers=headers, method="GET")
    with urllib.request.urlopen(req) as resp:
        return resp.status, json.loads(resp.read().decode())

def http_post(url, payload, token=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    with urllib.request.urlopen(req) as resp:
        return resp.status, json.loads(resp.read().decode())

async def main():
    if len(sys.argv) < 5:
        print(f"Usage: {sys.argv[0]} <base_url> <agent_token> <session_token> <dialog_id>")
        sys.exit(1)

    base_url = sys.argv[1].rstrip("/")
    agent_token = sys.argv[2]
    session_token = sys.argv[3]
    dialog_id = sys.argv[4]

    ws_base = base_url.replace("http://", "ws://").replace("https://", "wss://")
    agent_ws_url = f"{ws_base}/api/v1/agents/ws?token={agent_token}&name=TestLocalAgent"
    dialog_ws_url = f"{ws_base}/ws/dialog/{dialog_id}?token={session_token}"

    print(f"[TEST AGENT GW] Starting agent gateway test suite against {base_url}...")

    # Step 1: Verify agent is initially offline
    print("\n[STEP 1] Checking agent status before connection...")
    status_code, status_data = http_get(f"{base_url}/api/v1/user/agent/status", token=session_token)
    assert status_code == 200, f"Expected 200, got {status_code}"
    assert status_data["online"] is False, f"Expected online=False, got {status_data}"
    print("  - Agent status verified: online = False")

    # Step 2: Connect Mock Agent
    print("\n[STEP 2] Connecting mock local agent to gateway...")
    async with websockets.connect(agent_ws_url) as agent_ws:
        ack_raw = await asyncio.wait_for(agent_ws.recv(), timeout=3.0)
        ack = json.loads(ack_raw)
        print(f"  - Received agent handshake: {ack}")
        assert ack.get("type") == "agent_ack"
        assert ack.get("status") == "connected"
        assert ack.get("agent_name") == "TestLocalAgent"

        # Step 3: Verify agent is now online via REST
        print("\n[STEP 3] Verifying agent online status via REST...")
        status_code, status_data = http_get(f"{base_url}/api/v1/user/agent/status", token=session_token)
        assert status_code == 200
        assert status_data["online"] is True
        assert status_data["agent_name"] == "TestLocalAgent"
        print(f"  - Agent status verified: online = True, name = {status_data['agent_name']}")

        # Step 4: Connect Browser UI to Dialog Stream
        print("\n[STEP 4] Connecting UI client to dialog stream...")
        async with websockets.connect(dialog_ws_url) as browser_ws:
            conn_raw = await asyncio.wait_for(browser_ws.recv(), timeout=3.0)
            conn_msg = json.loads(conn_raw)
            print(f"  - Received browser stream connection: {conn_msg}")
            assert conn_msg.get("type") == "connected"
            assert conn_msg.get("dialog_id") == dialog_id

            # Step 5: Post user message via REST
            print("\n[STEP 5] Posting user message via REST API...")
            prompt_content = "Can you analyze Section 2 and suggest edits?"
            status_code, msg_data = http_post(
                f"{base_url}/api/v1/dialogs/{dialog_id}/messages",
                {
                    "role": "user",
                    "content": prompt_content,
                    "context_snapshot": {
                        "document_id": "doc-test-123",
                        "selected_text": "Phase 2 implementation in progress."
                    }
                },
                token=session_token
            )
            assert status_code == 201
            assert msg_data["agent_dispatched"] is True
            print(f"  - Message created: id = {msg_data['id']}, agent_dispatched = True")

            # Step 6: Browser receives user_message broadcast
            print("\n[STEP 6] Verifying browser receives user_message broadcast...")
            user_bcast_raw = await asyncio.wait_for(browser_ws.recv(), timeout=3.0)
            user_bcast = json.loads(user_bcast_raw)
            print(f"  - Browser received user event: {user_bcast.get('type')}")
            assert user_bcast.get("type") == "user_message"
            assert user_bcast.get("dialog_id") == dialog_id
            assert user_bcast["message"]["content"] == prompt_content

            # Step 7: Agent receives prompt_request
            print("\n[STEP 7] Verifying agent receives prompt_request...")
            prompt_req_raw = await asyncio.wait_for(agent_ws.recv(), timeout=3.0)
            prompt_req = json.loads(prompt_req_raw)
            print(f"  - Agent received prompt request: type={prompt_req.get('type')}, prompt='{prompt_req.get('prompt')}'")
            assert prompt_req.get("type") == "prompt_request"
            assert prompt_req.get("dialog_id") == dialog_id
            assert prompt_req.get("prompt") == prompt_content
            assert prompt_req.get("context", {}).get("document_id") == "doc-test-123"

            # Step 8: Agent streams responses
            print("\n[STEP 8] Mock agent streaming token chunks, tool activity, and diff proposal...")
            await agent_ws.send(json.dumps({
                "type": "token_stream",
                "dialog_id": dialog_id,
                "delta": "Certainly! "
            }))
            await agent_ws.send(json.dumps({
                "type": "token_stream",
                "dialog_id": dialog_id,
                "delta": "Here is the summary."
            }))
            await agent_ws.send(json.dumps({
                "type": "tool_activity",
                "dialog_id": dialog_id,
                "tool": "git_grep",
                "status": "executing"
            }))
            await agent_ws.send(json.dumps({
                "type": "diff_proposal",
                "dialog_id": dialog_id,
                "document_id": "doc-test-123",
                "diff": "--- a/doc\n+++ b/doc\n@@ -1 +1 @@\n-old\n+new"
            }))
            await agent_ws.send(json.dumps({
                "type": "agent_action",
                "dialog_id": dialog_id,
                "document_id": "doc-test-123",
                "action": "direct_edit",
                "payload": {"diff": "--- a/doc\n+++ b/doc\n@@ -1 +1 @@\n-old\n+new"}
            }))
            await agent_ws.send(json.dumps({
                "type": "prompt_complete",
                "dialog_id": dialog_id,
                "content": "Certainly! Here is the summary."
            }))

            # Step 9: Verify browser receives all streamed frames in order
            print("\n[STEP 9] Verifying browser client receives all streamed frames...")
            frame1 = json.loads(await asyncio.wait_for(browser_ws.recv(), timeout=3.0))
            assert frame1.get("type") == "token_stream" and frame1.get("delta") == "Certainly! "

            frame2 = json.loads(await asyncio.wait_for(browser_ws.recv(), timeout=3.0))
            assert frame2.get("type") == "token_stream" and frame2.get("delta") == "Here is the summary."

            frame3 = json.loads(await asyncio.wait_for(browser_ws.recv(), timeout=3.0))
            assert frame3.get("type") == "tool_activity" and frame3.get("tool") == "git_grep"

            frame4 = json.loads(await asyncio.wait_for(browser_ws.recv(), timeout=3.0))
            assert frame4.get("type") == "diff_proposal" and "--- a/doc" in frame4.get("diff", "")

            frame4b = json.loads(await asyncio.wait_for(browser_ws.recv(), timeout=3.0))
            assert frame4b.get("type") == "agent_action" and frame4b.get("action") == "direct_edit"

            frame5 = json.loads(await asyncio.wait_for(browser_ws.recv(), timeout=3.0))
            assert frame5.get("type") == "prompt_complete"
            assert frame5.get("content") == "Certainly! Here is the summary."
            print("  - All 6 frames received by browser client with exact payload matches.")

            # Step 10: Verify assistant message was saved to database
            print("\n[STEP 10] Verifying assistant message was persisted in database...")
            status_code, history_data = http_get(
                f"{base_url}/api/v1/dialogs/{dialog_id}/messages",
                token=session_token
            )
            assert status_code == 200
            assert len(history_data) == 2
            assert history_data[0]["role"] == "user"
            assert history_data[1]["role"] == "assistant"
            assert history_data[1]["content"] == "Certainly! Here is the summary."
            print("  - Database persistence confirmed: user and assistant messages present.")

            # Step 11: Agent Ping/Pong test
            print("\n[STEP 11] Testing Agent heartbeat ping/pong...")
            await agent_ws.send(json.dumps({"type": "ping"}))
            pong_raw = await asyncio.wait_for(agent_ws.recv(), timeout=3.0)
            pong = json.loads(pong_raw)
            assert pong.get("type") == "pong"
            print("  - Ping/pong heartbeat verified.")

    # Step 12: Verify Agent status returns to offline after socket close
    print("\n[STEP 12] Verifying agent offline status after disconnect...")
    # Give the server event loop a brief moment to process the disconnect
    await asyncio.sleep(0.1)
    status_code, status_data = http_get(f"{base_url}/api/v1/user/agent/status", token=session_token)
    assert status_code == 200
    assert status_data["online"] is False
    print("  - Agent status verified: offline.")

    # Step 13: Attempt agent connection with invalid token
    print("\n[STEP 13] Verifying agent gateway rejects invalid token...")
    bad_ws_url = f"{ws_base}/api/v1/agents/ws?token=invalid_dummy_token"
    rejected = False
    try:
        async with websockets.connect(bad_ws_url) as bad_ws:
            pass
    except Exception as e:
        status = getattr(e, "status_code", None)
        if hasattr(e, "response") and getattr(e.response, "status_code", None) is not None:
            status = e.response.status_code
        if status == 401 or "401" in str(e):
            rejected = True

    assert rejected, "Agent gateway should reject connection with invalid token"
    print("  - Invalid token correctly rejected with HTTP 401.")

    print("\n========================================================")
    print("=== ALL AGENT GATEWAY E2E TESTS PASSED (100% SUCCESS) ===")
    print("========================================================\n")

if __name__ == "__main__":
    asyncio.run(main())
