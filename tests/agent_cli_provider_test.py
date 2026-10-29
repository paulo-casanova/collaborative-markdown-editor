#!/usr/bin/env python3
"""
Unit and integration tests for cme-agent CLI Daemon improvements:
1. --auth-command option and fresh token fetching
2. --header option for delegated auth / custom proxy headers
3. --provider command / --cmd option running command-line agent (e.g. claude -p --output-format stream-json)
"""

import sys
import os
import json
import asyncio
import unittest
from unittest.mock import MagicMock, AsyncMock

# Add scripts directory to path to import CMEAgentDaemon
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
import importlib.machinery
cme_agent = importlib.machinery.SourceFileLoader("cme_agent", os.path.join(os.path.dirname(__file__), "..", "scripts", "cme-agent")).load_module()
CMEAgentDaemon = cme_agent.CMEAgentDaemon


class MockWebSocket:
    def __init__(self):
        self.sent_messages = []

    async def send(self, msg: str):
        self.sent_messages.append(json.loads(msg))


class TestCMEAgentCLIImprovements(unittest.IsolatedAsyncioTestCase):

    def test_provider_detection_and_aliases(self):
        # 1. Alias 'cli' resolves to 'command'
        agent_cli = CMEAgentDaemon("http://localhost:8080", token="tok123", agent_name="test", provider="cli")
        self.assertEqual(agent_cli.provider, "command")
        self.assertEqual(agent_cli.command, "claude -p --output-format stream-json --verbose")

        # 2. Alias 'claude' resolves to 'command'
        agent_claude = CMEAgentDaemon("http://localhost:8080", token="tok123", agent_name="test", provider="claude")
        self.assertEqual(agent_claude.provider, "command")

        # 3. Passing custom command with auto provider
        agent_cmd = CMEAgentDaemon("http://localhost:8080", token="tok123", agent_name="test", command="my-agent --flag")
        self.assertEqual(agent_cmd.provider, "command")
        self.assertEqual(agent_cmd.command, "my-agent --flag")

    def test_auth_command_execution(self):
        # Successful auth command returning a fresh token
        agent = CMEAgentDaemon("http://localhost:8080", auth_command="echo fresh_token_9999", agent_name="test")
        token = agent._fetch_token_from_auth_command()
        self.assertEqual(token, "fresh_token_9999")

        # Failing auth command raises exception
        agent_bad = CMEAgentDaemon("http://localhost:8080", auth_command="exit 1", agent_name="test")
        with self.assertRaises(Exception):
            agent_bad._fetch_token_from_auth_command()

    def test_delegated_headers_configuration(self):
        agent = CMEAgentDaemon(
            "http://localhost:8080",
            headers=["X-Remote-User: carol_proxy", "X-Remote-Email: carol@example.com"],
            agent_name="test"
        )
        self.assertIn("X-Remote-User: carol_proxy", agent.headers)
        self.assertIn("X-Remote-Email: carol@example.com", agent.headers)
        # Should validate successfully without token because headers are provided
        agent.validate_provider()

    def test_header_cmd_execution(self):
        # 1. Line-delimited headers from command
        cmd_lines = "printf 'Authorization: Bearer dynamic_token_123\\nX-Custom-Auth: custom_secret\\n'"
        agent_lines = CMEAgentDaemon("http://localhost:8080", header_cmd=cmd_lines, agent_name="test")
        hdrs_lines = agent_lines._fetch_headers_from_cmd()
        self.assertEqual(hdrs_lines.get("Authorization"), "Bearer dynamic_token_123")
        self.assertEqual(hdrs_lines.get("X-Custom-Auth"), "custom_secret")

        # 2. JSON headers from command
        cmd_json = "echo '{\"Authorization\": \"Bearer json_token_456\", \"X-Remote-User\": \"eve\"}'"
        agent_json = CMEAgentDaemon("http://localhost:8080", header_cmd=cmd_json, agent_name="test")
        hdrs_json = agent_json._fetch_headers_from_cmd()
        self.assertEqual(hdrs_json.get("Authorization"), "Bearer json_token_456")
        self.assertEqual(hdrs_json.get("X-Remote-User"), "eve")

        # 3. Provider validation passes with header_cmd alone
        agent_json.validate_provider()

        # 4. Error in header command raises exception
        agent_err = CMEAgentDaemon("http://localhost:8080", header_cmd="exit 2", agent_name="test")
        with self.assertRaises(Exception):
            agent_err._fetch_headers_from_cmd()

    async def test_stream_command_ndjson_claude_format(self):
        """Simulates `claude -p --output-format stream-json` emitting NDJSON events."""
        # Python one-liner simulating Claude CLI's NDJSON output stream
        sim_cmd = (
            "python3 -c '"
            "import sys, json, time;\n"
            "print(json.dumps({\"type\": \"stream_event\", \"event\": {\"type\": \"content_block_delta\", \"delta\": {\"type\": \"thinking_delta\", \"thinking\": \"Inspecting document lines...\"}}}), flush=True);\n"
            "print(json.dumps({\"type\": \"tool_use\", \"name\": \"grep\", \"input\": {\"query\": \"section\"}}), flush=True);\n"
            "print(json.dumps({\"type\": \"stream_event\", \"event\": {\"type\": \"content_block_delta\", \"delta\": {\"type\": \"text_delta\", \"text\": \"Here is the edit:\\n\"}}}), flush=True);\n"
            "print(json.dumps({\"type\": \"stream_event\", \"event\": {\"type\": \"content_block_delta\", \"delta\": {\"type\": \"text_delta\", \"text\": \"```action\\n{\\\"action\\\": \\\"direct_edit\\\", \\\"original_text\\\": \\\"old text\\\", \\\"replacement_text\\\": \\\"new text\\\"}\\n```\\n\"}}}), flush=True);\n"
            "print(json.dumps({\"type\": \"result\", \"result\": \"Complete\"}), flush=True);\n"
            "'"
        )

        agent = CMEAgentDaemon("http://localhost:8080", token="tok", provider="command", command=sim_cmd)
        ws = MockWebSocket()

        await agent._stream_command(
            ws,
            dialog_id="test_dlg_1",
            prompt="Replace old text with new text",
            history=[],
            context={"document_path": "doc.md", "document_content": "old text in document"}
        )

        types = [m.get("type") for m in ws.sent_messages]
        self.assertIn("tool_activity", types)
        self.assertIn("token_stream", types)
        self.assertIn("agent_action", types)
        self.assertIn("prompt_complete", types)

        # Check action payload
        action_msg = next(m for m in ws.sent_messages if m.get("type") == "agent_action")
        self.assertEqual(action_msg.get("action"), "direct_edit")
        self.assertEqual(action_msg.get("payload", {}).get("original_text"), "old text")
        self.assertEqual(action_msg.get("payload", {}).get("replacement_text"), "new text")

        # Check prompt complete content
        complete_msg = next(m for m in ws.sent_messages if m.get("type") == "prompt_complete")
        self.assertIn("Here is the edit:", complete_msg.get("content"))

    async def test_stream_command_plaintext_format(self):
        """Simulates an arbitrary CLI script emitting standard plaintext output."""
        sim_cmd = "python3 -c 'import sys; print(\"Line 1: Hello from CLI agent\"); print(\"Line 2: Done.\")'"

        agent = CMEAgentDaemon("http://localhost:8080", token="tok", provider="command", command=sim_cmd)
        ws = MockWebSocket()

        await agent._stream_command(
            ws,
            dialog_id="test_dlg_2",
            prompt="Hello CLI",
            history=[],
            context={}
        )

        tokens = [m["delta"] for m in ws.sent_messages if m.get("type") == "token_stream"]
        full_stream = "".join(tokens)
        self.assertIn("Line 1: Hello from CLI agent", full_stream)
        self.assertIn("Line 2: Done.", full_stream)

        complete_msg = next(m for m in ws.sent_messages if m.get("type") == "prompt_complete")
        self.assertIn("Hello from CLI agent", complete_msg.get("content"))

    async def test_stream_command_error_handling(self):
        """Verifies graceful handling and reporting of non-zero CLI tool exit codes."""
        sim_cmd = "python3 -c 'import sys; sys.stderr.write(\"Fatal CLI error: model crashed\\n\"); sys.exit(2)'"

        agent = CMEAgentDaemon("http://localhost:8080", token="tok", provider="command", command=sim_cmd)
        ws = MockWebSocket()

        await agent._stream_command(
            ws,
            dialog_id="test_dlg_3",
            prompt="Do something",
            history=[],
            context={}
        )

        complete_msg = next(m for m in ws.sent_messages if m.get("type") == "prompt_complete")
        self.assertIn("Error running command agent", complete_msg.get("content"))
        self.assertIn("Fatal CLI error: model crashed", complete_msg.get("content"))


if __name__ == "__main__":
    unittest.main()
