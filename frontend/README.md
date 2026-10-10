# CME Frontend (React + Vite)

The frontend is a single-page application (SPA) built with React 18+, TypeScript, Vite, TipTap/ProseMirror, and Tailwind CSS.

## Architecture

- **Editor Engine:** TipTap / ProseMirror with custom NodeViews for math (KaTeX), code highlighting, diagrams (Mermaid), and wiki-links (`[[...]]`).
- **Real-Time Collaboration:** Yjs via WebSocket (`/ws/collab/{document_id}`) with awareness presence tracking.
- **State Management:** TanStack Query for server state; Zustand for UI state.
- **Reading Mode:** Dedicated `DocReader` route for clean documentation reading with Table of Contents and Review Overlay toggles.

Implementation will begin in **Phase 4**.
