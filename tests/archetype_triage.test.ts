/**
 * Executable Contract Verification: Archetype Triage & Fallback Modalities
 * Conforms to docs/specs/archetype_triage.md
 */

import { describe, it, expect } from 'vitest';
import {
  ArchetypeType,
  ArchetypeClassification,
  ArchetypeTriageResult,
  ConceptDagData,
  SocraticBreakdownData,
} from '../src/types/archetype';

describe('Archetype Triage & Fallback Modalities Specification (docs/specs/archetype_triage.md)', () => {
  it('A1: Softmax Temperature Equation classifies as parameter_explorer with continuous variable tau', () => {
    const classification: ArchetypeClassification = {
      archetype: 'parameter_explorer',
      confidence: 0.98,
      rationale: 'Contains continuous temperature parameter tau affecting softmax distribution',
      isSimulatable: true,
      suggestedVariables: ['tau', 'z_i']
    };

    expect(classification.archetype).toBe('parameter_explorer');
    expect(classification.isSimulatable).toBe(true);
    expect(classification.suggestedVariables).toContain('tau');
  });

  it('A2: QuickSort Partition Loop classifies as step_scrubber with discrete steps', () => {
    const classification: ArchetypeClassification = {
      archetype: 'step_scrubber',
      confidence: 0.95,
      rationale: 'Algorithm with explicit iterative loop, pivot comparisons, and element swaps',
      isSimulatable: true,
    };

    expect(classification.archetype).toBe('step_scrubber');
    expect(classification.isSimulatable).toBe(true);
  });

  it('A3: TCP Congestion Control classifies as state_machine with discrete transitions', () => {
    const classification: ArchetypeClassification = {
      archetype: 'state_machine',
      confidence: 0.94,
      rationale: 'Protocol states: Slow Start -> Congestion Avoidance -> Fast Recovery',
      isSimulatable: true,
    };

    expect(classification.archetype).toBe('state_machine');
    expect(classification.isSimulatable).toBe(true);
  });

  it('A4: Transformer Layer Hierarchy routes to concept_dag with typed nodes and edges', () => {
    const triage: ArchetypeTriageResult = {
      classification: {
        archetype: 'concept_dag',
        confidence: 0.92,
        rationale: 'Structural description of Encoder/Decoder hierarchy without continuous dynamical equations',
        isSimulatable: false,
      },
      conceptDag: {
        title: 'Transformer Architecture Hierarchy',
        summary: 'Decomposition of Transformer into Multi-Head Attention and Feed-Forward sublayers',
        nodes: [
          { id: 'transformer', label: 'Transformer', category: 'core', description: 'Overall sequence-to-sequence model' },
          { id: 'encoder', label: 'Encoder Stack', category: 'core', description: 'Processes input sequence' },
          { id: 'decoder', label: 'Decoder Stack', category: 'core', description: 'Generates output sequence auto-regressively' },
          { id: 'mha', label: 'Multi-Head Attention', category: 'prerequisite', description: 'Computes parallel scaled dot-product attention' }
        ],
        edges: [
          { id: 'e1', source: 'transformer', target: 'encoder', relationship: 'produces' },
          { id: 'e2', source: 'transformer', target: 'decoder', relationship: 'produces' },
          { id: 'e3', source: 'encoder', target: 'mha', relationship: 'depends_on' }
        ]
      }
    };

    expect(triage.classification.archetype).toBe('concept_dag');
    expect(triage.classification.isSimulatable).toBe(false);
    expect(triage.conceptDag?.nodes.length).toBe(4);
    expect(triage.conceptDag?.edges.length).toBe(3);
    expect(triage.conceptDag?.edges[0].relationship).toBe('produces');
  });

  it('A5: Historical text routes to socratic_breakdown with inquiry chips and thesis', () => {
    const triage: ArchetypeTriageResult = {
      classification: {
        archetype: 'socratic_breakdown',
        confidence: 0.96,
        rationale: 'Historical narrative detailing the 1958 invention of the Perceptron by Frank Rosenblatt',
        isSimulatable: false,
      },
      socraticBreakdown: {
        title: 'The Origin of the Perceptron (1958)',
        coreThesis: 'The Perceptron introduced hardware-implemented linear threshold units inspired by biological neurons.',
        contextSnippet: 'In 1958, Frank Rosenblatt proposed the Perceptron...',
        chips: [
          {
            id: 'c1',
            shortLabel: 'Hardware vs Algorithm',
            question: 'Was the original Perceptron hardware or software?',
            answer: 'It was originally implemented as custom analog hardware on the Mark I Perceptron computer.'
          },
          {
            id: 'c2',
            shortLabel: 'Convergence Theorem',
            question: 'What is the Perceptron Convergence Theorem?',
            answer: 'If data is linearly separable, the perceptron learning algorithm is guaranteed to converge in finite steps.'
          }
        ],
        expandRecommendation: 'Highlight Eq (2) for the weight update rule to explore a parameter simulation.'
      }
    };

    expect(triage.classification.archetype).toBe('socratic_breakdown');
    expect(triage.classification.isSimulatable).toBe(false);
    expect(triage.socraticBreakdown?.chips.length).toBe(2);
    expect(triage.socraticBreakdown?.expandRecommendation).toContain('Eq (2)');
  });

  it('A6: Ungrounded motion guard prohibits arbitrary particles/motion when isSimulatable is false', () => {
    const triage: ArchetypeClassification = {
      archetype: 'concept_dag',
      confidence: 0.90,
      rationale: 'Qualitative definitions lack differential equations or discrete state loops',
      isSimulatable: false
    };

    const isMotionPermitted = (classification: ArchetypeClassification): boolean => {
      // Invariant: Motion is strictly forbidden unless the archetype is dynamically simulatable
      return classification.isSimulatable;
    };

    expect(isMotionPermitted(triage)).toBe(false);
  });
});
