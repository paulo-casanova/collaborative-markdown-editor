#!/usr/bin/env python3
"""
CME WebSocket Collaborative Edit Simulator.
Simulates a real collaborator client:
1. Connects to /ws/collab/:document_id with Bearer authentication.
2. Performs full Yjs CRDT handshake (SyncStep1 -> SyncStep2).
3. Applies server document state into a local Yrs CRDT document via libyrs.so FFI.
4. Inserts text into the collaborative document.
5. Emits binary CRDT SyncUpdate (Opcode 0x00, Subtype 0x03) frame.
6. Cleanly disconnects to trigger room idle & eviction lifecycle.
"""

import os
import sys
import time
import argparse
import asyncio
import ctypes
from pathlib import Path
import websockets

def find_libyrs():
    script_dir = Path(__file__).resolve().parent
    candidates = [
        script_dir / "../backend/third_party/yrs/lib/libyrs.so",
        script_dir / "../build/backend/third_party/yrs/lib/libyrs.so",
        Path("/home/pasc/cme/backend/third_party/yrs/lib/libyrs.so")
    ]
    for c in candidates:
        if c.exists():
            return str(c.resolve())
    raise FileNotFoundError("Could not locate libyrs.so C-FFI library")


class YrsBinding:
    def __init__(self, lib_path):
        self.lib = ctypes.CDLL(lib_path)

        self.lib.ydoc_new.restype = ctypes.c_void_p
        self.lib.ydoc_destroy.argtypes = [ctypes.c_void_p]

        self.lib.ytext.argtypes = [ctypes.c_void_p, ctypes.c_char_p]
        self.lib.ytext.restype = ctypes.c_void_p

        self.lib.ydoc_write_transaction.argtypes = [ctypes.c_void_p, ctypes.c_uint32, ctypes.c_char_p]
        self.lib.ydoc_write_transaction.restype = ctypes.c_void_p

        self.lib.ydoc_read_transaction.argtypes = [ctypes.c_void_p]
        self.lib.ydoc_read_transaction.restype = ctypes.c_void_p

        self.lib.ytransaction_commit.argtypes = [ctypes.c_void_p]

        self.lib.ytext_insert.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_uint32, ctypes.c_char_p, ctypes.c_char_p]
        self.lib.ytext_len.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
        self.lib.ytext_len.restype = ctypes.c_uint32

        self.lib.ytext_string.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
        self.lib.ytext_string.restype = ctypes.c_char_p
        self.lib.ystring_destroy.argtypes = [ctypes.c_char_p]

        self.lib.ytransaction_state_vector_v1.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_uint32)]
        self.lib.ytransaction_state_vector_v1.restype = ctypes.POINTER(ctypes.c_char)

        self.lib.ytransaction_state_diff_v1.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_uint32, ctypes.POINTER(ctypes.c_uint32)]
        self.lib.ytransaction_state_diff_v1.restype = ctypes.POINTER(ctypes.c_char)

        self.lib.ybinary_destroy.argtypes = [ctypes.POINTER(ctypes.c_char), ctypes.c_uint32]

        self.lib.ytransaction_apply.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_uint32]
        self.lib.ytransaction_apply.restype = ctypes.c_uint8


async def simulate_edit(url: str, token: str, insert_text: str, insert_idx: int | None, delay_after: float):
    lib_path = find_libyrs()
    yrs = YrsBinding(lib_path)

    doc = yrs.lib.ydoc_new()
    txt = yrs.lib.ytext(doc, b"content")

    try:
        print(f"[SIMULATOR] Connecting to {url}...")
        async with websockets.connect(
            url,
            additional_headers={"Authorization": f"Bearer {token}"}
        ) as ws:
            # 1. Server sends initial SyncStep1 state vector
            init_frame = await asyncio.wait_for(ws.recv(), timeout=5.0)
            assert init_frame[0] == 0x00 and init_frame[1] == 0x01, "Expected SyncStep1 on open"
            server_sv = init_frame[2:]
            print(f"[SIMULATOR] Server initial state vector received ({len(server_sv)} bytes)")

            # 2. Client requests initial document state (empty state vector -> full diff)
            client_empty_sv = b"\x00"
            await ws.send(b"\x00\x01" + client_empty_sv)

            # 3. Server returns SyncStep2 delta
            sync_resp = await asyncio.wait_for(ws.recv(), timeout=5.0)
            assert sync_resp[0] == 0x00 and sync_resp[1] == 0x02, "Expected SyncStep2 response"
            server_delta = sync_resp[2:]
            print(f"[SIMULATOR] Server SyncStep2 delta received ({len(server_delta)} bytes)")

            # 4. Ingest server document state into local doc
            if server_delta:
                txn = yrs.lib.ydoc_write_transaction(doc, 0, None)
                res = yrs.lib.ytransaction_apply(txn, server_delta, len(server_delta))
                yrs.lib.ytransaction_commit(txn)
                if res != 0:
                    raise RuntimeError(f"ytransaction_apply failed with code: {res}")

            # 5. Insert text
            txn = yrs.lib.ydoc_write_transaction(doc, 0, None)
            cur_len = yrs.lib.ytext_len(txt, txn)
            target_idx = cur_len if insert_idx is None else insert_idx
            text_bytes = insert_text.encode("utf-8")
            yrs.lib.ytext_insert(txt, txn, target_idx, text_bytes, None)
            yrs.lib.ytransaction_commit(txn)

            # 6. Extract delta relative to server_sv
            txn_read = yrs.lib.ydoc_read_transaction(doc)
            diff_len = ctypes.c_uint32(0)
            diff_ptr = yrs.lib.ytransaction_state_diff_v1(
                txn_read,
                server_sv if server_sv else None,
                len(server_sv),
                ctypes.byref(diff_len)
            )
            delta_bytes = ctypes.string_at(diff_ptr, diff_len.value)
            yrs.lib.ybinary_destroy(diff_ptr, diff_len.value)
            yrs.lib.ytransaction_commit(txn_read)

            print(f"[SIMULATOR] Computed edit delta: {len(delta_bytes)} bytes. Emitting SyncUpdate...")

            # 7. Send SyncUpdate frame: 0x00 0x03 <delta>
            await ws.send(b"\x00\x03" + delta_bytes)
            print("[SIMULATOR] Delta sent successfully.")

            if delay_after > 0:
                await asyncio.sleep(delay_after)

            print("[SIMULATOR] Disconnecting cleanly.")

    finally:
        yrs.lib.ydoc_destroy(doc)


def main():
    parser = argparse.ArgumentParser(description="CME WebSocket Collaborative Edit Simulator")
    parser.add_argument("--url", required=True, help="WebSocket URL (ws://.../ws/collab/:document_id)")
    parser.add_argument("--token", required=True, help="Session token or personal access token")
    parser.add_argument("--insert", required=True, help="Text string to insert into document")
    parser.add_argument("--index", type=int, default=None, help="Document character offset to insert at (default: end)")
    parser.add_argument("--delay", type=float, default=0.2, help="Seconds to wait before disconnecting")
    args = parser.parse_args()

    asyncio.run(simulate_edit(args.url, args.token, args.insert, args.index, args.delay))


if __name__ == "__main__":
    main()
