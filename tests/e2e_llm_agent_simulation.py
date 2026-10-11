#!/usr/bin/env python3
"""
Phase 7, Step 7.1: LLM Tooling & REST Automation Integration Test

Validates programmatic API interactions for AI agents and automated scripts:
  1. Read directory tree (GET /api/v1/workspaces/tree)
  2. Read document content (GET /api/v1/documents/{id}/raw)
  3. Post review comment (POST /api/v1/documents/{id}/comments)
  4. Propose text suggestion (POST /api/v1/documents/{id}/suggestions)
  5. Resolve task (PATCH /api/v1/tasks/{id})

Status criteria:
  Script executes all 5 actions successfully; assertions confirm database records
  and WebSocket notifications emit as expected.
"""

import os
import sys
import time
import json
import signal
import argparse
import asyncio
import subprocess
from pathlib import Path
from typing import Optional, List, Dict, Any
import requests
import websockets


class CMEAgentSimulator:
    def __init__(
        self,
        base_url: str,
        token: Optional[str] = None,
        db_url: str = "postgresql://cme:secret@localhost:5432/cme_test",
        spawn_port: int = 18092,
        spawn_storage: str = "/tmp/cme_agent_sim_storage",
    ):
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.db_url = db_url
        self.spawn_port = spawn_port
        self.spawn_storage = Path(spawn_storage)
        self.server_process: Optional[subprocess.Popen] = None
        self.received_events: List[Dict[str, Any]] = []
        self.ws_task: Optional[asyncio.Task] = None
        self.ws_stop_event = asyncio.Event()

    def start_server_if_needed(self):
        """Checks if target CME server is alive; if not, launches a test instance."""
        try:
            r = requests.get(f"{self.base_url}/api/v1/health", timeout=1.0)
            if r.status_code == 200:
                print(f"[INIT] CME Server active at {self.base_url}")
                return
        except Exception:
            pass

        print(f"[INIT] No server detected at {self.base_url}. Spawning test daemon on port {self.spawn_port}...")
        self.base_url = f"http://127.0.0.1:{self.spawn_port}"

        # Clean test storage
        if self.spawn_storage.exists():
            import shutil
            shutil.rmtree(self.spawn_storage, ignore_errors=True)
        self.spawn_storage.mkdir(parents=True, exist_ok=True)

        server_bin = Path(__file__).resolve().parent.parent / "build" / "bin" / "cme-server"
        if not server_bin.exists():
            raise FileNotFoundError(f"cme-server binary not found at {server_bin}. Run cmake --build build first.")

        cmd = [
            str(server_bin),
            "--data-dir", str(self.spawn_storage),
            "--db-url", self.db_url,
            "--port", str(self.spawn_port),
        ]

        self.server_process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            preexec_fn=os.setsid if hasattr(os, "setsid") else None,
        )

        # Poll for health
        start_time = time.time()
        while time.time() - start_time < 10.0:
            try:
                r = requests.get(f"{self.base_url}/api/v1/health", timeout=0.5)
                if r.status_code == 200:
                    print(f"[INIT] Spawned server is healthy at {self.base_url}")
                    return
            except Exception:
                time.sleep(0.1)

        raise RuntimeError("Spawned cme-server failed to become healthy within 10 seconds.")

    def authenticate(self):
        """Authenticates and retrieves a JWT Bearer token if not provided."""
        if self.token:
            print("[AUTH] Using provided API token.")
            return

        print("[AUTH] Authenticating as test_admin...")
        login_url = f"{self.base_url}/api/v1/auth/login"
        payload = {"username": "test_admin", "password": "password123"}
        resp = requests.post(login_url, json=payload, timeout=5.0)

        if resp.status_code == 200:
            self.token = resp.json().get("token")
            print("[AUTH] Successfully logged in as test_admin.")
            return

        # Fallback to rev_alice
        payload = {"username": "rev_alice", "password": "password123"}
        resp = requests.post(login_url, json=payload, timeout=5.0)
        if resp.status_code == 200:
            self.token = resp.json().get("token")
            print("[AUTH] Successfully logged in as rev_alice.")
            return

        raise RuntimeError(f"Authentication failed: {resp.status_code} - {resp.text}")

    @property
    def auth_headers(self) -> Dict[str, str]:
        return {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json",
        }

    async def _ws_listener(self, ws_url: str):
        """Subscribes to document WebSocket room and collects Opcode 0x02 review events."""
        print(f"[WS] Connecting listener to {ws_url}...")
        try:
            async with websockets.connect(
                ws_url,
                additional_headers={"Authorization": f"Bearer {self.token}"},
            ) as ws:
                print("[WS] Connected to document room. Listening for opcode 0x02 events...")
                while not self.ws_stop_event.is_set():
                    try:
                        msg = await asyncio.wait_for(ws.recv(), timeout=0.5)
                        if isinstance(msg, bytes) and len(msg) >= 2:
                            opcode = msg[0]
                            if opcode == 0x02:  # Review event notification
                                payload_str = msg[1:].decode("utf-8")
                                event_json = json.loads(payload_str)
                                print(f"[WS] Received Opcode 0x02 event: {event_json.get('event')}")
                                self.received_events.append(event_json)
                    except asyncio.TimeoutError:
                        continue
                    except Exception as e:
                        if not self.ws_stop_event.is_set():
                            print(f"[WS] Error receiving message: {e}")
                        break
        except Exception as e:
            if not self.ws_stop_event.is_set():
                print(f"[WS] Connection error: {e}")

    async def wait_for_ws_event(self, event_name: str, timeout: float = 5.0) -> Optional[Dict[str, Any]]:
        """Waits for an opcode 0x02 review event with matching event name."""
        start_time = time.time()
        while time.time() - start_time < timeout:
            for ev in reversed(self.received_events):
                if ev.get("event") == event_name:
                    return ev
            await asyncio.sleep(0.05)
        return None

    def cleanup(self):
        """Stops background tasks and terminates spawned server daemon."""
        if self.ws_task and not self.ws_task.done():
            self.ws_stop_event.set()
            self.ws_task.cancel()

        if self.server_process:
            print("[CLEANUP] Stopping spawned CME test server...")
            try:
                if hasattr(os, "killpg"):
                    os.killpg(os.getpgid(self.server_process.pid), signal.SIGTERM)
                else:
                    self.server_process.terminate()
                self.server_process.wait(timeout=3.0)
            except Exception:
                pass


async def run_simulation(args):
    print("=" * 70)
    print("=== Phase 7, Step 7.1: LLM Tooling & REST Automation Integration Test ===")
    print("=" * 70)

    sim = CMEAgentSimulator(
        base_url=args.url,
        token=args.token,
        db_url=args.db_url,
        spawn_port=args.port,
        spawn_storage=args.data_dir,
    )

    try:
        # Step 0: Server check & Authentication
        sim.start_server_if_needed()
        sim.authenticate()

        # Step 0.1: Create target test document for AI agent review
        doc_filename = f"agent_review_{int(time.time())}.md"
        doc_path = f"specs/{doc_filename}"
        doc_title = "Distributed Consensus Reactor Specification"
        initial_markdown = (
            "# Distributed Consensus Reactor Specification\n\n"
            "The communication subsystem utilizes single-threaded event loops for high-throughput messaging.\n"
            "Ensure strict deterministic ordering across concurrent state transitions.\n"
            "All pending action items must be resolved prior to production release.\n"
        )

        create_resp = requests.post(
            f"{sim.base_url}/api/v1/documents",
            headers=sim.auth_headers,
            json={
                "path": doc_path,
                "title": doc_title,
                "content": initial_markdown,
            },
            timeout=5.0,
        )
        assert create_resp.status_code in (200, 201), f"Failed to create document: {create_resp.text}"
        doc_data = create_resp.json()
        doc_id = doc_data["id"]
        print(f"[SETUP] Created test document: ID={doc_id}, Path='{doc_path}'")

        # Start WebSocket listener for document room
        ws_scheme = "ws" if sim.base_url.startswith("http://") else "wss"
        ws_host = sim.base_url.split("://", 1)[1]
        ws_url = f"{ws_scheme}://{ws_host}/ws/collab/{doc_id}?token={sim.token}"
        sim.ws_task = asyncio.create_task(sim._ws_listener(ws_url))
        await asyncio.sleep(0.3)  # Allow WS handshake to complete

        # =====================================================================
        # Action 1: Read directory tree (GET /api/v1/workspaces/tree)
        # =====================================================================
        print("\n--- Action 1: Read directory tree (GET /api/v1/workspaces/tree) ---")
        tree_resp = requests.get(
            f"{sim.base_url}/api/v1/workspaces/tree",
            headers=sim.auth_headers,
            timeout=5.0,
        )
        assert tree_resp.status_code == 200, f"Action 1 failed: status {tree_resp.status_code}"
        tree_data = tree_resp.json()
        tree_nodes = tree_data.get("tree", tree_data) if isinstance(tree_data, dict) else tree_data
        assert isinstance(tree_nodes, list), "Tree response must contain an array of directory nodes"

        def find_doc_in_tree(nodes, target_id, target_path):
            for n in nodes:
                if n.get("id") == target_id or n.get("path") == target_path:
                    return n
                if "children" in n and isinstance(n["children"], list):
                    res = find_doc_in_tree(n["children"], target_id, target_path)
                    if res:
                        return res
            return None

        found_node = find_doc_in_tree(tree_nodes, doc_id, doc_path)
        assert found_node is not None, f"Document ID {doc_id} was not found in the workspace tree!"
        assert found_node.get("title") == doc_title
        print(f"  [PASS] Action 1: Successfully inspected workspace tree and located '{doc_title}'.")

        # =====================================================================
        # Action 2: Read document content (GET /api/v1/documents/{id}/raw)
        # =====================================================================
        print("\n--- Action 2: Read document content (GET /api/v1/documents/{id}/raw) ---")
        raw_resp = requests.get(
            f"{sim.base_url}/api/v1/documents/{doc_id}/raw",
            headers={"Authorization": f"Bearer {sim.token}"},
            timeout=5.0,
        )
        assert raw_resp.status_code == 200, f"Action 2 failed: status {raw_resp.status_code}"
        raw_content = raw_resp.text
        assert "Distributed Consensus Reactor Specification" in raw_content
        assert "single-threaded event loops for high-throughput messaging" in raw_content
        print(f"  [PASS] Action 2: Successfully retrieved raw markdown content ({len(raw_content)} bytes).")

        # =====================================================================
        # Action 3: Post review comment (POST /api/v1/documents/{id}/comments)
        # =====================================================================
        print("\n--- Action 3: Post review comment (POST /api/v1/documents/{id}/comments) ---")
        comment_payload = {
            "content": "AI Agent: Recommend migrating from single-threaded loops to epoll-driven asynchronous reactors to eliminate head-of-line blocking.",
            "anchor": {
                "type": "dual",
                "quote": {
                    "exact": "high-throughput messaging",
                    "prefix": "loops for ",
                    "suffix": ".\nEnsure strict",
                },
                "offset": 92,
                "length": 25,
            },
        }

        comment_resp = requests.post(
            f"{sim.base_url}/api/v1/documents/{doc_id}/comments",
            headers=sim.auth_headers,
            json=comment_payload,
            timeout=5.0,
        )
        assert comment_resp.status_code in (200, 201), f"Action 3 failed: {comment_resp.text}"
        comment_data = comment_resp.json()
        comment_id = comment_data["id"]
        assert comment_data["status"] == "OPEN"
        assert comment_data["content"] == comment_payload["content"]

        # Verify WebSocket opcode 0x02 notification for COMMENT_CREATED
        comment_event = await sim.wait_for_ws_event("COMMENT_CREATED", timeout=5.0)
        assert comment_event is not None, "WebSocket did not receive COMMENT_CREATED event!"
        assert comment_event.get("comment", {}).get("id") == comment_id
        print(f"  [PASS] Action 3: Posted review comment (ID={comment_id}) and verified Opcode 0x02 COMMENT_CREATED fanout.")

        # =====================================================================
        # Action 4: Propose text suggestion (POST /api/v1/documents/{id}/suggestions)
        # =====================================================================
        print("\n--- Action 4: Propose text suggestion (POST /api/v1/documents/{id}/suggestions) ---")
        suggestion_payload = {
            "original_text": "single-threaded event loops",
            "suggested_text": "epoll-backed asynchronous reactor loops",
            "anchor": {
                "type": "dual",
                "quote": {
                    "exact": "single-threaded event loops",
                    "prefix": "utilizes ",
                    "suffix": " for high-throughput",
                },
                "offset": 64,
                "length": 27,
            },
        }

        sugg_resp = requests.post(
            f"{sim.base_url}/api/v1/documents/{doc_id}/suggestions",
            headers=sim.auth_headers,
            json=suggestion_payload,
            timeout=5.0,
        )
        assert sugg_resp.status_code in (200, 201), f"Action 4 failed: {sugg_resp.text}"
        sugg_data = sugg_resp.json()
        sugg_id = sugg_data["id"]
        assert sugg_data["status"] == "PENDING"
        assert sugg_data["suggested_text"] == suggestion_payload["suggested_text"]

        # Verify WebSocket opcode 0x02 notification for SUGGESTION_CREATED
        sugg_event = await sim.wait_for_ws_event("SUGGESTION_CREATED", timeout=5.0)
        assert sugg_event is not None, "WebSocket did not receive SUGGESTION_CREATED event!"
        assert sugg_event.get("suggestion", {}).get("id") == sugg_id
        print(f"  [PASS] Action 4: Proposed edit suggestion (ID={sugg_id}) and verified Opcode 0x02 SUGGESTION_CREATED fanout.")

        # =====================================================================
        # Action 5: Resolve task (PATCH /api/v1/tasks/{id})
        # =====================================================================
        print("\n--- Action 5: Resolve task (PATCH /api/v1/tasks/{id}) ---")
        # 5a. Create a review task linked to the comment
        task_desc = "Benchmark epoll reactor throughput under 10k concurrent peer connections"
        task_create_resp = requests.post(
            f"{sim.base_url}/api/v1/documents/{doc_id}/tasks",
            headers=sim.auth_headers,
            json={
                "description": task_desc,
                "comment_id": comment_id,
            },
            timeout=5.0,
        )
        assert task_create_resp.status_code in (200, 201), f"Task creation failed: {task_create_resp.text}"
        task_data = task_create_resp.json()
        task_id = task_data["id"]
        assert task_data["is_completed"] is False

        # Verify WebSocket opcode 0x02 notification for TASK_CREATED
        task_created_event = await sim.wait_for_ws_event("TASK_CREATED", timeout=5.0)
        assert task_created_event is not None, "WebSocket did not receive TASK_CREATED event!"
        assert task_created_event.get("task", {}).get("id") == task_id

        # 5b. Resolve the task via PATCH /api/v1/tasks/:id
        patch_resp = requests.patch(
            f"{sim.base_url}/api/v1/tasks/{task_id}",
            headers=sim.auth_headers,
            json={"is_completed": True},
            timeout=5.0,
        )
        assert patch_resp.status_code == 200, f"Action 5 failed: {patch_resp.text}"
        updated_task = patch_resp.json()
        assert updated_task["is_completed"] is True
        assert updated_task["completed_at"] is not None

        # Verify WebSocket opcode 0x02 notification for TASK_TOGGLED
        task_toggle_event = await sim.wait_for_ws_event("TASK_TOGGLED", timeout=5.0)
        if not task_toggle_event:
            # Fallback to TASK_UPDATED if server used legacy opcode name
            task_toggle_event = await sim.wait_for_ws_event("TASK_UPDATED", timeout=2.0)
        assert task_toggle_event is not None, "WebSocket did not receive TASK_TOGGLED event!"
        assert task_toggle_event.get("task", {}).get("id") == task_id
        assert task_toggle_event.get("task", {}).get("is_completed") is True
        print(f"  [PASS] Action 5: Resolved task (ID={task_id}) and verified Opcode 0x02 TASK_TOGGLED fanout.")

        # =====================================================================
        # Verification: Confirm Database State Consistency via Query Endpoints
        # =====================================================================
        print("\n--- Verifying Authoritative Relational Database State ---")
        # Check comments list
        comments_list_resp = requests.get(
            f"{sim.base_url}/api/v1/documents/{doc_id}/comments",
            headers=sim.auth_headers,
            timeout=5.0,
        )
        assert comments_list_resp.status_code == 200
        comments = comments_list_resp.json()
        assert any(c["id"] == comment_id and c["status"] == "OPEN" for c in comments)

        # Check suggestions list
        suggs_list_resp = requests.get(
            f"{sim.base_url}/api/v1/documents/{doc_id}/suggestions",
            headers=sim.auth_headers,
            timeout=5.0,
        )
        assert suggs_list_resp.status_code == 200
        suggestions = suggs_list_resp.json()
        assert any(s["id"] == sugg_id and s["status"] == "PENDING" for s in suggestions)

        # Check tasks list
        tasks_list_resp = requests.get(
            f"{sim.base_url}/api/v1/documents/{doc_id}/tasks",
            headers=sim.auth_headers,
            timeout=5.0,
        )
        assert tasks_list_resp.status_code == 200
        tasks = tasks_list_resp.json()
        assert any(t["id"] == task_id and t["is_completed"] is True for t in tasks)
        print("  [PASS] Database state verified: comment OPEN, suggestion PENDING, task COMPLETED.")

        # Clean up test document
        requests.delete(f"{sim.base_url}/api/v1/documents/{doc_id}", headers=sim.auth_headers, timeout=5.0)

        print("\n" + "=" * 70)
        print("🎉 ALL 5 AI AGENT AUTOMATION ACTIONS PASSED!")
        print("Status criteria met: Programmatic API interactions verified with real-time WebSocket fanout.")
        print("=" * 70)
        return 0

    finally:
        sim.cleanup()


def main():
    parser = argparse.ArgumentParser(description="CME LLM Agent Simulation E2E Test (Step 7.1)")
    parser.add_argument("--url", default="http://127.0.0.1:8080", help="Base HTTP URL of CME server")
    parser.add_argument("--token", default=None, help="Authentication API Token (Bearer)")
    parser.add_argument("--port", type=int, default=18092, help="Port to spawn test server on if none is running")
    parser.add_argument("--data-dir", default="/tmp/cme_agent_sim_storage", help="Data directory for test storage")
    parser.add_argument("--db-url", default="postgresql://cme:secret@localhost:5432/cme_test", help="PostgreSQL connection string")
    args = parser.parse_args()

    sys.exit(asyncio.run(run_simulation(args)))


if __name__ == "__main__":
    main()
