/**
 * Veredicto completo del Judge (SPEC-06).
 *
 * Es más rico que el `QueryVerdict` de la comprobación de seguridad (solo válido +
 * errores). Además de si la consulta es válida y de los errores que la bloquean,
 * recoge lo que aporta el juez LLM: la confianza con que la da por buena, avisos y
 * sugerencias que no bloquean, las tablas que dice haber verificado contra el
 * esquema y una explicación breve. Distingo "errores" (bloquean) de
 * "avisos/sugerencias" (no).
 */
/**
 * Cómo sabe el Judge qué contiene una tabla usada en la consulta (SPEC-14):
 * - `description`: la tabla tiene descripción → propósito documentado.
 * - `name`: el nombre lo deja claro (p. ej. `customer`).
 * - `columns`: las columnas lo dejan claro (p. ej. `game_rating(customer_id, game_id, score)`).
 * - `assumed`: nombre opaco y sin descripción → el propósito es una SUPOSICIÓN.
 */
export type PurposeSource = 'description' | 'name' | 'columns' | 'assumed'

/** El propósito que el Judge atribuye a una tabla usada, y de dónde lo deduce. */
export interface TablePurpose {
  table: string
  purpose: string
  source: PurposeSource
}

export interface JudgeVerdict {
  valid: boolean
  /** Confianza del juez LLM, de 0 a 1. Ausente si no se llegó a consultar al LLM. */
  confidence?: number
  /** Motivos que bloquean la consulta (seguridad o, si aplica, del juez LLM). */
  errors: string[]
  /** Observaciones que no bloquean (p. ej. estilo, posible ineficiencia). */
  warnings: string[]
  /** Sugerencias de mejora (no bloquean). */
  suggestions: string[]
  /** Tablas que el juez dice haber verificado contra el esquema. */
  tablesVerified: string[]
  /** Explicación breve del veredicto. */
  explanation: string
  /**
   * Propósito atribuido a cada tabla usada y su fuente (SPEC-14). Las de propósito
   * documentado/evidente son informativas; las `assumed` generan además un aviso.
   * Ausente si no se consultó al juez LLM.
   */
  tablePurposes?: TablePurpose[]
}

/** Veredicto cuando la comprobación de seguridad rechaza: no es de solo lectura. */
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

/** Veredicto cuando la base de datos rechaza la sintaxis de la consulta. */
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

/** Veredicto cuando las comprobaciones automáticas pasaron y no se consultó al juez LLM. */
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
