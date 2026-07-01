/**
 * Caso de uso: recuperar el contexto de esquema para una pregunta (GraphRAG, SPEC-04).
 *
 * Tres pasos: ordeno las tablas por significado (vectores en pgvector), tomo las
 * top-K como candidatas y las expando por claves foráneas en el grafo (Neo4j) para
 * traer las vecinas que hacen falta en los JOIN. Después ACOTO: ordeno el conjunto
 * expandido por similitud y me quedo con un máximo de tablas, para no arrastrar
 * todas las vecinas de una tabla muy conectada (p. ej. `customer`).
 *
 * Recibo como dependencias el ranking y la expansión (con implementación real por
 * defecto), para probar la orquestación con dobles. El ranking consulta con el
 * MISMO modelo de embeddings con el que se indexó (lo lee del propio índice).
 */
import { TableEmbeddingsStore } from '../infrastructure/postgres/TableEmbeddingsStore'
import { EmbeddingsFactory } from '../infrastructure/embeddings/EmbeddingsFactory'
import { Neo4jConnection } from '../infrastructure/neo4j/Neo4jConnection'
import { SchemaGraphManager } from '../infrastructure/neo4j/SchemaGraphManager'
import { buildSchemaContext, type SchemaContext } from '../domain/schema/SchemaContext'
import type { TableSchema } from '../domain/schema/TableSchema'
import type { TableMatch } from '../domain/ports/IEmbeddingsStore'

/** Cuántas tablas candidatas por significado tomo antes de expandir por FK. */
export const SEMANTIC_TOP_K = 5

/** Tope de tablas en el contexto final (las mejores tras expandir). Debe ser ≥ SEMANTIC_TOP_K. */
export const MAX_CONTEXT_TABLES = 8

export interface SchemaRetrievalOptions {
  topK?: number
  maxTables?: number
  /**
   * Tablas que el humano fija a mano (SPEC-08): entran en el contexto sí o sí,
   * aunque el ranking no las traiga, siempre que existan en el esquema. Las que
   * no existen se ignoran (no fijo un fantasma).
   */
  mustInclude?: string[]
}

/** Lo que necesita la recuperación del mundo exterior. */
export interface SchemaRetrievalDependencies {
  /** Todas las tablas ordenadas por similitud a la pregunta (con su score). */
  rankTablesBySimilarity(question: string): Promise<TableMatch[]>
  /** Dadas unas tablas, devuelve esas + sus vecinas por FK, con columnas y claves. */
  expandByForeignKeys(tableNames: string[]): Promise<TableSchema[]>
}

/** Implementación real: pgvector para puntuar, Neo4j para expandir. */
export const defaultSchemaRetrievalDependencies: SchemaRetrievalDependencies = {
  async rankTablesBySimilarity(question) {
    const store = await TableEmbeddingsStore.fromEnv()
    try {
      const indexed = await store.getIndexedModel()
      if (!indexed) {
        throw new Error(
          'No hay esquema vectorizado todavía. Escanea y vectoriza la BD objetivo primero (CLI → "Escanear el esquema").',
        )
      }
      // Consulto con el mismo modelo con que indexé (mismo espacio vectorial).
      const embeddings = EmbeddingsFactory.forIndexedModel(indexed)
      const vector = await embeddings.embed(question)
      const total = await store.count()
      return await store.searchSimilar(vector, total)
    } finally {
      await store.close()
    }
  },
  async expandByForeignKeys(tableNames) {
    const neo4j = Neo4jConnection.fromEnv()
    try {
      return await new SchemaGraphManager(neo4j).getTablesWithForeignKeyNeighbors(tableNames)
    } finally {
      await neo4j.close()
    }
  },
}

/** Recupero el contexto de esquema relevante para una pregunta. */
export async function retrieveSchemaContext(
  question: string,
  deps: SchemaRetrievalDependencies = defaultSchemaRetrievalDependencies,
  options: SchemaRetrievalOptions = {},
): Promise<SchemaContext> {
  const topK = options.topK ?? SEMANTIC_TOP_K
  const maxTables = options.maxTables ?? MAX_CONTEXT_TABLES

  // 1. Ordeno todas las tablas por similitud a la pregunta.
  const ranked = await deps.rankTablesBySimilarity(question)
  const scoreByName = new Map(ranked.map((match) => [match.tableName, match.score]))

  // Tablas fijadas por el humano que existen de verdad (las demás se ignoran).
  const pinned = (options.mustInclude ?? []).filter((name) => scoreByName.has(name))

  // 2. Las candidatas son las top-K por significado más las fijadas; expando por FK.
  const candidateNames = [...new Set([...pinned, ...ranked.slice(0, topK).map((match) => match.tableName)])]
  const expanded = await deps.expandByForeignKeys(candidateNames)

  // 3. Acoto por similitud, pero las fijadas nunca se caen del contexto.
  const pinnedSet = new Set(pinned)
  const byScore = (a: TableSchema, b: TableSchema) => (scoreByName.get(b.name) ?? 0) - (scoreByName.get(a.name) ?? 0)
  const pinnedTables = expanded.filter((table) => pinnedSet.has(table.name))
  const rest = expanded.filter((table) => !pinnedSet.has(table.name)).sort(byScore)
  const limited = [...pinnedTables, ...rest].slice(0, Math.max(maxTables, pinnedTables.length))

  return buildSchemaContext(limited)
}
