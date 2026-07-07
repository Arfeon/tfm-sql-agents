/**
 * La decisión del humano en la revisión (SPEC-08 + SPEC-15). El grafo enruta según
 * ella al reanudar: `modify` vuelve al Judge a re-validar la SQL editada, y `refine`
 * rehace la recuperación con la indicación y las tablas fijadas antes de regenerar la SQL.
 */
export type HumanDecision =
  | { action: 'approve' }
  | { action: 'reject' }
  | { action: 'modify'; sql: string }
  | { action: 'refine'; guidance?: string; tables?: string[] }
