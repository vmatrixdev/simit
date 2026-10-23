# Technical Specification: Agent Loop, Reasoning Decoupling & Viewport Injection

**Status:** Approved & Living Specification  
**Domain:** Code Generation, Reasoning Decoupling & Dynamic Viewport Injection  
**Living Document:** Permanent architectural specification under `docs/specs/`  
**Tracking Backlog:** [docs/backlog/tasks.md](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/docs/backlog/tasks.md)  
**Executable Test Suite:** [tests/integration.test.ts](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/tests/integration.test.ts)

---

## 1. Domain Models & Contracts

Domain contracts are authored in TypeScript under [`src/types/`](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/src/types/):
- [`HarvestedContext`](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/src/types/harvester.ts): Harvested snippet, nearby math, and measured viewport bounds.
- [`GenerationPromptPayload`](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/src/types/models.ts): System instructions, context, dynamic viewport, and chat turns.
- [`SimModule`](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/src/types/simulation.ts): Target executable ES module contract with `init`, `update`, and parameter schema.
- [`ArchetypeTriageResult`](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/src/types/archetype.ts): Triage outcome routing to direct simulation or structured fallbacks.

---

## 1. The Autonomous Agent Loop

The agent loop orchestrates code generation, offscreen smoke testing, automated error diagnosis, and reactive rendering in the sandboxed iframe, with continuous error monitoring and conversational iteration.

```mermaid
flowchart TD
    Start(["User Highlights Text & Triggers 'SimIt'"]) --> Harvest["Context Harvester<br/>• Selective bounded scope (text, math, headers)<br/>• Container Viewport: width: 380, height: 450"]
    
    Harvest --> Compose["Prompt Composer<br/>• Declarative Sandbox API Contracts<br/>• Injected Viewport Dimensions<br/>• Decoupled Reasoning Tags"]
    
    Compose --> Dispatch{"Active Model Engine"}
    Dispatch -->|"Default ($0 Cost)"| Nano["Gemini Nano / Local Gemma<br/>(Chrome Prompt API)"]
    Dispatch -->|"BYOK Configured"| BYOK["BYOK Frontier Model<br/>(Claude 3.5 Sonnet / Gemini Flash / Ollama)"]
    
    Nano --> TagParser["Tag Parser & Code Extractor<br/>• Logs <simulation_thinking> to ATIF<br/>• Extracts <simulation_code> for execution"]
    BYOK --> TagParser
    TagParser --> CodeOutput["Raw Module Code"]
    
    subgraph PreFlightHarness["Offscreen Pre-Flight Harness (Validation Sandbox)"]
        direction TB
        CodeOutput --> Load["Instantiate Module in Headless Hidden Iframe"]
        Load --> SmokeTest["100ms Smoke Test<br/>• Execute init() with injected container & defaults<br/>• Test parameter update() with boundary values"]
        SmokeTest --> Check{"Runtime Error<br/>or Exception?"}
    end

    Check -->|"Yes: Crash Detected"| AutoRepair["Auto 1-Shot Pre-Flight Repair<br/>• Capture window.onerror & stack trace<br/>• Fix and re-evaluate once silently"]
    AutoRepair --> PreFlightHarness
    
    Check -->|"No: Verification Passed"| Deliver["window.postMessage()<br/>Deliver Validated Module"]
    
    subgraph SidePanel["Chrome Side Panel Runtime (sandbox.html)"]
        direction TB
        Deliver --> MountUI["Mount Tweakpane Parameter Pane<br/>(Zero-latency reactive sliders)"]
        MountUI --> RunSim["Execute Declarative Libraries at 60 FPS<br/>• functionPlot (2D curves)<br/>• Cytoscape (DAGs & concept graphs)<br/>• Anime.js & Canvas 2D (time transitions)<br/>• KaTeX (math typesetting)"]
        RunSim --> UserInteract{"User Action"}
        
        UserInteract -->|"Parametric Tweak"| DirectUpdate["Tweakpane.updateParams()<br/>(0ms, Zero LLM Call)"]
        DirectUpdate --> RunSim
        
        UserInteract -->|"Structural Evolution"| ContextRolling["Dual-Track Evolution (Chips or Chat)<br/>• Passes Static Paper Anchor<br/>• Passes Active <simulation_code> snapshot<br/>• Slides last 2 chat turns"]
        ContextRolling --> Compose
        
        RunSim -.->|"Console Error Intercepted"| RepairBadge["Auto-Appearing Repair Icon (🛠️)<br/>'An error occurred. Click to repair'"]
    end

    RepairBadge -->|"User Clicks Repair Icon"| UserTriggeredFix["Interactive Repair Loop<br/>• Bundles active code + stack trace<br/>• Injects current slider parameters"]
    UserTriggeredFix --> PreFlightHarness
```

---

## 2. Prompting Strategy & Reasoning Decoupling

### 2.1 Ban on "Code Only" Directives
Prompting directives such as *"Return ONLY executable JavaScript without explanation"* suppress internal chain-of-thought tokens, severely degrading spatial layout calculations, mathematical equations, and phase transition logic.

### 2.2 Explicit Tag Separation
The system prompt mandates explicit structural tags:
1. `<simulation_thinking>...</simulation_thinking>`: The model writes out the mathematical formulation, coordinate systems, parameter domains, and step plans.
2. `<simulation_code>...</simulation_code>`: The model writes the complete, self-contained ES module. The parser extracts strictly the code payload for sandbox evaluation while logging the thinking trace to ATIF telemetry.

### 2.3 Native Hidden Thinking Modes
When invoking models with native reasoning capabilities (e.g., Gemini Flash Thinking, Claude Extended Thinking), server-side reasoning remains out-of-band while the returned payload delivers the `<simulation_code>` block cleanly.

---

## 3. Dynamic Viewport Measurement & Injection

Hardcoding static dimensions (e.g., `380px x 450px`) can lead to cramped visualizations or layout clipping on high-resolution displays or when the user widens their Side Panel. SimIt dynamically queries the live container bounds (`container.clientWidth` and `container.clientHeight`, with sensible min-clamps `minWidth: 320, minHeight: 380`) from the active browser window at synthesis time:

```json
{
  "viewport": {
    "width": "${container.clientWidth}",
    "height": "${container.clientHeight}"
  }
}
```

The system prompt dynamically injects these exact measured pixel bounds:
`The host container #sim-root currently has measured viewport dimensions: width: ${viewport.width}px, height: ${viewport.height}px (dynamically derived from the active browser Side Panel space). Configure your Canvas, SVG, Cytoscape, or functionPlot viewBox to fit these dimensions.`

---

## 4. Sandboxed Runtime API & Declarative Library Stack

The sandbox environment pre-loads 10 standardized declarative libraries (Tweakpane v4, math.js v12, jstat v1.9, functionPlot v1, cytoscape v3, d3 v7, anime.js v3, Canvas 2D, KaTeX v0.16, Matter.js v0.20, gl-matrix v3.4).

For complete library interfaces, capability tables, and usage patterns, see the authoritative specification:
- [docs/specs/declarative_runtime.md](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/docs/specs/declarative_runtime.md)

---

## 5. The `simEngine` Module Lifecycle Contract

The code generated by the agent adheres to SimIt's single-source module contract:
- **`init(container, params, stage)`**: Mounts visual elements using injected `StageGeometry` (`stage.width`, `stage.height`, `stage.dpr`, `stage.safeArea`).
- **`update(params)`**: Reactively receives updated parameter states without tearing down the stage.
- **`destroy()`**: Disposes timers, requestAnimationFrame handles, and listeners.
- **`explanation`**: Structured insight, symbol legend, and interactive tour steps.
- **Host-Owned Controls**: All controls are defined in `parameters` and rendered exclusively by the host controls drawer.

For complete schema contracts and stage geometry calculations, see the authoritative specification:
- [docs/specs/simulation_module_contract.md](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/docs/specs/simulation_module_contract.md)

---

## 6. Two-Tier Multi-Agent Deliberation & Verification

Code generation and verification operate via the Two-Tier Autonomous Multi-Agent Loop:
1. **Epistemic Architect**: Deliberates on pedagogical intuition, mental model, and parameter controls.
2. **Simulation Coder**: Generates the executable ES module adhering to `buildModuleContractPromptSection`.
3. **Verification Harness**: Validates the module offscreen across multiple frames with raster statistics and parameter boundary sweeps.
4. **Multimodal Review**: The Architect visually reviews rendered snapshots and triggers targeted code-patching revisions if defects are detected.

For the full multi-agent orchestration sequence and verification harness specifications, see:
- [docs/specs/autonomous_agent_architecture.md](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/docs/specs/autonomous_agent_architecture.md)
- [docs/specs/simulation_verification.md](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/docs/specs/simulation_verification.md)

For single-source module contract prompts, stage geometry, and safe-area specifications, see:
- [docs/specs/simulation_module_contract.md](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/docs/specs/simulation_module_contract.md)

### DIAGRAM ARCHETYPES & CANONICAL LIBRARY COMBINATIONS
Mapping specific diagram and simulation archetypes to standardized library stacks keeps token usage low and ensures high first-run reliability. Detailed mappings and fallbacks are defined in [docs/specs/archetype_triage.md](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/docs/specs/archetype_triage.md).

| Diagram / Simulation Archetype | Primary Rendering & Physics | Math / Data Engine | UI & Controls | Why This Combination Works |
| --- | --- | --- | --- | --- |
| **Interactive Sequence Stepper** (OAuth, TLS handshakes, Raft heartbeats, gRPC calls) | **Canvas 2D** + **Anime.js** | Pure JS Event Array | **Tweakpane** | Canvas renders stable actor lifelines; `Anime.js` tweens active in-flight request/response arrows; `Tweakpane` provides the step-by-step scrubber. |
| **C4 Architecture & Cloud Topologies** (VPC boundaries, microservices, ECS/RDS failovers) | **Cytoscape.js** (Compound Nodes) | Internal DAG Layout (`dagre`/`breadthfirst`) | **Tweakpane** | Cytoscape compound nodes model hierarchical boundaries (System $\to$ Container $\to$ Component) with built-in zoom/pan; `Tweakpane` toggles node failures or traffic rates. |
| **Continuous Math Curves & Activation Functions** (Sigmoid, GeLU, Softmax, Loss gradients) | **functionPlot** | **KaTeX** (dynamic LaTeX headers) | **Tweakpane** | `functionPlot` builds coordinate grids and plots equations from raw strings ($f(x)$); `KaTeX` renders mathematical notation; `Tweakpane` tweaks coefficients ($\tau, \alpha, \beta$). |
| **Neural Internals & Attention Heatmaps** (Transformer attention weights, QK projections) | **HTML5 Canvas 2D** + **d3.js** (scales only) | **Math.js** (matrix multiplication) | **Tweakpane** | `Math.js` calculates $QK^T / \sqrt{d_k}$ in 2 lines; `d3.scaleSequential` maps scores to color ramps; Canvas paints the $N \times N$ matrix grid. |
| **Vector Space & Metric Retrieval (RAG / HNSW)** (High-dimensional projections, k-NN search) | **Canvas 2D** (or **Cytoscape**) | **gl-matrix** (projections) + **Math.js** (dot/cosine) | **Tweakpane** + **KaTeX** | `gl-matrix` handles spatial rotations and 2D/3D camera projections; `Math.js` computes distance metrics; `KaTeX` displays dynamic readouts. |
| **Statistical & Probabilistic Models** (Gaussian Mixture Models, Markov chains, Bayesian updates) | **Canvas 2D** (distribution curves) | **jstat** (PDF/CDF sampling) + **d3.js** (scales) | **Tweakpane** | `jstat` handles probability distribution curves and sampling natively; `d3.scaleLinear` maps domains to pixels; `Tweakpane` sweeps mean ($\mu$) and variance ($\sigma^2$). |
| **Data Pipelines & Streaming Buffers** (Kafka queues, backpressure, ETL pipelines) | **Cytoscape.js** + **Anime.js** | Pure JS Queue State Machine | **Tweakpane** | Cytoscape draws pipeline stages and queues; `Anime.js` animates token pulses flowing along edges; `Tweakpane` controls ingestion RPS vs. worker latency to demonstrate backpressure. |
| **Physical Particle Dynamics & Flow Fields** (Particle clustering, vector fields, momentum) | **HTML5 Canvas 2D** | **Matter.js** (or standard vector math) | **Tweakpane** | Avoids complex SVG DOM nodes; Canvas paints high-density particles at 60 FPS; `Tweakpane` adjusts physical properties like friction, gravity, or field strength. |

### KEY ARCHITECTURAL GUIDELINES
1. **Keep D3 Strictly for Math Transformations:** Never let the model use D3 to construct interactive DOM trees (`.selectAll().join()`). Restrict it to `d3.scaleLinear`, `d3.scaleLog`, and `d3.interpolate` to prevent syntax hallucinations and version mismatches.
2. **Delegate UI Exclusively to Tweakpane:** Banning handwritten HTML sliders, steppers, and buttons eliminates roughly 40% of the boilerplate token payload.
3. **Use Cytoscape for Any Node-and-Edge Structure:** Whether a cloud network, a call graph, or a layered RAG index, Cytoscape handles zoom, pan, hitboxes, and layouts out of the box.

### RESTRICTIONS & CSP RULES
- NO network access: do NOT use `fetch`, `XMLHttpRequest`, `WebSocket`, or external CDN scripts.
- NO `eval()` or access to `window.parent` / `document.cookie`.
- Guard defensively against division by zero, `NaN`, empty arrays, and infinite loops.
- Do NOT output arbitrary moving balls or generic charts if the concept is not dynamic; use Cytoscape DAGs or interactive concept maps instead.

### OUTPUT FORMAT SPECIFICATION
The model formats output into decoupled structural tags:
1. `<simulation_thinking>...</simulation_thinking>`: Deliberation on mathematical models, coordinate spaces, and visual metaphors (logged to ATIF telemetry).
2. `<simulation_code>...</simulation_code>`: Self-contained ES module adhering to the single-source contract (extracted for pre-flight verification).

---

## 7. Context Rolling for Infinite Evolution

As a user interacts with the simulation ("tweak this", "add that", "explain this edge case"), token counts grow. To prevent context window bloat and escalating API bills without complex backend pipelines, the orchestrator employs **Rolling Context with Code Compaction**:

```
┌────────────────────────────────────────────────────────┐
│ System Instruction + Sandboxed API Contracts           │
├────────────────────────────────────────────────────────┤
│ Original Paper Snippet (Static Ground Truth Anchor)    │
├────────────────────────────────────────────────────────┤
│ Current Working Module Code (<simulation_code> v3)     │
├────────────────────────────────────────────────────────┤
│ User: "Make nodes bounce when traversed"               │
└────────────────────────────────────────────────────────┘
```

1. **System Prompt**: Defines core sandbox rules and library versions.
2. **Original Paper Anchor**: Retains the original harvested excerpt intact so the agent never drifts from ground truth.
3. **Active Working Artifact**: Passes only the single latest working code inside `<simulation_code>` as the active snapshot. Discards prior intermediate code blocks.
4. **Sliding Chat Window**: Keeps only the last 2 user/assistant conversational turns.

---

## 8. Dual-Track Evolution & Session Version Stack

### 8.1 Dual-Track Evolution
- **Pre-Computed Evolution Chips**: Auto-generated contextual action buttons (e.g., `[+ Add Temperature Scaling]`, `[Show Phase Boundary]`, `[Step-by-Step Traversal]`).
- **Refinement Chat Bar**: Freeform natural language input for direct user modifications.

### 8.2 Client-Side Session Version Stack (IndexedDB)
Every validated simulation module is snapshotted into local `IndexedDB` (`simit_sessions`):
- `v1`: Initial synthesis from text selection.
- `v2`: Evolution chip applied ("Add Temperature Scaling").
- `v3`: User chat refinement ("Highlight active node in orange").
The Side Panel UI renders a version scrubber (`v1`, `v2`, `v3`) enabling 1-click instant rollback and parameter state restoration with zero network calls.

---

## 9. Behavioral Acceptance Matrix

| ID | Scenario | Given / State | When / Input | Expected Output | Verification Target |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **R1** | Explicit Tag Separation | Model produces thinking + code | Provider parses output | `<simulation_thinking>` logged to ATIF; `<simulation_code>` isolated for pre-flight | `tests/integration.test.ts` |
| **R2** | Viewport Measurement Injection | Side Panel container is $420 \times 500\text{ px}$ | Prompt Composer builds payload | Prompt explicitly injects `width: 420px, height: 500px` | `tests/integration.test.ts` |
| **R3** | Viewport Dimension Fallback Clamp | Min bounds clamped to $320 \times 380\text{ px}$ | Harvested with $0 \times 0$ bounds | Injects default fallback `width: 380px, height: 450px` | `tests/integration.test.ts` |
| **R4** | Code-Only Directives Banned | Prompt generated for model | Inspect system instructions | System prompt contains NO "code only" directives; mandates `<simulation_thinking>` | `tests/integration.test.ts` |
| **R5** | 1-Shot Pre-Flight Self-Repair | Initial synthesis throws syntax error | Offscreen detects crash | Triggers 1-shot repair with error stack; re-evaluates | `tests/repair_and_export.test.ts` |
| **R6** | Rolling Context Window Compaction | Turn 3 refinement requested | Context compactor runs | Retains static anchor + latest $v_2$ code snapshot + last 2 chat turns | `tests/integration.test.ts` |


