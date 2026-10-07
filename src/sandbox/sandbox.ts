/**
 * SimIt Sandboxed Execution Controller
 * Conforms to docs/specs/declarative_runtime.md and docs/specs/sandbox_ipc.md
 */

import { HostToSandboxMessage, SandboxToHostMessage } from '../types/ipc';
import { ParameterState, SimModule } from '../types/simulation';
import { sanitizeCodeFences, extractDefaultParameters, normalizeSimModule } from '../runtime/preflight';

let activeModule: SimModule | null = null;
let currentParams: ParameterState = {};
let activePane: any = null;

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

function cleanupPane() {
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
    if (target.closest('#pane-dock') || target.closest('#viewport-controls')) return;

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

/**
 * Enables smooth pointer dragging for the floating Tweakpane dock
 */
function makeDraggable(paneDock: HTMLElement) {
  let isDragging = false;
  let startX = 0;
  let startY = 0;
  let initialLeft = 0;
  let initialTop = 0;
  let moved = false;

  paneDock.addEventListener('pointerdown', (e: PointerEvent) => {
    const target = e.target as HTMLElement;
    const header = target.closest('.tp-rotv_b') as HTMLElement;
    if (!header) return;

    startX = e.clientX;
    startY = e.clientY;
    const rect = paneDock.getBoundingClientRect();
    initialLeft = rect.left;
    initialTop = rect.top;
    moved = false;

    try {
      header.setPointerCapture(e.pointerId);
    } catch (_) {}

    const onPointerMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;

      if (!moved && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) {
        moved = true;
        isDragging = true;
        paneDock.classList.add('is-dragging');
      }

      if (isDragging) {
        let newLeft = initialLeft + dx;
        let newTop = initialTop + dy;

        const maxLeft = Math.max(0, window.innerWidth - paneDock.offsetWidth);
        const maxTop = Math.max(0, window.innerHeight - paneDock.offsetHeight);

        newLeft = Math.max(0, Math.min(newLeft, maxLeft));
        newTop = Math.max(0, Math.min(newTop, maxTop));

        paneDock.style.left = `${newLeft}px`;
        paneDock.style.top = `${newTop}px`;
        paneDock.style.right = 'auto';
        paneDock.style.bottom = 'auto';
      }
    };

    const onPointerUp = (ev: PointerEvent) => {
      try {
        header.releasePointerCapture(ev.pointerId);
      } catch (_) {}

      header.removeEventListener('pointermove', onPointerMove as EventListener);
      header.removeEventListener('pointerup', onPointerUp as EventListener);
      header.removeEventListener('pointercancel', onPointerUp as EventListener);

      if (isDragging) {
        paneDock.classList.remove('is-dragging');
        isDragging = false;

        const blockClick = (clickEv: MouseEvent) => {
          clickEv.stopPropagation();
          clickEv.stopImmediatePropagation();
          clickEv.preventDefault();
        };
        header.addEventListener('click', blockClick, { capture: true, once: true });
        setTimeout(() => {
          header.removeEventListener('click', blockClick, { capture: true });
        }, 150);
      }
    };

    header.addEventListener('pointermove', onPointerMove as EventListener);
    header.addEventListener('pointerup', onPointerUp as EventListener);
    header.addEventListener('pointercancel', onPointerUp as EventListener);
  });

  window.addEventListener('resize', () => {
    if (paneDock.style.left) {
      const rect = paneDock.getBoundingClientRect();
      const maxLeft = Math.max(0, window.innerWidth - paneDock.offsetWidth);
      const maxTop = Math.max(0, window.innerHeight - paneDock.offsetHeight);
      if (rect.left > maxLeft) paneDock.style.left = `${maxLeft}px`;
      if (rect.top > maxTop) paneDock.style.top = `${maxTop}px`;
    }
  });
}

// Initialize dragging on the pane dock
const domPaneDock = document.getElementById('pane-dock');
if (domPaneDock) {
  makeDraggable(domPaneDock);
}

// Initialize universal viewport controls (zoom in/out, pan, recenter)
initViewportControls();

// Global error hooks catching unhandled runtime exceptions
window.addEventListener('error', (event) => {
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
  const reason = event.reason;
  const errorMsg: SandboxToHostMessage = {
    type: 'SANDBOX_RUNTIME_ERROR',
    message: reason?.message || 'Unhandled Promise Rejection',
    stack: reason?.stack,
    currentParams: window.__currentSimParams || {}
  };
  window.parent?.postMessage(errorMsg, '*');
});

// Message listener from Side Panel host
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
            init(container: HTMLElement, params: any) {
              const canvas = document.createElement('canvas');
              canvas.id = 'sim-canvas';
              canvas.width = container.clientWidth || 360;
              canvas.height = 260;
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

        // Auto-dock Tweakpane controls inside #pane-dock if parameters exist
        const PaneClass = window.Tweakpane?.Pane || (typeof window.Tweakpane === 'function' ? window.Tweakpane : null);
        if (PaneClass && paramsDef.length > 0) {
          try {
            const paneDock = document.getElementById('pane-dock');
            if (paneDock) {
              paneDock.style.display = 'block';
            }
            activePane = new PaneClass({
              container: paneDock || undefined,
              title: 'Controls',
              expanded: true
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
                  currentParams[p.id] = ev.value;
                  window.__currentSimParams = currentParams;
                  if (activeModule && typeof activeModule.update === 'function') {
                    activeModule.update(currentParams);
                  }
                  notifyHostParams();
                });
              } else if (p.type === 'toggle') {
                activePane.addBinding(currentParams, p.id, {
                  label: p.label || p.id
                }).on('change', (ev: any) => {
                  currentParams[p.id] = ev.value;
                  window.__currentSimParams = currentParams;
                  if (activeModule && typeof activeModule.update === 'function') {
                    activeModule.update(currentParams);
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
                  currentParams[p.id] = ev.value;
                  window.__currentSimParams = currentParams;
                  if (activeModule && typeof activeModule.update === 'function') {
                    activeModule.update(currentParams);
                  }
                  notifyHostParams();
                });
              } else if ((p as any).type === 'button' || (p as any).type === 'action') {
                activePane.addButton({
                  title: p.label || p.id
                }).on('click', () => {
                  if (activeModule && typeof activeModule.update === 'function') {
                    activeModule.update({ [p.id]: true });
                  }
                });
              }
            }

            const hasConfigurableParams = paramsDef.some(p => p.type === 'slider' || p.type === 'stepper' || p.type === 'toggle' || p.type === 'select');
            const hasCustomReset = paramsDef.some(p => p.id.toLowerCase().includes('reset') || (p.label && p.label.toLowerCase().includes('reset')));
            if (hasConfigurableParams && !hasCustomReset) {
              activePane.addButton({
                title: '↺ Reset Defaults'
              }).on('click', () => {
                Object.assign(currentParams, defaults);
                window.__currentSimParams = currentParams;
                if (activePane && typeof activePane.refresh === 'function') {
                  activePane.refresh();
                }
                if (activeModule && typeof activeModule.update === 'function') {
                  activeModule.update(currentParams);
                }
                notifyHostParams();
              });
            }
          } catch (tpErr) {
            console.warn('[Sandbox] Tweakpane auto-docking warning:', tpErr);
          }
        }

        activeModule.init(simRoot, currentParams);

        // Auto-repair uninitialized canvas dimensions (300x150 default)
        const canvases = simRoot.querySelectorAll('canvas');
        canvases.forEach((cv) => {
          if (cv.width === 300 && cv.height === 150) {
            const rect = cv.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              cv.width = Math.round(rect.width);
              cv.height = Math.round(rect.height);
            }
          }
        });
        const readyMsg: SandboxToHostMessage = {
          type: 'SANDBOX_SIMULATION_READY',
          title: activeModule.title || 'Simulation',
          description: activeModule.description || '',
          parameters: paramsDef
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
        const delta = data.params || {};
        currentParams = { ...currentParams, ...delta };
        window.__currentSimParams = currentParams;
        if (activePane && typeof activePane.refresh === 'function') {
          activePane.refresh();
        }
        activeModule.update({ ...currentParams, ...delta });

        // Clean up transient button actions from persistent state
        if (activeModule.parameters) {
          for (const p of activeModule.parameters) {
            if ((p as any).type === 'button' || (p as any).type === 'action') {
              delete currentParams[p.id];
            }
          }
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
  }
});

// Signal to host (Side Panel or Offscreen Harness) that sandbox is ready to receive code
window.parent?.postMessage({ type: 'SANDBOX_READY' }, '*');
