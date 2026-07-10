/**
 * Traza de la recuperación GraphRAG (SPEC-13): expone los pasos intermedios para ver
 * por qué entró cada tabla en el contexto. No cambia la recuperación; solo la explica.
 */
import type { SchemaContext } from './SchemaContext'

/** Por qué una tabla acabó en el contexto final. */
export type InclusionReason =
  | 'semantic' // estaba en el top-K semántico
  | 'expansion' // entró por expansión de clave foránea desde una candidata
  | 'connector' // es un puente en el camino de FK entre anclas (modo 'paths')
  | 'fk-target' // es una tabla que un ancla referencia por FK: su dimensión de JOIN (modo 'paths')
  | 'selector' // la eligió el selector LLM, o completa un JOIN de lo que eligió
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
  /** Añadidas por expansión de FK a un salto (no eran candidatas ni conectores). */
  expansionAdded: ExpandedTable[]
  /** Puentes de JOIN en el camino de FK entre anclas (modo 'paths'); vacío en 'neighbors'. */
  connectorsAdded: ExpandedTable[]
  /** Dimensiones que un ancla referencia por FK, rescatadas del recorte (modo 'paths'). */
  fkTargetsAdded: ExpandedTable[]
  /**
   * Selección con LLM: si se INTENTÓ, el pool que vio y lo que eligió. `chosen` vacío delata
   * que el selector corrió pero no aportó nada (no eligió o falló) y se cayó al recorte.
   */
  selection: { poolSize: number; chosen: string[] } | null
  /** Contexto final tras el recorte, con motivo de inclusión. */
  finalContext: ContextTable[]
  /** El contexto real que usaría el pipeline (mismas tablas + DDL). */
  context: SchemaContext
  levers: {
    semanticTopK: number
    maxContextTables: number
    expansionMode: 'neighbors' | 'paths'
    maxPathLength: number
    /** Recuperación híbrida (denso + léxico por RRF) activa. */
    lexical: boolean
    /** Selección de esquema con LLM activa. */
    useSelector: boolean
    /** Tamaño del pool de candidatas que ve el selector. */
    poolSize: number
  }
}
