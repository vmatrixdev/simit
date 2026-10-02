# Technical Specification: Sandboxed Runtime & IPC Protocol

**Status:** Approved & Living Specification  
**Domain:** Sandboxed Iframe, Offscreen Document, & IPC Protocol  
**Living Document:** Permanent architectural specification under `docs/specs/`  
**Tracking Backlog:** [docs/backlog/tasks.md](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/docs/backlog/tasks.md)  

---

## 1. Overview & Business Objectives
Under Chrome Extension **Manifest V3**, executing dynamically generated code inside an extension page violates Chrome Content Security Policy (CSP). SimIt addresses this through a strict two-tier sandboxed execution architecture:
1. **Headless Offscreen Document (`offscreen.html`)**: Conducts automated pre-flight verification (100ms smoke test in a hidden iframe) before presenting code to the user.
2. **Interactive Sandboxed Iframe (`sandbox.html`)**: Hosted inside `sidepanel.html` under `"sandbox": { "pages": ["sandbox.html"] }` with `allow-scripts`. Bundles declarative runtime libraries (`Tweakpane v4`, `functionPlot v1`, `cytoscape v3`, `anime.js v3`, `d3 v7`, `katex v0.16`), rendering 60 FPS simulations with zero manual HTML controls.

---

## 2. Domain Model & IPC Topology

```mermaid
sequenceDiagram
    autonumber
    participant SW as Background Service Worker
    participant Offscreen as Offscreen Pre-Flight Harness
    participant Host as Side Panel Host (sidepanel.html)
    participant Sandbox as Sandboxed Iframe (sandbox.html)

    Note over SW,Offscreen: Tier 1: Headless Pre-Flight Verification
    SW->>Offscreen: PREFLIGHT_TEST_REQUEST (code, timeout: 100ms, viewport: {width: 380, height: 450})
    Offscreen->>Offscreen: Evaluate init() + update(defaults)
    alt Error Detected
        Offscreen-->>SW: PREFLIGHT_TEST_RESPONSE (status: 'error', stack)
    else Success
        Offscreen-->>SW: PREFLIGHT_TEST_RESPONSE (status: 'ok', parameters)
    end

    Note over SW,Sandbox: Tier 2: Interactive Sandbox Rendering
    SW->>Host: chrome.runtime.sendMessage(SIMULATION_READY)
    Host->>Sandbox: iframe.contentWindow.postMessage(SANDBOX_INIT_SIMULATION, { code, viewport })
    Sandbox->>Sandbox: Mount #sim-root, init Tweakpane & Declarative Libraries
    Sandbox-->>Host: window.parent.postMessage(SANDBOX_SIMULATION_READY)

    Note over Host,Sandbox: Zero-Latency Parametric Updates
    Host->>Sandbox: postMessage(SANDBOX_UPDATE_PARAMETERS, params)
    Sandbox->>Sandbox: Execute Tweakpane.updateParams() -> sim.update(params) (0ms LLM overhead)
    
    alt Runtime Exception in Sandbox
        Sandbox-->>Host: postMessage(SANDBOX_RUNTIME_ERROR, error, currentParams)
        Host-->>Host: Reveal Auto-Appearing Repair Icon (🛠️)
    end
```

---

## 3. Contracts & Data Models

### 3.1 TypeScript Domain Models
The domain contracts are authored in [`src/types/ipc.ts`](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/src/types/ipc.ts):
- [`PreFlightTestRequest`](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/src/types/ipc.ts): Payload dispatched to offscreen document with module code and viewport dimensions.
- [`PreFlightTestResponse`](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/src/types/ipc.ts): Result payload (`'ok' | 'error'`) with error stack or verified parameters.
- [`HostToSandboxMessage`](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/src/types/ipc.ts): Messages sent into sandbox (`SANDBOX_INIT_SIMULATION`, `SANDBOX_UPDATE_PARAMETERS`, `SANDBOX_RESTORE_VERSION`, `SANDBOX_DESTROY`).
- [`SandboxToHostMessage`](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/src/types/ipc.ts): Messages emitted by sandbox (`SANDBOX_SIMULATION_READY`, `SANDBOX_RUNTIME_ERROR`).

### 3.2 Manifest V3 Sandbox Declaration & Pre-Loaded Stack
Configured in `manifest.json`:
```json
{
  "sandbox": {
    "pages": ["sandbox.html"]
  },
  "content_security_policy": {
    "sandbox": "sandbox allow-scripts; default-src 'none'; style-src 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob:;"
  }
}
```

Pre-loaded global scripts inside `sandbox.html`:
- `tweakpane.min.js` (`window.Tweakpane` / `Pane`)
- `function-plot.js` (`window.functionPlot`)
- `cytoscape.min.js` (`window.cytoscape`)
- `anime.min.js` (`window.anime`)
- `katex.min.js` (`window.katex`)
- `d3.v7.min.js` (`window.d3`)

---

## 4. Domain Invariants & Edge Cases

1. **Zero-Latency Parameter Tweaks**: When a user drags a slider in Tweakpane or inputs a numeric value, updates route directly to `Tweakpane.updateParams()` and the module `update(params)` callback. No background service worker round-trip or LLM call is triggered.
2. **Infinite Loop Protection**: Pre-flight test executes with a **100ms** hard timeout via `Promise.race([moduleExecution, timeoutPromise])`. If the timeout fires, the module is rejected with `TimeoutError: Execution exceeded 100ms limit`.
3. **Container Isolation & Viewport Compliance**: The simulation writes only inside `<div id="sim-root"></div>` respecting injected pixel bounds (e.g., `width: 380px, height: 450px`). Access to `window.top` or `document.cookie` is blocked by iframe sandbox restrictions.
4. **State Preservation on Hot-Reload / Version Revert**: When a runtime error is repaired or a prior version is restored from IndexedDB, `sidepanel.html` passes the active `currentParams` to `SANDBOX_INIT_SIMULATION` so parameter positions remain preserved.

---

## 5. Behavioral Acceptance Matrix

| ID | Scenario | Given / State | When / Input | Expected Output | IPC Target |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **I1** | Clean Pre-Flight Test | Valid simulation ES module | Offscreen receives `PREFLIGHT_TEST_REQUEST` | Returns `status: 'ok'` with extracted parameters list | Service Worker |
| **I2** | Pre-Flight Syntax Error | Code with invalid JS syntax | Offscreen attempts to evaluate | Returns `status: 'error'` with exact line and syntax message | Service Worker |
| **I3** | Infinite Loop Guard | Code contains `while(true){}` | Offscreen evaluates module | Times out after 100ms; returns `TimeoutError` | Service Worker |
| **I4** | Zero-Latency Slider Update | User drags Tweakpane slider | Tweakpane event fires | `update(params)` called directly with 0ms LLM latency | `sandbox.html` |
| **I5** | Runtime Error Intercept | Division by zero during update | Sandbox executes `update()` throwing error | Emits `SANDBOX_RUNTIME_ERROR` with stack and slider state | Side Panel Host |
| **I6** | Version State Revert | User selects `v1` in session stack | Side Panel dispatches `SANDBOX_RESTORE_VERSION` | Re-mounts `v1` module and restores `v1` parameter snapshot | `sandbox.html` |

