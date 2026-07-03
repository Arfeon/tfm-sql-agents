/**
 * La decisión del humano en la revisión (SPEC-08 + SPEC-15).
 *
 * Cuando el pipeline se para en la revisión, el humano elige una de estas cuatro
 * acciones. El grafo enruta según ella al reanudar:
 *
 *  - `approve`  → ejecutar la consulta (SPEC-07).
 *  - `reject`   → terminar sin ejecutar.
 *  - `modify`   → editar la SQL a mano; vuelve al Judge a re-validarla.
 *  - `refine`   → afinar la consulta (SPEC-15): doy una indicación en lenguaje
 *                 natural (`guidance`) y/o tablas a forzar (`tables`); se rehace la
 *                 recuperación con la indicación y las tablas fijadas (`mustInclude`,
 *                 SPEC-04) y se regenera la SQL. Sustituye a la antigua acción `pin`,
 *                 que era el caso particular de afinar solo con tablas.
 */
export type HumanDecision =
  | { action: 'approve' }
  | { action: 'reject' }
  | { action: 'modify'; sql: string }
  | { action: 'refine'; guidance?: string; tables?: string[] }
