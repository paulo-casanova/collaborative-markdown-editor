# Third-Party Dependencies and Licenses

This document provides a comprehensive inventory of all third-party software libraries, frameworks, tools, and native bindings utilized by the **Collaborative Markdown Editor (CME)** across both the C++23 backend and the React/TypeScript frontend.

---

## 1. Licensing Philosophy & Summary

CME is distributed under the **MIT License**. All direct dependencies are strictly vetted to adhere to permissive, commercially friendly open-source licenses:
* **MIT License** (Primary standard for frontend components, parsers, and utility libraries)
* **Apache License 2.0** (uWebSockets, uSockets, TypeScript, Playwright)
* **BSD 3-Clause License** (libpqxx, Vega, Highlight.js)
* **ISC License** (Lucide icons, YAML parser)
* **PostgreSQL License** (libpq client driver — permissive BSD-style)
* **zlib License** (Zlib compression)

No copyleft licenses (e.g., GPL, AGPL) are statically linked or bundled into CME runtime distributions.

---

## 2. Backend Dependencies (C++23)

The CME server daemon (`cme-server`), migration runner (`cme-migrate`), and admin CLI (`cme-admin`) rely on high-performance C and C++ libraries managed via CMake (`FetchContent` and system packages):

| Library | Version / Git Tag | License | Upstream Repository | Purpose in CME |
| :--- | :--- | :--- | :--- | :--- |
| **uWebSockets** | `v20.x` (`38cf9d8`) | **Apache-2.0** | [uNetworking/uWebSockets](https://github.com/uNetworking/uWebSockets) | Core non-blocking HTTP and WebSocket networking server engine. |
| **uSockets** | `86097c4` | **Apache-2.0** | [uNetworking/uSockets](https://github.com/uNetworking/uSockets) | Cross-platform eventing, epoll/kqueue event loop, and TLS transport foundation for uWebSockets. |
| **y-crdt (`yrs` / `yffi`)** | `v0.28.0` | **MIT** | [y-crdt/y-crdt](https://github.com/y-crdt/y-crdt) | High-performance native Rust CRDT library via C-FFI; powers in-memory real-time Yjs document rooms. |
| **libpqxx** | `7.10.7` | **BSD-3-Clause** | [jtv/libpqxx](https://github.com/jtv/libpqxx) | Official C++ client driver for PostgreSQL, supporting parameterized transactions and RAII connections. |
| **PostgreSQL (`libpq`)** | `14+` | **PostgreSQL** | [PostgreSQL Global Development Group](https://www.postgresql.org/) | Underlying PostgreSQL C client library and socket communications. |
| **nlohmann_json** | `v3.11.3` | **MIT** | [nlohmann/json](https://github.com/nlohmann/json) | Header-only JSON parser and serializer for REST endpoints, WebSocket envelopes, and metadata. |
| **yaml-cpp** | `0.8.0` | **MIT** | [jbeder/yaml-cpp](https://github.com/jbeder/yaml-cpp) | YAML parser for document frontmatter properties and configuration file ingestion. |
| **md4c** | `release-0.5.2` | **MIT** | [mity/md4c](https://github.com/mity/md4c) | Fast, compliant CommonMark / Markdown parser with SAX-style callback architecture. |
| **OpenSSL** | `3.0+` | **Apache-2.0** | [OpenSSL Project](https://www.openssl.org/) | Cryptographic primitives, SHA-256 fingerprinting, PBKDF2/Argon2 hashing, TLS/HTTPS, and WSS. |
| **ZLIB** | `1.2+` | **zlib** | [Jean-loup Gailly & Mark Adler](https://zlib.net/) | Compression library for WebSocket permessage-deflate and bundle archives. |
| **libcrypt / libxcrypt** | System standard | **LGPL-2.1+ / BSD-2-Clause** | [besser82/libxcrypt](https://github.com/besser82/libxcrypt) | Standard POSIX crypt/password hashing verification utilities. |

---

## 3. Frontend Production Dependencies (React & TypeScript)

The CME client-side single-page application (`cme-frontend`) uses modern web libraries bundled via Vite:

| Package | Version | License | Upstream Source | Purpose in CME |
| :--- | :--- | :--- | :--- | :--- |
| **`react`** | `^18.3.1` | **MIT** | [facebook/react](https://github.com/facebook/react) | Core UI component rendering framework. |
| **`react-dom`** | `^18.3.1` | **MIT** | [facebook/react](https://github.com/facebook/react) | DOM renderer for React components. |
| **`react-router-dom`** | `^6.26.2` | **MIT** | [remix-run/react-router](https://github.com/remix-run/react-router) | Client-side routing, URL state management, and parameter resolution. |
| **`codemirror`** | `^6.0.2` | **MIT** | [codemirror/dev](https://github.com/codemirror/dev) | Next-generation extensible code editor core for Markdown editing. |
| **`@codemirror/lang-markdown`** | `^6.5.2` | **MIT** | [codemirror/lang-markdown](https://github.com/codemirror/lang-markdown) | Markdown grammar, syntax extensions, and tokenizer for CodeMirror. |
| **`@lezer/markdown`** | `^1.8.0` | **MIT** | [lezer-parser/markdown](https://github.com/lezer-parser/markdown) | Incremental syntax tree parser used for Live Preview widgets. |
| **`@lezer/highlight`** | `^1.2.5` | **MIT** | [lezer-parser/highlight](https://github.com/lezer-parser/highlight) | Highlighting system for syntax tokens in CodeMirror editor buffers. |
| **`yjs`** | `^13.6.33` | **MIT** | [yjs/yjs](https://github.com/yjs/yjs) | JavaScript CRDT shared types engine for real-time collaborative text synchronization. |
| **`y-codemirror.next`** | `^0.3.6` | **MIT** | [yjs/y-codemirror.next](https://github.com/yjs/y-codemirror.next) | Real-time Yjs CRDT binding for CodeMirror 6 with awareness cursors. |
| **`y-protocols`** | `^1.0.7` | **MIT** | [yjs/y-protocols](https://github.com/yjs/y-protocols) | Binary sync, auth, and awareness protocols for Yjs client-server handshakes. |
| **`@tanstack/react-query`** | `^5.56.2` | **MIT** | [TanStack/query](https://github.com/TanStack/query) | Server-state management, caching, background polling, and mutation hooks. |
| **`zustand`** | `^4.5.5` | **MIT** | [pmndrs/zustand](https://github.com/pmndrs/zustand) | Lightweight client state management for UI tabs, theme, drawer toggles, and sidebars. |
| **`lucide-react`** | `^0.441.0` | **ISC** | [lucide-icons/lucide](https://github.com/lucide-icons/lucide) | Clean, scalable icon system across the editor, navigation, and reader headers. |
| **`mermaid`** | `^12.1.0` | **MIT** | [mermaid-js/mermaid](https://github.com/mermaid-js/mermaid) | Client-side diagram generator for flowcharts, sequence diagrams, state machines, and class models. |
| **`vega`** | `^6.4.0` | **BSD-3-Clause** | [vega/vega](https://github.com/vega/vega) | Declarative visualization grammar engine used for interactive Gantt charts. |
| **`vega-embed`** | `^7.3.0` | **BSD-3-Clause** | [vega/vega-embed](https://github.com/vega/vega-embed) | Embedder and canvas/SVG renderer for Vega visualization specifications. |
| **`katex`** | `^0.19.0` | **MIT** | [KaTeX/KaTeX](https://github.com/KaTeX/KaTeX) | High-speed mathematical typography engine for LaTeX inline and display math. |
| **`highlight.js`** | `^11.12.0` | **BSD-3-Clause** | [highlightjs/highlight.js](https://github.com/highlightjs/highlight.js) | Syntax highlighting for code blocks in Reader Mode and exported views. |
| **`yaml`** | `^2.9.1` | **ISC** | [eemeli/yaml](https://github.com/eemeli/yaml) | YAML parsing for frontmatter metadata and Gantt chart specifications. |
| **`clsx`** | `^2.1.1` | **MIT** | [lukeed/clsx](https://github.com/lukeed/clsx) | Utility for constructing conditional CSS class strings. |
| **`tailwind-merge`** | `^2.5.2` | **MIT** | [dcastil/tailwind-merge](https://github.com/dcastil/tailwind-merge) | Utility to merge Tailwind CSS class names efficiently without selector conflicts. |
| **`@tiptap/react`** | `^3.31.4` | **MIT** | [ueberdosis/tiptap](https://github.com/ueberdosis/tiptap) | Headless ProseMirror wrapper for rich text editing and WYSIWYG mode. |
| **`@tiptap/pm`** | `^3.31.4` | **MIT** | [ueberdosis/tiptap](https://github.com/ueberdosis/tiptap) | ProseMirror core libraries packaged for TipTap editor components. |
| **`@tiptap/starter-kit`** | `^3.31.4` | **MIT** | [ueberdosis/tiptap](https://github.com/ueberdosis/tiptap) | Standard formatting nodes and marks (bold, italic, strike, lists, code blocks). |
| **`@tiptap/extension-collaboration`** | `^3.31.4` | **MIT** | [ueberdosis/tiptap](https://github.com/ueberdosis/tiptap) | Real-time multi-user document collaboration extension for TipTap. |
| **`@tiptap/extension-collaboration-cursor`** | `^3.0.0` | **MIT** | [ueberdosis/tiptap](https://github.com/ueberdosis/tiptap) | Live peer selection and presence cursor extension for TipTap. |
| **`@tiptap/extension-table`** | `^3.31.4` | **MIT** | [ueberdosis/tiptap](https://github.com/ueberdosis/tiptap) | Interactive table structure and cell manipulation extension. |
| **`@tiptap/extension-table-row`** | `^3.31.4` | **MIT** | [ueberdosis/tiptap](https://github.com/ueberdosis/tiptap) | Table row node definition for TipTap. |
| **`@tiptap/extension-table-header`** | `^3.31.4` | **MIT** | [ueberdosis/tiptap](https://github.com/ueberdosis/tiptap) | Table header cell node definition for TipTap. |
| **`@tiptap/extension-table-cell`** | `^3.31.4` | **MIT** | [ueberdosis/tiptap](https://github.com/ueberdosis/tiptap) | Standard table cell node definition for TipTap. |
| **`@tiptap/extension-task-list`** | `^3.31.4` | **MIT** | [ueberdosis/tiptap](https://github.com/ueberdosis/tiptap) | Task list container node for interactive checklists. |
| **`@tiptap/extension-task-item`** | `^3.31.4` | **MIT** | [ueberdosis/tiptap](https://github.com/ueberdosis/tiptap) | Checklist item node with interactive checkbox status. |
| **`@tiptap/extension-placeholder`** | `^3.31.4` | **MIT** | [ueberdosis/tiptap](https://github.com/ueberdosis/tiptap) | Context-aware placeholder text for empty documents or headings. |
| **`@types/katex`** | `^0.16.8` | **MIT** | [DefinitelyTyped](https://github.com/DefinitelyTyped/DefinitelyTyped) | TypeScript type declarations for KaTeX math library. |

---

## 4. Frontend Build & Development Tooling

These packages are utilized strictly during build-time compilation, bundling, and automated testing; they are not bundled into client production assets:

| Package | Version | License | Upstream Source | Purpose |
| :--- | :--- | :--- | :--- | :--- |
| **`typescript`** | `^5.5.4` | **Apache-2.0** | [microsoft/TypeScript](https://github.com/microsoft/TypeScript) | Strict static type checking and modern ECMAScript compilation. |
| **`vite`** | `^5.4.3` | **MIT** | [vitejs/vite](https://github.com/vitejs/vite) | Next-generation frontend bundler, HMR development server, and Rollup minifier. |
| **`@vitejs/plugin-react`** | `^4.3.1` | **MIT** | [vitejs/vite-plugin-react](https://github.com/vitejs/vite-plugin-react) | Fast React JSX/TSX transforms with Fast Refresh support. |
| **`vitest`** | `^2.1.9` | **MIT** | [vitest-dev/vitest](https://github.com/vitest-dev/vitest) | High-speed unit and component test runner powered by Vite. |
| **`@playwright/test`** | `^1.64.0` | **Apache-2.0** | [microsoft/playwright](https://github.com/microsoft/playwright) | End-to-end browser automation framework for multi-user integration tests. |
| **`tailwindcss`** | `^3.4.11` | **MIT** | [tailwindlabs/tailwindcss](https://github.com/tailwindlabs/tailwindcss) | Utility-first CSS framework for theme tokens, layout, and dark mode. |
| **`postcss`** | `^8.4.45` | **MIT** | [postcss/postcss](https://github.com/postcss/postcss) | CSS transformation engine for Tailwind and vendor prefixing. |
| **`autoprefixer`** | `^10.4.20` | **MIT** | [postcss/autoprefixer](https://github.com/postcss/autoprefixer) | PostCSS plugin to parse CSS and add browser vendor prefixes automatically. |
| **`@types/node`** | `^22.5.4` | **MIT** | [DefinitelyTyped](https://github.com/DefinitelyTyped/DefinitelyTyped) | TypeScript definitions for Node.js standard libraries. |
| **`@types/react`** | `^18.3.5` | **MIT** | [DefinitelyTyped](https://github.com/DefinitelyTyped/DefinitelyTyped) | TypeScript definitions for React core. |
| **`@types/react-dom`** | `^18.3.0` | **MIT** | [DefinitelyTyped](https://github.com/DefinitelyTyped/DefinitelyTyped) | TypeScript definitions for React DOM. |

---

## 5. License Attribution Notices

For legal compliance, binary distributions of CME should include copies of the respective copyright notices and permission notices as provided by each upstream project. Full license texts for each dependency can be found in their respective upstream source repositories linked above or in the `node_modules/*/LICENSE` files of the frontend workspace.
