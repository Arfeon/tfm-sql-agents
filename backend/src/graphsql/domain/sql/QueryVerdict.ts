/**
 * Veredicto de validación de una consulta SQL (SPEC-06). El supervisor (SPEC-10) lo
 * mira para decidir si vuelve al SQL Agent con los errores o pasa a la revisión humana.
 */
export interface QueryVerdict {
  valid: boolean
  errors: string[]
}

export function validVerdict(): QueryVerdict {
  return { valid: true, errors: [] }
}

export function invalidVerdict(errors: string[]): QueryVerdict {
  return { valid: false, errors }
}
