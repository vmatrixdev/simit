/**
 * SimIt Sandboxed Execution Controller
 * Conforms to docs/specs/declarative_runtime.md and docs/specs/sandbox_ipc.md
 */

import { HostToSandboxMessage, SandboxToHostMessage } from '../types/ipc';
import {
  ParameterDefinition,
  ParameterState,
  SimModule,
  SimulationExplanation,
  StageGeometry
} from '../types/simulation';
import { sanitizeCodeFences, extractDefaultParameters, normalizeSimModule } from '../runtime/preflight';
import {
  computeStageGeometry,
  DEFAULT_HOST_LAYOUT,
  dispatchParameterUpdate
} from '../runtime/module-contract';
import { applyStageGeometryToContainer, verifySimulationInStage } from '../runtime/verification';

let activeModule: SimModule | null = null;
let currentParams: ParameterState = {};
let activePane: any = null;
let activeExplanation: SimulationExplanation | null = null;
let activeParamsDef: ParameterDefinition[] = [];
let currentTourStepIndex = 0;
let isVerifying = false;

declare global {
  interface Window {
    __currentSimParams?: ParameterState;
    d3?: any;
    anime?: any;
    katex?: any;
    Tweakpane?: any;
    functionPlot?: any;
    cytoscape?: any;
    math?: any;
    jstat?: any;
    Matter?: any;
    matter?: any;
    glMatrix?: any;
    glmatrix?: any;
  }
}

window.__currentSimParams = currentParams;
if (typeof window !== 'undefined') {
  if (!window.jstat && (window as any).jStat) {
    window.jstat = (window as any).jStat;
  }
  if (!window.matter && (window as any).Matter) {
    window.matter = (window as any).Matter;
  }
  if (!window.glmatrix && (window as any).glMatrix) {
    window.glmatrix = (window as any).glMatrix;
  }
}

function clearTourHighlights() {
  const simRoot = document.getElementById('sim-root');
  if (!simRoot) return;
  simRoot.querySelectorAll('.simit-tour-highlight').forEach((el) => {
    el.classList.remove('simit-tour-highlight');
  });
}

function applyTourHighlight(selectorOrId?: string) {
  clearTourHighlights();
  if (!selectorOrId || !selectorOrId.trim()) return;
  const simRoot = document.getElementById('sim-root');
  if (!simRoot) return;
  const raw = selectorOrId.trim().replace(/^#/, '');
  try {
    const byId = simRoot.querySelector(`[id="${raw.replace(/"/g, '\\"')}"]`);
    const byData = simRoot.querySelector(`[data-element-id="${raw.replace(/"/g, '\\"')}"]`);
    const target = byId || byData || simRoot.querySelector(selectorOrId.trim());
    if (target) {
      target.classList.add('simit-tour-highlight');
    }
  } catch {
    // Ignore invalid CSS selectors in highlight
  }
}

function renderTourStep(stepIndex: number, applyParams: boolean) {
  if (!activeExplanation || !Array.isArray(activeExplanation.tour) || activeExplanation.tour.length === 0) {
    return;
  }
  const total = activeExplanation.tour.length;
  currentTourStepIndex = ((stepIndex % total) + total) % total;
  const step = activeExplanation.tour[currentTourStepIndex];
  if (!step) return;

  const indicator = document.getElementById('tour-step-indicator');
  const caption = document.getElementById('tour-caption');
  const tryThis = document.getElementById('tour-try-this');
  const noticeThat = document.getElementById('tour-notice-that');

  if (indicator) {
    indicator.textContent = `Step ${currentTourStepIndex + 1} of ${total}`;
  }
  if (caption) {
    caption.textContent = step.caption || '';
  }
  if (tryThis) {
    if (step.tryThis) {
      tryThis.textContent = `Try: ${step.tryThis}`;
      tryThis.style.display = 'inline';
    } else {
      tryThis.textContent = '';
      tryThis.style.display = 'none';
    }
  }
  if (noticeThat) {
    if (step.noticeThat) {
      noticeThat.textContent = `Notice: ${step.noticeThat}`;
      noticeThat.style.display = 'inline';
    } else {
      noticeThat.textContent = '';
      noticeThat.style.display = 'none';
    }
  }

  applyTourHighlight(step.highlight || step.highlightSelector);

  if (applyParams && step.params && typeof step.params === 'object' && activeModule) {
    const cleanParams: ParameterState = {};
    for (const [k, v] of Object.entries(step.params)) {
      if (v !== undefined) cleanParams[k] = v;
    }
    currentParams = dispatchParameterUpdate(activeModule, currentParams, activeParamsDef, cleanParams);
    window.__currentSimParams = currentParams;
    if (activePane && typeof activePane.refresh === 'function') {
      activePane.refresh();
    }
    window.parent?.postMessage(
      {
        type: 'SANDBOX_PARAMETERS_CHANGED',
        params: { ...currentParams }
      },
      '*'
    );
  }
}

function cleanupExplanationBar() {
  activeExplanation = null;
  currentTourStepIndex = 0;
  clearTourHighlights();
  const dock = document.getElementById('explanation-dock');
  const insightEl = document.getElementById('explanation-insight');
  const legendEl = document.getElementById('explanation-legend');
  const tourBar = document.getElementById('tour-bar');
  if (insightEl) insightEl.textContent = '';
  if (legendEl) legendEl.innerHTML = '';
  if (tourBar) tourBar.style.display = 'none';
  if (dock) dock.style.display = 'none';
  document.body?.classList.remove('has-explanation-bar');
}

function mountExplanationBar(
  explanation?: SimulationExplanation,
  paramsDef: ParameterDefinition[] = []
) {
  cleanupExplanationBar();
  activeParamsDef = paramsDef;
  if (!explanation || typeof explanation !== 'object') return;

  const hasInsight = typeof explanation.insight === 'string' && explanation.insight.trim().length > 0;
  const hasLegend = Array.isArray(explanation.legend) && explanation.legend.length > 0;
  const hasTour = Array.isArray(explanation.tour) && explanation.tour.length > 0;

  if (!hasInsight && !hasLegend && !hasTour) return;

  activeExplanation = explanation;
  const dock = document.getElementById('explanation-dock');
  const insightEl = document.getElementById('explanation-insight');
  const legendEl = document.getElementById('explanation-legend');
  const tourBar = document.getElementById('tour-bar');

  if (dock) {
    dock.style.display = 'flex';
  }
  document.body?.classList.add('has-explanation-bar');

  if (insightEl) {
    insightEl.textContent = hasInsight ? explanation.insight.trim() : '';
    insightEl.title = hasInsight ? explanation.insight.trim() : '';
  }

  if (legendEl && hasLegend && explanation.legend) {
    for (const item of explanation.legend) {
      if (!item || typeof item.symbol !== 'string' || typeof item.meaning !== 'string') continue;
      const badge = document.createElement('span');
      badge.className = 'legend-badge';
      if (item.color) {
        const swatch = document.createElement('span');
        swatch.className = 'legend-swatch';
        swatch.style.backgroundColor = item.color;
        badge.appendChild(swatch);
      }
      const sym = document.createElement('span');
      sym.className = 'legend-symbol';
      sym.textContent = item.symbol;
      const sep = document.createElement('span');
      sep.textContent = `: ${item.meaning}`;
      badge.appendChild(sym);
      badge.appendChild(sep);
      legendEl.appendChild(badge);
    }
  }

  if (tourBar && hasTour) {
    tourBar.style.display = 'flex';
    renderTourStep(0, false);
  }
}

function initTourControls() {
  const btnPrev = document.getElementById('btn-tour-prev');
  const btnNext = document.getElementById('btn-tour-next');
  btnPrev?.addEventListener('click', (e) => {
    e.stopPropagation();
    renderTourStep(currentTourStepIndex - 1, true);
  });
  btnNext?.addEventListener('click', (e) => {
    e.stopPropagation();
    renderTourStep(currentTourStepIndex + 1, true);
  });
}

initTourControls();

function cleanupPane() {
  cleanupExplanationBar();
  if (activePane) {
    try {
      if (typeof activePane.dispose === 'function') {
        activePane.dispose();
      }
    } catch (e) {
      console.warn('[Sandbox] Error disposing Tweakpane:', e);
    }
    activePane = null;
  }
  const paneDock = document.getElementById('pane-dock');
  if (paneDock) {
    paneDock.innerHTML = '';
    paneDock.style.display = 'none';
    paneDock.style.left = '';
    paneDock.style.top = '';
    paneDock.style.right = '';
    paneDock.style.bottom = '';
    paneDock.classList.remove('is-dragging');
  }
  document.body?.classList.remove('has-controls-drawer');
  resetViewport();
}

/**
 * Universal Viewport Navigation Controller (Zoom in/out, pan, recenter)
 * Operates at the #sim-root level so all simulations (Canvas, SVG, Cytoscape, DOM)
 * gain smooth, unified camera navigation without conflicting parameter sliders.
 */
let currentScale = 1.0;
let panX = 0;
let panY = 0;
let isPanModeActive = false;
const MIN_SCALE = 0.4;
const MAX_SCALE = 3.5;
const SCALE_STEP = 0.25;

function updateViewportTransform(animate = true) {
  const simRoot = document.getElementById('sim-root');
  const readout = document.getElementById('vp-zoom-readout');
  if (simRoot) {
    simRoot.style.transition = animate ? 'transform 0.08s ease-out' : 'none';
    simRoot.style.transform = `translate(${panX}px, ${panY}px) scale(${currentScale})`;
  }
  if (readout) {
    readout.textContent = `${Math.round(currentScale * 100)}%`;
  }
}

function setZoom(newScale: number, focalX?: number, focalY?: number) {
  const prevScale = currentScale;
  currentScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, Math.round(newScale * 100) / 100));

  if (focalX !== undefined && focalY !== undefined && prevScale !== currentScale) {
    const factor = currentScale / prevScale;
    panX = focalX - factor * (focalX - panX);
    panY = focalY - factor * (focalY - panY);
  }

  updateViewportTransform(true);
}

function resetViewport() {
  currentScale = 1.0;
  panX = 0;
  panY = 0;
  isPanModeActive = false;
  const btnPan = document.getElementById('btn-vp-pan');
  const viewportStage = document.getElementById('viewport-stage');
  if (btnPan) btnPan.classList.remove('active');
  if (viewportStage) {
    viewportStage.classList.remove('is-panning');
    viewportStage.classList.remove('is-panning-active');
  }
  updateViewportTransform(false);
}

function initViewportControls() {
  const viewportStage = document.getElementById('viewport-stage');
  const btnZoomIn = document.getElementById('btn-zoom-in');
  const btnZoomOut = document.getElementById('btn-zoom-out');
  const btnZoomReset = document.getElementById('btn-zoom-reset');
  const btnRecenter = document.getElementById('btn-vp-recenter');
  const btnPan = document.getElementById('btn-vp-pan');

  btnZoomIn?.addEventListener('click', (e) => {
    e.stopPropagation();
    setZoom(currentScale + SCALE_STEP);
  });
  btnZoomOut?.addEventListener('click', (e) => {
    e.stopPropagation();
    setZoom(currentScale - SCALE_STEP);
  });
  btnZoomReset?.addEventListener('click', (e) => {
    e.stopPropagation();
    currentScale = 1.0;
    updateViewportTransform(true);
  });
  btnRecenter?.addEventListener('click', (e) => {
    e.stopPropagation();
    resetViewport();
  });

  btnPan?.addEventListener('click', (e) => {
    e.stopPropagation();
    isPanModeActive = !isPanModeActive;
    btnPan.classList.toggle('active', isPanModeActive);
    viewportStage?.classList.toggle('is-panning', isPanModeActive);
  });

  // Space/Alt key down enables temporary pan mode cursor
  let spaceHeld = false;
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && (e.target as HTMLElement)?.tagName !== 'INPUT') {
      spaceHeld = true;
      viewportStage?.classList.add('is-panning');
    }
  });

  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') {
      spaceHeld = false;
      if (!isPanModeActive) {
        viewportStage?.classList.remove('is-panning');
      }
    }
  });

  // Pan dragging via pointer events on viewportStage
  let isDraggingPan = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let startPanX = 0;
  let startPanY = 0;

  viewportStage?.addEventListener('pointerdown', (e: PointerEvent) => {
    const isMiddleClick = e.button === 1;
    const isKeyHeld = e.altKey || spaceHeld;
    if (!isPanModeActive && !isMiddleClick && !isKeyHeld) return;

    const target = e.target as HTMLElement;
    if (
      target.closest('#pane-dock') ||
      target.closest('#explanation-dock') ||
      target.closest('#viewport-controls')
    )
      return;

    isDraggingPan = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    startPanX = panX;
    startPanY = panY;

    viewportStage.classList.add('is-panning-active');
    try {
      viewportStage.setPointerCapture(e.pointerId);
    } catch (_) {}

    e.preventDefault();
  });

  viewportStage?.addEventListener('pointermove', (e: PointerEvent) => {
    if (!isDraggingPan) return;
    const dx = e.clientX - dragStartX;
    const dy = e.clientY - dragStartY;
    panX = startPanX + dx;
    panY = startPanY + dy;
    updateViewportTransform(false);
  });

  const endPan = (e: PointerEvent) => {
    if (!isDraggingPan) return;
    isDraggingPan = false;
    viewportStage?.classList.remove('is-panning-active');
    try {
      viewportStage?.releasePointerCapture(e.pointerId);
    } catch (_) {}
  };

  viewportStage?.addEventListener('pointerup', endPan);
  viewportStage?.addEventListener('pointercancel', endPan);

  // Wheel zoom when holding Ctrl/Cmd or trackpad pinch
  viewportStage?.addEventListener('wheel', (e: WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const rect = viewportStage.getBoundingClientRect();
      const focalX = e.clientX - rect.left - rect.width / 2;
      const focalY = e.clientY - rect.top - rect.height / 2;
      const factor = e.deltaY < 0 ? 1.15 : 0.87;
      setZoom(currentScale * factor, focalX, focalY);
    }
  }, { passive: false });
}

// Initialize universal viewport controls (zoom in/out, pan, recenter)
initViewportControls();

// Global error hooks catching unhandled runtime exceptions
window.addEventListener('error', (event) => {
  if (isVerifying) return;
  const errorMsg: SandboxToHostMessage = {
    type: 'SANDBOX_RUNTIME_ERROR',
    message: event.message || 'Script error',
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno,
    stack: event.error ? event.error.stack : undefined,
    currentParams: window.__currentSimParams || {}
  };
  window.parent?.postMessage(errorMsg, '*');
});

window.addEventListener('unhandledrejection', (event) => {
  if (isVerifying) return;
  const reason = event.reason;
  const errorMsg: SandboxToHostMessage = {
    type: 'SANDBOX_RUNTIME_ERROR',
    message: reason?.message || 'Unhandled Promise Rejection',
    stack: reason?.stack,
    currentParams: window.__currentSimParams || {}
  };
  window.parent?.postMessage(errorMsg, '*');
});

// Message listener from Side Panel or Offscreen host
window.addEventListener('message', (event) => {
  const data = event.data as HostToSandboxMessage;
  if (!data || !data.type) return;

  const simRoot = document.getElementById('sim-root');
  if (!simRoot) return;

  switch (data.type) {
    case 'SANDBOX_INIT_SIMULATION': {
      try {
        if (activeModule && typeof activeModule.destroy === 'function') {
          try {
            activeModule.destroy();
          } catch (e) {
            console.warn('[Sandbox] Error destroying previous module:', e);
          }
        }
        cleanupPane();
        simRoot.innerHTML = '';

        const code = sanitizeCodeFences(data.code);
        let executableCode = code;
        if (executableCode.includes('export default')) {
          executableCode = executableCode.replace(/export\s+default\s+/, 'return ');
        } else if (!executableCode.includes('return ')) {
          const classMatch = executableCode.match(/class\s+([A-Za-z0-9_$]+)/);
          if (classMatch && classMatch[1]) {
            executableCode += `\n; return ${classMatch[1]};`;
          }
        }

        const evaluator = new Function(
          'd3',
          'anime',
          'katex',
          'Tweakpane',
          'functionPlot',
          'cytoscape',
          'math',
          'jstat',
          'Matter',
          'matter',
          'glMatrix',
          'window',
          'document',
          `"use strict";
           ${executableCode}`
        );

        const evalResult = evaluator(
          window.d3,
          window.anime,
          window.katex,
          window.Tweakpane,
          window.functionPlot,
          window.cytoscape,
          window.math,
          window.jstat || (window as any).jStat,
          window.Matter || (window as any).matter,
          window.Matter || (window as any).matter,
          window.glMatrix || (window as any).glmatrix,
          window,
          document
        );

        if (typeof evalResult === 'function') {
          const Cls = evalResult as any;
          activeModule = {
            title: Cls.name || 'Simulation',
            description: 'Dynamic visual simulation.',
            parameters: [],
            init(container: HTMLElement, params: any, stage?: StageGeometry) {
              const canvas = document.createElement('canvas');
              canvas.id = 'sim-canvas';
              canvas.width = stage?.width || container.clientWidth || 380;
              canvas.height = stage?.height || container.clientHeight || 456;
              container.appendChild(canvas);
              try {
                (this as any).__instance = new Cls(canvas.id, canvas.width, canvas.height);
              } catch {
                (this as any).__instance = new Cls(container, params);
              }
            },
            update(params: any) {
              if ((this as any).__instance?.update) {
                (this as any).__instance.update(0.016, params);
              }
              if ((this as any).__instance?.draw) {
                (this as any).__instance.draw();
              }
            },
            destroy() {
              if ((this as any).__instance?.destroy) {
                (this as any).__instance.destroy();
              }
            }
          };
        } else {
          activeModule = normalizeSimModule(evalResult);
        }

        if (!activeModule || typeof activeModule.init !== 'function') {
          throw new Error('Simulation code did not produce a valid module with init() method.');
        }

        const paramsDef = Array.isArray(activeModule.parameters) ? activeModule.parameters : [];
        const defaults = extractDefaultParameters(paramsDef);
        currentParams = { ...defaults, ...(data.initialParams || {}) };
        window.__currentSimParams = currentParams;

        const explanation = activeModule.explanation || data.explanation;
        if (explanation && !activeModule.explanation) {
          activeModule.explanation = explanation;
        }
        const hasExplanationBar = Boolean(
          explanation &&
            ((typeof explanation.insight === 'string' && explanation.insight.trim().length > 0) ||
              (Array.isArray(explanation.legend) && explanation.legend.length > 0) ||
              (Array.isArray(explanation.tour) && explanation.tour.length > 0))
        );

        // Reserve bottom drawer space when parameters or explanation bar exist and compute stage geometry
        document.body?.classList.toggle('has-controls-drawer', paramsDef.length > 0);
        document.body?.classList.toggle('has-explanation-bar', hasExplanationBar);
        const stage = computeStageGeometry(
          {
            viewportWidth: window.innerWidth || DEFAULT_HOST_LAYOUT.viewportWidth,
            viewportHeight: window.innerHeight || DEFAULT_HOST_LAYOUT.viewportHeight,
            controlsDrawerHeight: DEFAULT_HOST_LAYOUT.controlsDrawerHeight,
            explanationBarHeight: hasExplanationBar ? 58 : 0
          },
          paramsDef.length,
          window.devicePixelRatio || 1
        );
        applyStageGeometryToContainer(simRoot, stage);

        // Auto-dock Tweakpane controls inside bottom #pane-dock drawer if parameters exist
        const PaneClass = window.Tweakpane?.Pane || (typeof window.Tweakpane === 'function' ? window.Tweakpane : null);
        if (PaneClass && paramsDef.length > 0) {
          try {
            const paneDock = document.getElementById('pane-dock');
            if (paneDock) {
              paneDock.style.display = 'block';
            }
            activePane = new PaneClass({
              container: paneDock || undefined,
              title: `Controls (${paramsDef.length})`,
              expanded: false
            });

            const notifyHostParams = () => {
              window.parent?.postMessage({
                type: 'SANDBOX_PARAMETERS_CHANGED',
                params: { ...currentParams }
              }, '*');
            };

            for (const p of paramsDef) {
              if (p.type === 'slider' || p.type === 'stepper') {
                activePane.addBinding(currentParams, p.id, {
                  min: p.min !== undefined ? p.min : 0,
                  max: p.max !== undefined ? p.max : 100,
                  step: p.step !== undefined ? p.step : 1,
                  label: p.label || p.id
                }).on('change', (ev: any) => {
                  if (activeModule) {
                    currentParams = dispatchParameterUpdate(activeModule, currentParams, paramsDef, {
                      [p.id]: ev.value
                    });
                    window.__currentSimParams = currentParams;
                  }
                  notifyHostParams();
                });
              } else if (p.type === 'toggle') {
                activePane.addBinding(currentParams, p.id, {
                  label: p.label || p.id
                }).on('change', (ev: any) => {
                  if (activeModule) {
                    currentParams = dispatchParameterUpdate(activeModule, currentParams, paramsDef, {
                      [p.id]: ev.value
                    });
                    window.__currentSimParams = currentParams;
                  }
                  notifyHostParams();
                });
              } else if (p.type === 'select') {
                const optionsMap: Record<string, string> = {};
                for (const opt of p.options || []) {
                  optionsMap[opt] = opt;
                }
                activePane.addBinding(currentParams, p.id, {
                  options: optionsMap,
                  label: p.label || p.id
                }).on('change', (ev: any) => {
                  if (activeModule) {
                    currentParams = dispatchParameterUpdate(activeModule, currentParams, paramsDef, {
                      [p.id]: ev.value
                    });
                    window.__currentSimParams = currentParams;
                  }
                  notifyHostParams();
                });
              } else if ((p as any).type === 'button' || (p as any).type === 'action') {
                activePane.addButton({
                  title: p.label || p.id
                }).on('click', () => {
                  if (activeModule) {
                    currentParams = dispatchParameterUpdate(activeModule, currentParams, paramsDef, {
                      [p.id]: true
                    });
                    window.__currentSimParams = currentParams;
                  }
                });
              }
            }

            const hasConfigurableParams = paramsDef.some(
              p => p.type === 'slider' || p.type === 'stepper' || p.type === 'toggle' || p.type === 'select'
            );
            const hasCustomReset = paramsDef.some(
              p => p.id.toLowerCase().includes('reset') || (p.label && p.label.toLowerCase().includes('reset'))
            );
            if (hasConfigurableParams && !hasCustomReset) {
              activePane.addButton({
                title: '↺ Reset Defaults'
              }).on('click', () => {
                if (activeModule) {
                  currentParams = dispatchParameterUpdate(activeModule, currentParams, paramsDef, defaults);
                  window.__currentSimParams = currentParams;
                }
                if (activePane && typeof activePane.refresh === 'function') {
                  activePane.refresh();
                }
                notifyHostParams();
              });
            }
          } catch (tpErr) {
            console.warn('[Sandbox] Tweakpane auto-docking warning:', tpErr);
          }
        }

        activeModule.init(simRoot, currentParams, stage);
        mountExplanationBar(explanation, paramsDef);

        // Auto-repair uninitialized canvas dimensions (300x150 default)
        const canvases = simRoot.querySelectorAll('canvas');
        canvases.forEach((cv) => {
          if (cv.width === 300 && cv.height === 150) {
            const rect = cv.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              cv.width = Math.round(rect.width);
              cv.height = Math.round(rect.height);
            } else {
              cv.width = stage.width;
              cv.height = stage.height;
            }
          }
        });

        let snapshotUrl: string | undefined;
        try {
          const canvas = simRoot.querySelector('canvas') as HTMLCanvasElement;
          if (canvas && typeof canvas.toDataURL === 'function' && canvas.width > 0 && canvas.height > 0) {
            try {
              snapshotUrl = canvas.toDataURL('image/webp', 0.85);
            } catch {
              snapshotUrl = canvas.toDataURL('image/png');
            }
          } else {
            const svg = simRoot.querySelector('svg');
            if (svg) {
              const xml = new XMLSerializer().serializeToString(svg);
              snapshotUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
            }
          }
        } catch (snapErr) {
          console.warn('[Sandbox] Snapshot capture notice:', snapErr);
        }

        const readyMsg: SandboxToHostMessage = {
          type: 'SANDBOX_SIMULATION_READY',
          title: activeModule.title || 'Simulation',
          description: activeModule.description || '',
          parameters: paramsDef,
          ...(explanation ? { explanation } : {}),
          snapshotUrl
        };
        window.parent?.postMessage(readyMsg, '*');
      } catch (err: any) {
        const errorMsg: SandboxToHostMessage = {
          type: 'SANDBOX_RUNTIME_ERROR',
          message: err.message || String(err),
          stack: err.stack,
          currentParams
        };
        window.parent?.postMessage(errorMsg, '*');
      }
      break;
    }

    case 'SANDBOX_UPDATE_PARAMETERS': {
      if (!activeModule || typeof activeModule.update !== 'function') return;
      try {
        const paramsDef = Array.isArray(activeModule.parameters) ? activeModule.parameters : [];
        currentParams = dispatchParameterUpdate(activeModule, currentParams, paramsDef, data.params || {});
        window.__currentSimParams = currentParams;
        if (activePane && typeof activePane.refresh === 'function') {
          activePane.refresh();
        }
      } catch (err: any) {
        const errorMsg: SandboxToHostMessage = {
          type: 'SANDBOX_RUNTIME_ERROR',
          message: err.message || String(err),
          stack: err.stack,
          currentParams
        };
        window.parent?.postMessage(errorMsg, '*');
      }
      break;
    }

    case 'SANDBOX_DESTROY': {
      cleanupPane();
      if (activeModule && typeof activeModule.destroy === 'function') {
        try {
          activeModule.destroy();
        } catch (e) {
          console.error('[Sandbox] Error destroying module:', e);
        }
      }
      simRoot.innerHTML = '';
      activeModule = null;
      break;
    }

    case 'SANDBOX_VERIFY_SIMULATION': {
      const requestId = data.requestId;
      cleanupPane();
      if (activeModule && typeof activeModule.destroy === 'function') {
        try {
          activeModule.destroy();
        } catch {}
        activeModule = null;
      }

      isVerifying = true;
      verifySimulationInStage(simRoot, sanitizeCodeFences(data.code), data.options)
        .then((report) => {
          isVerifying = false;
          const responseMsg: SandboxToHostMessage = {
            type: 'SANDBOX_VERIFICATION_REPORT',
            requestId,
            report
          };
          window.parent?.postMessage(responseMsg, '*');
        })
        .catch((err: any) => {
          isVerifying = false;
          const responseMsg: SandboxToHostMessage = {
            type: 'SANDBOX_VERIFICATION_REPORT',
            requestId,
            report: {
              status: 'fail',
              diagnostics: [
                {
                  code: 'RUNTIME_EXCEPTION',
                  severity: 'error',
                  phase: 'compile',
                  message: err?.message || String(err)
                }
              ],
              runtimeErrors: [
                {
                  phase: 'compile',
                  message: err?.message || String(err),
                  stack: err?.stack
                }
              ],
              frames: [],
              parameters: [],
              title: 'Verification Error',
              description: '',
              durationMs: 0
            }
          };
          window.parent?.postMessage(responseMsg, '*');
        });
      break;
    }
  }
});

// Signal to host (Side Panel or Offscreen Harness) that sandbox is ready to receive code
window.parent?.postMessage({ type: 'SANDBOX_READY' }, '*');
