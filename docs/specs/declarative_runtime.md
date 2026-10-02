# Technical Specification: Declarative Runtime Stack & Parametric Engine

**Status:** Approved & Living Specification  
**Domain:** Sandboxed Runtime Environment & Declarative Libraries  
**Living Document:** Permanent architectural specification under `docs/specs/`  
**Tracking Backlog:** [docs/backlog/tasks.md](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/docs/backlog/tasks.md)  
**Executable Test Suite:** [tests/declarative_runtime.test.ts](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/tests/declarative_runtime.test.ts)

---

## 1. Overview & Business Objectives

Prompting language models to invent bespoke HTML sliders, input tags, coordinate calculations, and event handlers causes frequent runtime crashes, layout clipping, and degraded visual fidelity.

The **Declarative Runtime Stack** provides a standardized, pre-loaded suite of declarative visualization and control libraries inside the sandboxed iframe (`sandbox.html`) and standalone exports:
1. **Tweakpane (v4.x)**: Automatically generates sleek, compact parameter control docks from declarative parameter definitions; routes slider adjustments with **0ms LLM latency**.
2. **functionPlot (v1.x)**: Provides instant Cartesian coordinate systems, function curves, derivative vectors, and secant lines without manual SVG math.
3. **Cytoscape (v3.x)**: Renders declarative directed acyclic graphs (DAGs), state machines, and network topologies with interactive node inspection.
4. **Anime.js (v3.x)**: Delivers timeline tweening, state scrubbers, and physics transitions.
5. **KaTeX (v0.16.x)**: Provides sub-millisecond in-browser LaTeX mathematical notation typesetting.
6. **D3.js (v7.x pinned)**: Provides scales, projections, and mathematical interpolators pinned to v7.

---

## 2. Runtime Architecture & Library Topology

```mermaid
flowchart TB
    subgraph SandboxIframe["Sandboxed Runtime Context (sandbox.html)"]
        direction TB
        GlobalScope["Pre-Loaded Global Window APIs<br/>(Tweakpane, functionPlot, cytoscape, anime, katex, d3)"]
        
        subgraph SimEngine["SimEngine Execution Environment"]
            Init["simModule.init(container, params)"]
            Update["simModule.update(params)"]
            Destroy["simModule.destroy()"]
        end
        
        subgraph VisualDocks["Render Targets inside #sim-root"]
            TPDock["Tweakpane Control Dock (#pane-dock)<br/>Reactive sliders, toggles, steppers"]
            PlotCanvas["functionPlot Target / Canvas / SVG<br/>Cartesian curves & continuous dynamics"]
            CyTarget["Cytoscape Container (#cy-root)<br/>DAGs & state machine graphs"]
            MathBanner["KaTeX Annotation Layer<br/>Rendered LaTeX formulas"]
        end
        
        GlobalScope --> SimEngine
        SimEngine --> VisualDocks
        TPDock -->|"Zero-Latency Event: updateParams() (0ms)"| Update
    end
```

---

## 3. Contracts & Data Models

TypeScript domain contracts are authored in [`src/types/simulation.ts`](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/src/types/simulation.ts):
- [`SimModule`](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/src/types/simulation.ts): Core interface defining simulation lifecycle (`init`, `update`, `step`, `destroy`).
- [`ParameterDefinition`](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/src/types/simulation.ts): Strongly typed union of slider, toggle, stepper, and select definitions.
- [`TweakpaneBindingConfig`](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/src/types/simulation.ts): Configuration options for auto-generated parameter pane.
- [`FunctionPlotOptions`](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/src/types/simulation.ts): Coordinate domain, curve data, and grid bindings.
- [`CytoscapeLayoutOptions`](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/src/types/simulation.ts): Layout configuration (`dagre`, `cose`, `breadthfirst`).

### 3.1 Global Sandbox Window Contract

The sandbox environment guarantees the availability of global library namespaces on `window`:
- `window.Tweakpane.Pane` / `new Pane()`
- `window.functionPlot({ target, width, height, data, xAxis, yAxis })`
- `window.cytoscape({ container, elements, style, layout })`
- `window.anime({ targets, ... })`
- `window.katex.render(latexString, htmlElement, { displayMode, throwOnError: false })`
- `window.d3` (D3 v7 API: scales, interpolators, axes)

---

## 4. Domain Invariants & Edge Cases

1. **Zero-Latency Reactive Tweaks**: Adjusting a parameter slider in Tweakpane triggers `simModule.update(params)` directly inside the sandbox frame. No background service worker messages, no network round-trips, and zero LLM calls occur.
2. **Deterministic Cleanup on Hot-Reload**: Before a new module or version is evaluated, the runtime executes `simModule.destroy()`, disposes active Tweakpane panes (`pane.dispose()`), cancels pending `requestAnimationFrame` IDs, and clears `#sim-root`.
3. **Viewport Dimension Compliance**: Visual containers respect injected bounds (e.g. `width: 380px, height: 450px`). `functionPlot` and `cytoscape` instances scale to container dimensions without triggering window horizontal or vertical scrollbars.
4. **Defensive Math Guard**: Curves plotted via `functionPlot` handle domain singularities (e.g. division by zero, $\log(\le 0)$, $\sqrt{< 0}$) safely without unhandled JavaScript exceptions.

---

## 5. Behavioral Acceptance Matrix

| ID | Scenario | Given / State | When / Input | Expected Output | Latency Target | Test Target |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **D1** | Tweakpane Auto-Docking | Module exports 2 sliders + 1 toggle | `init()` invoked | Mounts Tweakpane controls in dock | $< 50\text{ ms}$ | `tests/declarative_runtime.test.ts` |
| **D2** | Zero-Latency Parametric Update | User adjusts slider $\tau$ from 1.0 to 2.5 | Tweakpane `change` event fires | `update({ tau: 2.5 })` executes synchronously | $0\text{ ms}$ LLM overhead | `tests/declarative_runtime.test.ts` |
| **D3** | functionPlot Curve Rendering | Module specifies $f(x) = \frac{1}{1 + e^{-x}}$ | `functionPlot()` called | Canvas/SVG elements rendered in `#sim-root` | $< 60\text{ ms}$ | `tests/declarative_runtime.test.ts` |
| **D4** | Cytoscape Graph Topology | Module specifies DAG with 5 nodes and 4 edges | `cytoscape()` called with `dagre` layout | Graph rendered with interactive node taps | $< 80\text{ ms}$ | `tests/declarative_runtime.test.ts` |
| **D5** | KaTeX Mathematical Typesetting | Formula $\sigma(z) = \frac{1}{1 + e^{-z}}$ | `katex.render()` executed | Math rendered into DOM without error | $< 15\text{ ms}$ | `tests/declarative_runtime.test.ts` |
| **D6** | Module Teardown & Resource Disposal | Active simulation running with Tweakpane pane | Module destroy triggered | `pane.dispose()` called, canvas and timers cleared | $< 20\text{ ms}$ | `tests/declarative_runtime.test.ts` |
