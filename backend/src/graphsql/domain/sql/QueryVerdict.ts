/**
 * Veredicto de validación de una consulta SQL (SPEC-06).
 *
 * Es lo que devuelve el Judge: si la consulta es válida y, si no, la lista de
 * problemas que encontró. El supervisor (SPEC-10) lo mira para decidir si vuelve
 * al SQL Agent con los errores o si pasa a la revisión humana.
 */
export interface QueryVerdict {
  valid: boolean
  /** Vacía si es válida; si no, una razón por cada problema detectado. */
  errors: string[]
}

/** Veredicto positivo: la consulta pasa, sin problemas. */
export function validVerdict(): QueryVerdict {
  return { valid: true, errors: [] }
}

/** Veredicto negativo: la consulta no pasa, con la lista de razones. */
export function invalidVerdict(errors: string[]): QueryVerdict {
  return { valid: false, errors }
}
