/**
 * La decisión del humano en la revisión (SPEC-08).
 *
 * Cuando el pipeline se para en la revisión, el humano elige una de estas cuatro
 * acciones. El grafo enruta según ella al reanudar:
 *
 *  - `approve`  → ejecutar la consulta (SPEC-07).
 *  - `reject`   → terminar sin ejecutar.
 *  - `modify`   → editar la SQL a mano; vuelve al Judge a re-validarla.
 *  - `pin`      → fijar una o varias tablas; se rehace la recuperación con esas
 *                 tablas fijadas (`mustInclude`, SPEC-04) y se regenera la SQL.
 */
export type HumanDecision =
  | { action: 'approve' }
  | { action: 'reject' }
  | { action: 'modify'; sql: string }
  | { action: 'pin'; tables: string[] }
