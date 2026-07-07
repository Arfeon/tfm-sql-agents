/**
 * Traza de la recuperación GraphRAG (SPEC-13): expone los pasos intermedios para ver
 * por qué entró cada tabla en el contexto. No cambia la recuperación; solo la explica.
 */
import type { SchemaContext } from './SchemaContext'

/** Por qué una tabla acabó en el contexto final. */
export type InclusionReason =
  | 'semantic' // estaba en el top-K semántico
  | 'expansion' // entró por expansión de clave foránea desde una candidata
  | 'pinned' // la fijó el usuario (must-include, SPEC-08)

/** `isCandidate`: si está en el top-K semántico. */
export interface RankedTable {
  tableName: string
  score: number
  isCandidate: boolean
}

export interface ExpandedTable {
  tableName: string
  score: number
}

export interface ContextTable {
  tableName: string
  score: number
  reason: InclusionReason
}

export interface RetrievalTrace {
  question: string
  /** Todas las tablas ordenadas por similitud. */
  ranking: RankedTable[]
  /** Candidatas por significado (top-K). */
  candidates: string[]
  /** Añadidas por expansión de FK (no eran candidatas). */
  expansionAdded: ExpandedTable[]
  /** Contexto final tras el recorte, con motivo de inclusión. */
  finalContext: ContextTable[]
  /** El contexto real que usaría el pipeline (mismas tablas + DDL). */
  context: SchemaContext
  levers: { semanticTopK: number; maxContextTables: number }
}
