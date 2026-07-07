/**
 * Veredicto completo del Judge (SPEC-06). Los `errors` bloquean la consulta;
 * los avisos y sugerencias no.
 */
/**
 * De dónde deduce el Judge el propósito de una tabla (SPEC-14): descripción documentada,
 * nombre o columnas evidentes, o `assumed` cuando el propósito es una SUPOSICIÓN.
 */
export type PurposeSource = 'description' | 'name' | 'columns' | 'assumed'

export interface TablePurpose {
  table: string
  purpose: string
  source: PurposeSource
}

export interface JudgeVerdict {
  valid: boolean
  /** De 0 a 1; ausente si no se llegó a consultar al juez LLM. */
  confidence?: number
  errors: string[]
  warnings: string[]
  suggestions: string[]
  /** Tablas que el juez dice haber verificado contra el esquema. */
  tablesVerified: string[]
  explanation: string
  /** Las `assumed` generan además un aviso; ausente si no se consultó al juez LLM (SPEC-14). */
  tablePurposes?: TablePurpose[]
}

export function securityFailureVerdict(errors: string[]): JudgeVerdict {
  return {
    valid: false,
    confidence: 0,
    errors,
    warnings: [],
    suggestions: [],
    tablesVerified: [],
    explanation: 'Rechazada por la comprobación de seguridad: no es una consulta de solo lectura.',
  }
}

export function syntaxFailureVerdict(error?: string): JudgeVerdict {
  return {
    valid: false,
    confidence: 0,
    errors: [error ? `La base de datos rechazó la consulta: ${error}` : 'La base de datos rechazó la sintaxis de la consulta.'],
    warnings: [],
    suggestions: [],
    tablesVerified: [],
    explanation: 'Rechazada al comprobar la sintaxis contra la base de datos.',
  }
}

export function checksPassedVerdict(dbChecked: boolean): JudgeVerdict {
  return {
    valid: true,
    errors: [],
    warnings: [],
    suggestions: [],
    tablesVerified: [],
    explanation: dbChecked
      ? 'La consulta es de solo lectura y su sintaxis es válida en la base de datos; no se consultó al juez LLM.'
      : 'La consulta es de solo lectura; no se consultó al juez LLM.',
  }
}
