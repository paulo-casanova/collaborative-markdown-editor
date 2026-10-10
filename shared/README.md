# CME Shared Definitions

Shared constants, protocol definitions, and schema specifications shared between backend and frontend.

## Components

- **Opcode Definitions:** WebSocket 1-byte framing protocol (`0x00` Sync, `0x01` Aware, `0x02` Review, `0x03` Ping, `0x04` Pong).
- **Error Codes:** Common error code taxonomies.
- **Review Schema:** Types for comment anchors (Yjs relative position + W3C quote snapshots), suggestions, and tasks.
