/**
 * SimIt Archetype Triage & Fallback Modalities Schema
 * Conforms to docs/specs/archetype_triage.md
 */

export type ArchetypeType =
  | 'parameter_explorer'   // Continuous mathematical systems, loss surfaces, equations
  | 'step_scrubber'        // Discrete multi-step algorithms (sorting, search, DP)
  | 'state_machine'        // Finite state automata, protocols, Markov chains
  | 'concept_dag'          // Non-simulatable hierarchical concepts, taxonomies
  | 'socratic_breakdown';  // Non-simulatable static definitions, historical background

export interface ArchetypeClassification {
  archetype: ArchetypeType;
  confidence: number; // 0.0 - 1.0
  rationale: string;
  isSimulatable: boolean; // false for concept_dag and socratic_breakdown
  suggestedVariables?: string[]; // variables referenced in text but missing bounds
}

export interface ConceptDagNode {
  id: string;
  label: string;
  category?: 'core' | 'prerequisite' | 'application' | 'extension';
  description: string;
  mathFormula?: string;
}

export interface ConceptDagEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  relationship: 'depends_on' | 'generalizes' | 'produces' | 'contrasts_with';
}

export interface ConceptDagData {
  title: string;
  summary: string;
  nodes: ConceptDagNode[];
  edges: ConceptDagEdge[];
  rootNodeId?: string;
}

export interface SocraticChip {
  id: string;
  question: string;
  shortLabel: string;
  answer: string;
  latexAnnotation?: string;
  relatedConceptIds?: string[];
}

export interface SocraticBreakdownData {
  title: string;
  coreThesis: string;
  contextSnippet: string;
  chips: SocraticChip[];
  expandRecommendation?: string; // Guidance if text references unselected equations
}

export interface ArchetypeTriageResult {
  classification: ArchetypeClassification;
  conceptDag?: ConceptDagData;
  socraticBreakdown?: SocraticBreakdownData;
}
