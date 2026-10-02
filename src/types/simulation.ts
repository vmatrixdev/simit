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
