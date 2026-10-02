# Phase 1 Execution Backlog: MVP Core, Local Engine & Harness Benchmarking

**Status:** Completed  
**Lifecycle:** Ephemeral Backlog under `docs/backlog/`  
**Master Specifications:** [docs/specs/index.md](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/docs/specs/index.md)  
**Roadmap Source:** [docs/product/roadmap.md#phase-1-mvp-core-local-engine--harness-benchmarking](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/docs/product/roadmap.md#phase-1-mvp-core-local-engine--harness-benchmarking)  

---

## Workstream Decomposition & Dependency Graph

```mermaid
flowchart TD
    subgraph StreamA["Stream A: Extension Shell & Ingestion"]
        T1["Task 1: Toolchain Scaffolding & Manifest V3"]
        T2["Task 2: Context Harvester & Right-Click 'SimIt' Menu"]
        T1 --> T2
    end

    subgraph StreamB["Stream B: Sandboxed Runtime & Validation"]
        T3["Task 3: Sandboxed Execution Iframe (sandbox.html)"]
        T5["Task 5: Offscreen Pre-Flight Harness & 1-Shot Self-Repair"]
        T3 --> T5
    end

    subgraph StreamC["Stream C: Model Engines & BYOK"]
        T4["Task 4: Default Local Prompt API (Gemini Nano)"]
        T7["Task 7: BYOK Provider Engine & Settings UI"]
        T4 --> T7
    end

    subgraph StreamD["Stream D: Telemetry & Standalone Export"]
        T6["Task 6: ATIF Trajectory Logger & Standalone HTML Exporter"]
    end

    T1 --> T3
    T2 --> T4
    T4 --> T5
    T5 --> T6
    T7 --> T6
```

---

## Phase 1 Execution Checklist

### Step 1: Manifest V3 Extension Shell & Side Panel
- [x] Initialize extension project scaffolding (WXT / Vite toolchain) with TypeScript and Manifest V3.
- [x] Configure `manifest.json` with permissions (`sidePanel`, `contextMenus`, `activeTab`, `scripting`, `offscreen`, `storage`) conforming to [docs/specs/architecture.md#1-high-level-architecture-overview](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/docs/specs/architecture.md#1-high-level-architecture-overview).
- [x] Implement background Service Worker lifecycle listener establishing Side Panel routing via `chrome.sidePanel.setPanelBehavior`.
- [x] Scaffold `sidepanel.html` frame with header, status pill, simulation container, and parameter controls dock conforming to [docs/specs/architecture.md#side-panel-ui-host](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/docs/specs/architecture.md).

### Step 2: Right-Click "SimIt" Menu & Context Harvester
- [x] Register context menu item titled **"SimIt"** for selection contexts (`contexts: ["selection"]`) in background Service Worker conforming to [docs/specs/context_harvester.md#31-typescript-domain-models](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/docs/specs/context_harvester.md#31-typescript-domain-models).
- [x] Implement `content-script.ts` selection harvester with LaTeX regex parsing conforming to [docs/specs/context_harvester.md#32-math-extraction-delimiters--selectors](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/docs/specs/context_harvester.md#32-math-extraction-delimiters--selectors).
- [x] Implement KaTeX, MathJax, and MathML DOM annotation extractors conforming to [docs/specs/context_harvester.md#32-math-extraction-delimiters--selectors](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/docs/specs/context_harvester.md#32-math-extraction-delimiters--selectors).
- [x] Implement DOM hierarchy traverser for section headings (`h1`–`h4`) and figure captions conforming to [docs/specs/context_harvester.md#4-domain-invariants--edge-cases](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/docs/specs/context_harvester.md#4-domain-invariants--edge-cases).
- [x] Add 2,000-character payload sanitization and budget limiter conforming to invariant in [docs/specs/context_harvester.md#4-domain-invariants--edge-cases](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/docs/specs/context_harvester.md#4-domain-invariants--edge-cases).

### Step 3: Sandboxed Execution Iframe
- [x] Scaffold `sandbox.html` declared under `manifest.json` `sandbox.pages` conforming to [docs/specs/sandbox_ipc.md#32-manifest-v3-sandbox-declaration](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/docs/specs/sandbox_ipc.md#32-manifest-v3-sandbox-declaration).
- [x] Bundle local offline dependencies (`d3.v7.min.js`, `anime.v3.min.js`, `katex.min.js`) into extension sandbox bundle conforming to [docs/specs/agent_loop.md#3-sandboxed-runtime-api--environment-contract](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/docs/specs/agent_loop.md#3-sandboxed-runtime-api--environment-contract).
- [x] Implement bidirectional `postMessage` protocol handler in `sandbox.html` conforming to message schemas in [`src/types/ipc.ts`](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/src/types/ipc.ts) and [docs/specs/sandbox_ipc.md#31-typescript-domain-models](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/docs/specs/sandbox_ipc.md#31-typescript-domain-models).
- [x] Implement dynamic parameter UI renderer (sliders, toggles, steppers) inside `sidepanel.html` that sends updates into the iframe conforming to [`src/types/simulation.ts`](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/src/types/simulation.ts).

### Step 4: Default Local Simulation Engine (Gemini Nano / Local Gemma)
- [x] Implement Chrome Prompt API adapter (`ai.languageModel`) in background worker conforming to [`IModelProvider`](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/src/types/models.ts) and [docs/specs/model_providers.md#31-typescript-domain-models](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/docs/specs/model_providers.md#31-typescript-domain-models).
- [x] Implement system prompt builder assembling sandbox contracts and harvested context conforming to [docs/specs/agent_loop.md#5-concrete-system-prompt-specification](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/docs/specs/agent_loop.md#5-concrete-system-prompt-specification).
- [x] Implement output code fence sanitizer stripping markdown wrappers conforming to [docs/specs/model_providers.md#4-domain-invariants--edge-cases](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/docs/specs/model_providers.md#4-domain-invariants--edge-cases).
- [x] Add Gemini Nano availability detector with fallback routing to BYOK setup conforming to [docs/specs/model_providers.md#4-domain-invariants--edge-cases](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/docs/specs/model_providers.md#4-domain-invariants--edge-cases).

### Step 5: Pre-Flight Self-Repair & Runtime Error Recovery
- [x] Implement headless offscreen document (`offscreen.html`) with 100ms smoke test runner conforming to [docs/specs/sandbox_ipc.md#2-domain-model--ipc-topology](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/docs/specs/sandbox_ipc.md#2-domain-model--ipc-topology).
- [x] Wire 1-shot silent pre-flight repair loop in background worker conforming to sequence in [docs/specs/agent_loop.md#6-pre-flight-verification--automatic-1-shot-self-correction](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/docs/specs/agent_loop.md#6-pre-flight-verification--automatic-1-shot-self-correction).
- [x] Implement runtime console error interception (`window.onerror`, `unhandledrejection`) in `sandbox.html` conforming to [docs/specs/agent_loop.md#71-runtime-error-interception-in-sandboxhtml](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/docs/specs/agent_loop.md#71-runtime-error-interception-in-sandboxhtml).
- [x] Implement auto-appearing 🛠️ Repair Icon in Side Panel header that captures active slider state and triggers interactive repair conforming to [docs/specs/agent_loop.md#72-the-auto-appearing-repair-icon-ux-flow](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/docs/specs/agent_loop.md#72-the-auto-appearing-repair-icon-ux-flow).

### Step 6: Simulation Export & ATIF Trajectory Tracking
- [x] Implement standalone HTML exporter bundling inlined CSS, KaTeX, D3, Anime, and simulation module conforming to [docs/specs/atif_specification.md#31-standalone-self-contained-html-sim-exporthtml](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/docs/specs/atif_specification.md#31-standalone-self-contained-html-sim-exporthtml).
- [x] Implement ATIF session trajectory recorder tracking harvest, prompt, inference, pre-flight, and repair steps conforming to schema in [`src/types/atif.ts`](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/src/types/atif.ts) and [docs/specs/atif_specification.md#2-atif-trajectory-schema-for-simit](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/docs/specs/atif_specification.md#2-atif-trajectory-schema-for-simit).
- [x] Add 1-click **"Export Simulation (HTML)"** and **"Download ATIF (.atif.json)"** buttons in Side Panel header conforming to [docs/specs/atif_specification.md#4-atif-trajectory-export-in-the-ui](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/docs/specs/atif_specification.md#4-atif-trajectory-export-in-the-ui).

### Step 7: BYOK (Bring Your Own Key) Provider Settings
- [x] Build Provider Settings modal / panel in `sidepanel.html` conforming to schema in [docs/specs/model_providers.md#32-chrome-storage-schema-simit_byok_settings](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/docs/specs/model_providers.md#32-chrome-storage-schema-simit_byok_settings).
- [x] Implement Anthropic Claude client provider (`claude-3-5-sonnet`) conforming to [`IModelProvider`](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/src/types/models.ts).
- [x] Implement Google Gemini Cloud client provider (`gemini-2.5-flash`) conforming to [`IModelProvider`](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/src/types/models.ts).
- [x] Implement OpenAI-compatible client provider (Ollama / custom base URL) conforming to [`IModelProvider`](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/src/types/models.ts).
- [x] Implement secure `chrome.storage.local` persistence and connection test verification for configured API keys conforming to [docs/specs/model_providers.md#4-domain-invariants--edge-cases](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/docs/specs/model_providers.md#4-domain-invariants--edge-cases).

