/**
 * SimIt Simulation Module & Parameter Schema
 * Defines the contract that generated simEngine modules must implement
 * and how dynamic parameters are structured.
 */

export type ParameterType = 'slider' | 'toggle' | 'stepper' | 'select';

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
  step: number;
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
  step: number;
  default: number;
}

export interface SelectParameterDefinition extends BaseParameterDefinition {
  type: 'select';
  options: string[];
  default: string;
}

export type ParameterDefinition =
  | SliderParameterDefinition
  | ToggleParameterDefinition
  | StepperParameterDefinition
  | SelectParameterDefinition;

export type ParameterState = Record<string, number | boolean | string>;

export interface SimModule {
  title: string;
  description: string;
  parameters: ParameterDefinition[];
  init(container: HTMLElement, params: ParameterState): void;
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

