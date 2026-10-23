/**
 * SimIt Simulation Module & Parameter Schema
 * Defines the contract that generated simEngine modules must implement
 * and how dynamic parameters are structured.
 */

export type ParameterType = 'slider' | 'toggle' | 'stepper' | 'select' | 'button' | 'action';

export interface BaseParameterDefinition {
  id: string;
  label: string;
  type: ParameterType;
  unit?: string;
  description?: string;
}

export interface SliderParameterDefinition extends BaseParameterDefinition {
  type: 'slider';
  min: number;
  max: number;
  step?: number;
  default: number;
}

export interface ToggleParameterDefinition extends BaseParameterDefinition {
  type: 'toggle';
  default: boolean;
}

export interface StepperParameterDefinition extends BaseParameterDefinition {
  type: 'stepper';
  min: number;
  max: number;
  step?: number;
  default: number;
}

export interface SelectParameterDefinition extends BaseParameterDefinition {
  type: 'select';
  options: string[];
  default: string;
}

export interface ButtonParameterDefinition extends BaseParameterDefinition {
  type: 'button' | 'action';
  default?: boolean;
}

export type ParameterDefinition =
  | SliderParameterDefinition
  | ToggleParameterDefinition
  | StepperParameterDefinition
  | SelectParameterDefinition
  | ButtonParameterDefinition;

export type ParameterState = Record<string, number | boolean | string>;

/**
 * Host-measured drawing surface handed to every module.
 * Conforms to docs/specs/simulation_module_contract.md#3-contracts--data-models
 */
export interface StageGeometry {
  /** CSS pixel size of #sim-root (the stage), EXCLUDING the host controls drawer. */
  width: number;
  height: number;
  /** window.devicePixelRatio clamped to [1, 3]. Canvas backing store = css size * dpr. */
  dpr: number;
  /** Insets (CSS px) overlapped by host chrome (e.g. viewport pill). Keep labels/readouts out of these. */
  safeArea: { top: number; right: number; bottom: number; left: number };
}

/** Host chrome dimensions used to derive StageGeometry. */
export interface HostLayoutMetrics {
  /** Total sandbox iframe size measured by the side panel. */
  viewportWidth: number;
  viewportHeight: number;
  /** Height reserved below the stage for the controls drawer when collapsed (0 when the module has no parameters). */
  controlsDrawerHeight: number;
  /** Height reserved above the controls drawer for the Guided Tour & Explanation bar when present. */
  explanationBarHeight?: number;
  /** Bottom-left viewport navigation pill footprint. */
  viewportPill?: { width: number; height: number; margin: number };
  devicePixelRatio?: number;
}

export interface PedagogySpec {
  /** One-sentence core insight the learner should walk away with. */
  coreInsight: string;
  /** What the learner is assumed to already know. */
  prerequisites?: string[];
  /** The likely misconception this simulation should disabuse. */
  misconception?: string;
  /** The specific "aha" parameter change or experiment that reveals the insight. */
  ahaExperiment?: string;
  /** Mapping of symbols/terms from the source text to visual elements on screen. */
  symbolMap?: Array<{
    symbol: string;
    meaning: string;
    visualElement?: string;
    color?: string;
    elementId?: string;
  }>;
}

export interface ExplanationLegendItem {
  elementId?: string;
  symbol?: string;
  meaning: string;
  visualElement?: string;
  color?: string;
}

export interface ExplanationTourStep {
  title?: string;
  caption: string;
  params?: Partial<ParameterState>;
  highlight?: string;
  highlightSelector?: string;
  tryThis?: string;
  noticeThat?: string;
}

export interface SimulationExplanation {
  insight: string;
  misconception?: string;
  legend?: ExplanationLegendItem[];
  tour?: ExplanationTourStep[];
}

export interface SimModule {
  title: string;
  description: string;
  parameters: ParameterDefinition[];
  explanation?: SimulationExplanation;
  /**
   * Called exactly once. `stage` is always provided by the host (optional in the type for legacy modules).
   */
  init(container: HTMLElement, params: ParameterState, stage?: StageGeometry): void;
  /**
   * Always receives the FULL merged parameter state.
   * Button/action parameters appear as `true` only in the single update() call triggered by the click.
   */
  update(params: ParameterState): void;
  step?(stepIndex: number): void;
  destroy?(): void;
}


// Declarative Runtime Stack Contracts (Tweakpane, functionPlot, Cytoscape)

export interface TweakpaneBindingConfig {
  container?: HTMLElement;
  title?: string;
  expanded?: boolean;
}

export interface FunctionPlotCurveData {
  fn: string;
  derivative?: {
    fn: string;
    updateOnMouseMove?: boolean;
  };
  color?: string;
  graphType?: 'polyline' | 'scatter';
  closed?: boolean;
}

export interface FunctionPlotOptions {
  target: string | HTMLElement;
  width?: number;
  height?: number;
  xAxis?: { domain?: [number, number]; label?: string };
  yAxis?: { domain?: [number, number]; label?: string };
  grid?: boolean;
  data: FunctionPlotCurveData[];
}

export interface CytoscapeElementData {
  id: string;
  label?: string;
  parent?: string;
  source?: string;
  target?: string;
  [key: string]: any;
}

export interface CytoscapeElement {
  group?: 'nodes' | 'edges';
  data: CytoscapeElementData;
  classes?: string;
  position?: { x: number; y: number };
}

export interface CytoscapeLayoutOptions {
  name: 'breadthfirst' | 'circle' | 'concentric' | 'cose' | 'dagre' | 'grid' | 'preset' | 'random';
  directed?: boolean;
  padding?: number;
  animate?: boolean;
  animationDuration?: number;
  [key: string]: any;
}
