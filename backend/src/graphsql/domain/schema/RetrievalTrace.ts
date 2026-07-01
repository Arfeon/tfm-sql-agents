/**
 * Traza de la recuperación GraphRAG (SPEC-13).
 *
 * Es la "caja de cristal" de la recuperación (SPEC-04): expone los pasos intermedios
 * que el contexto final oculta, para poder ver por qué entró cada tabla y no dar por
 * buena a ciegas una recuperación que parece semántica pero no lo es. No cambia la
 * recuperación; solo la explica.
 */
import type { SchemaContext } from './SchemaContext'

/** Por qué una tabla acabó en el contexto final. */
export type InclusionReason =
  | 'semantic' // entró por significado (estaba en el top-K semántico)
  | 'expansion' // entró por expansión de clave foránea desde una candidata
  | 'pinned' // la fijó el humano (must-include, SPEC-08)

/** Una tabla del ranking semántico, con su score y si es candidata (top-K). */
export interface RankedTable {
  tableName: string
  score: number
  isCandidate: boolean
}

/** Una tabla añadida por expansión de FK, con su score semántico (normalmente bajo). */
export interface ExpandedTable {
  tableName: string
  score: number
}

/** Una tabla del contexto final, con su score y el motivo por el que entró. */
export interface ContextTable {
  tableName: string
  score: number
  reason: InclusionReason
}

/** Traza completa del circuito de una recuperación. */
export interface RetrievalTrace {
  question: string
  /** Todas las tablas ordenadas por similitud, marcando las candidatas (top-K). */
  ranking: RankedTable[]
  /** Nombres de las candidatas por significado (top-K). */
  candidates: string[]
  /** Tablas que se añadieron por expansión de FK (no eran candidatas), con su score. */
  expansionAdded: ExpandedTable[]
  /** Tablas del contexto final tras el recorte, con score y motivo de inclusión. */
  finalContext: ContextTable[]
  /** El contexto real que usaría el pipeline (mismas tablas + DDL). */
  context: SchemaContext
  /** Las palancas usadas en esta recuperación. */
  levers: { semanticTopK: number; maxContextTables: number }
}
