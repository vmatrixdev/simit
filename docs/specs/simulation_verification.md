# Technical Specification: Simulation Verification Harness & Diagnostic Protocol

**Status:** Approved & Living Specification  
**Domain:** Sandboxed Execution, Verification Harness & Automated Diagnostics  
**Living Document:** Permanent architectural specification under `docs/specs/`  
**Tracking Backlog:** [docs/backlog/tasks.md](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/docs/backlog/tasks.md)  
**Executable Test Suite:** [tests/verification_harness.test.ts](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/tests/verification_harness.test.ts)

---

## 1. Overview & Business Objectives

Pre-flight verification must prevent broken, blank, or improperly sized simulations from reaching the user. 
Earlier iterations performed only a synchronous check in a hidden `display: none` iframe, which missed frame-1 animation crashes, blank canvases, and boundary parameter singularities.

This specification defines the **Autonomous Pre-Flight Verification Harness**:
1. **Real-Scale Viewport Execution**: The evaluation iframe renders visibly off-screen (e.g. `position: fixed; left: -10000px`) matching exact active Side Panel dimensions (`width` x `height`), ensuring DOM metrics (`clientWidth`, `getBoundingClientRect`) match runtime reality.
2. **Multi-Frame Soak Period**: Animates simulation loops across a ~800ms soak window to trap runtime errors occurring during subsequent `requestAnimationFrame` iterations.
3. **Parametric Boundary Sweeps**: Sweeps sliders and steppers across `defaults`, `min`, and `max` extremes to detect divide-by-zero singularities or unhandled edge cases.
4. **Deterministic Zero-Token Diagnostics**: Runs automated heuristic audits (blank render detection, non-finite `NaN`/`Infinity` text scans, duplicate control detection, canvas backing-store sizing) before invoking any vision models.
5. **Multi-State Visual Snapshotting**: Captures clean WebP/PNG raster snapshots across parameter phases for multimodal architectural review.

---

## 2. End-to-End Verification Pipeline

```mermaid
sequenceDiagram
    autonumber
    participant Orch as Agent Orchestrator
    participant Off as Offscreen Document
    participant Sand as Sandboxed Harness (sandbox.html)

    Orch->>Off: PREFLIGHT_TEST_REQUEST (code, verificationOptions)
    Off->>Sand: SANDBOX_VERIFY_SIMULATION (code, options)
    
    rect rgb(240, 248, 255)
    Note over Sand: Phase 1: Mount & Defaults Soak (~800ms)
    Sand->>Sand: init(simRoot, defaultParams, stageGeometry)
    Sand->>Sand: Pump requestAnimationFrame (trap runtime exceptions)
    Sand->>Sand: Run deterministic audits (Blank, NaN, Canvas Size, Controls)
    Sand->>Sand: Capture Snapshot Frame (defaults)
    end

    rect rgb(255, 250, 240)
    Note over Sand: Phase 2 & 3: Parametric Boundary Sweeps
    Sand->>Sand: update(minParams) -> Soak 200ms -> Capture Frame (min)
    Sand->>Sand: update(maxParams) -> Soak 200ms -> Capture Frame (max)
    end

    Sand-->>Off: SANDBOX_VERIFICATION_REPORT (report: VerificationReport)
    Off-->>Orch: PREFLIGHT_TEST_RESPONSE (status: ok | error, report)
```

---

## 3. Contracts & Data Models

Domain models are centrally defined in [`src/types/verification.ts`](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/src/types/verification.ts) and [`src/types/ipc.ts`](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/src/types/ipc.ts):

- [`VerificationOptions`](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/src/types/verification.ts): Target viewport, soak durations, timeout ceiling, and sweep flags.
- [`VerificationReport`](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/src/types/verification.ts): Consolidated results containing `status` (`pass` | `fail`), `diagnostics`, `runtimeErrors`, and `frames`.
- [`VerificationDiagnostic`](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/src/types/verification.ts): Machine-readable failure records categorized by [`DiagnosticCode`](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/src/types/verification.ts).
- [`VerificationFrame`](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/src/types/verification.ts): Raster snapshot (`image/png` or `image/webp`) coupled with the parameter state that rendered it.

---

## 4. Deterministic Diagnostic Audits

The harness executes the following automated checks prior to or in conjunction with multimodal review:

1. **`BLANK_RENDER`**: Canvas or SVG container displays uniform background pixels (variance < threshold) indicating missing render draw calls.
2. **`NON_FINITE_TEXT`**: Text nodes contain `"NaN"`, `"Infinity"`, or `"undefined"`, indicating arithmetic errors during parameter evaluation.
3. **`DEFAULT_CANVAS_SIZE`**: Any `<canvas>` element retains the browser fallback dimensions of `300x150`, indicating missing dynamic resize or backing-store assignment.
4. **`DUPLICATE_CONTROLS`**: Module generated internal Tweakpane instances (`.tp-rotv`) or manual `<input>` elements instead of relying on host-managed parameter controls.
5. **`RUNTIME_EXCEPTION`**: Uncaught JavaScript errors during `init()`, `update()`, or animation frame loops.

---

## 5. Behavioral Acceptance Matrix

| ID | Scenario | Given / State | When / Input | Expected Output | Verification Target |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **V1** | Real Sizing Emulation | Side Panel width 380px, height 500px | Harness mounts sandbox iframe | `container.clientWidth === 380`, `clientHeight === 500` | `tests/verification_harness.test.ts` |
| **V2** | Frame-1 Animation Trap | Module errors on 2nd `requestAnimationFrame` | Soak period active | Trapped as `RUNTIME_EXCEPTION` error; report status `fail` | `tests/verification_harness.test.ts` |
| **V3** | Blank Canvas Detection | Module clears canvas to `#090d16` but draws nothing | Canvas pixel audit | Emits `BLANK_RENDER` diagnostic with error severity | `tests/verification_harness.test.ts` |
| **V4** | Non-Finite Value Audit | Formula renders `x = NaN` in KaTeX/text | DOM tree scan | Emits `NON_FINITE_TEXT` diagnostic with error severity | `tests/verification_harness.test.ts` |
| **V5** | Default Canvas Fallback | Canvas backing store is 300x150 | Dimension scan | Emits `DEFAULT_CANVAS_SIZE` diagnostic | `tests/verification_harness.test.ts` |
| **V6** | Duplicate Pane Intercept | Module invokes `new Tweakpane.Pane()` | DOM tree scan | Emits `DUPLICATE_CONTROLS` diagnostic | `tests/verification_harness.test.ts` |
| **V7** | Parametric Boundary Sweep | Module has min: 0, max: 10 slider | Verification runs with sweep: true | Executes `defaults`, `min`, `max`; captures 3 distinct frames | `tests/verification_harness.test.ts` |
