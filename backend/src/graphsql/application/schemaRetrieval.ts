/**
 * Recuperación GraphRAG del contexto de esquema (SPEC-04): top-K por significado,
 * expansión por FK en el grafo y acotación final por similitud, para no arrastrar
 * todas las vecinas de una tabla muy conectada (p. ej. `customer`).
 */
import { TableEmbeddingsStore } from '../infrastructure/postgres/TableEmbeddingsStore'
import { EmbeddingsFactory } from '../infrastructure/embeddings/EmbeddingsFactory'
import { Neo4jConnection } from '../infrastructure/neo4j/Neo4jConnection'
import { SchemaGraphManager } from '../infrastructure/neo4j/SchemaGraphManager'
import { buildSchemaContext, type SchemaContext } from '../domain/schema/SchemaContext'
import type { TableSchema } from '../domain/schema/TableSchema'
import type { TableMatch } from '../domain/ports/IEmbeddingsStore'
import type { RetrievalTrace, RankedTable, ExpandedTable, ContextTable, InclusionReason } from '../domain/schema/RetrievalTrace'

/** Candidatas por significado antes de expandir por FK. */
export const SEMANTIC_TOP_K = 5

/** Tope del contexto final. Debe ser ≥ SEMANTIC_TOP_K. */
export const MAX_CONTEXT_TABLES = 8

export interface SchemaRetrievalOptions {
  topK?: number
  maxTables?: number
  /** Tablas fijadas a mano (SPEC-08): entran sí o sí si existen; las inexistentes se ignoran. */
  mustInclude?: string[]
}

export interface SchemaRetrievalDependencies {
  /** Devuelve TODAS las tablas ordenadas por similitud, no solo las top-K. */
  rankTablesBySimilarity(question: string): Promise<TableMatch[]>
  /** Devuelve las tablas dadas + sus vecinas por FK. */
  expandByForeignKeys(tableNames: string[]): Promise<TableSchema[]>
}

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

interface RetrievalInternals {
  topK: number
  maxTables: number
  ranked: TableMatch[]
  scoreByName: Map<string, number>
  pinned: string[]
  topKNames: string[]
  candidateNames: string[]
  expanded: TableSchema[]
  limited: TableSchema[]
}

function uniqueNames(first: string[], second: string[]): string[] {
  return Array.from(new Set(first.concat(second)))
}

/**
 * Circuito único compartido por `retrieveSchemaContext` y `explainSchemaRetrieval`:
 * la explicación es exactamente la recuperación del pipeline, no una réplica.
 */
async function runRetrieval(
  question: string,
  deps: SchemaRetrievalDependencies,
  options: SchemaRetrievalOptions,
): Promise<RetrievalInternals> {
  const topK = options.topK ?? SEMANTIC_TOP_K
  const maxTables = options.maxTables ?? MAX_CONTEXT_TABLES

  const ranked = await deps.rankTablesBySimilarity(question)
  const scoreByName = new Map(ranked.map((match) => [match.tableName, match.score]))

  const pinned = (options.mustInclude ?? []).filter((name) => scoreByName.has(name))

  const topKNames = ranked.slice(0, topK).map((match) => match.tableName)
  const candidateNames = uniqueNames(pinned, topKNames)
  const expanded = await deps.expandByForeignKeys(candidateNames)

  // Acoto por similitud, pero las fijadas nunca se caen del contexto.
  const pinnedSet = new Set(pinned)
  const scoreOf = (table: TableSchema) => scoreByName.get(table.name) ?? 0
  const byScoreDescending = (a: TableSchema, b: TableSchema) => scoreOf(b) - scoreOf(a)
  const pinnedTables = expanded.filter((table) => pinnedSet.has(table.name))
  const rest = expanded.filter((table) => !pinnedSet.has(table.name)).sort(byScoreDescending)
  const limited = [...pinnedTables, ...rest].slice(0, Math.max(maxTables, pinnedTables.length))

  return { topK, maxTables, ranked, scoreByName, pinned, topKNames, candidateNames, expanded, limited }
}

export async function retrieveSchemaContext(
  question: string,
  deps: SchemaRetrievalDependencies = defaultSchemaRetrievalDependencies,
  options: SchemaRetrievalOptions = {},
): Promise<SchemaContext> {
  const { limited } = await runRetrieval(question, deps, options)
  return buildSchemaContext(limited)
}

/**
 * Igual que `retrieveSchemaContext`, pero con la traza del circuito (SPEC-13).
 * No altera la recuperación: compone la traza sobre los mismos pasos.
 */
export async function explainSchemaRetrieval(
  question: string,
  deps: SchemaRetrievalDependencies = defaultSchemaRetrievalDependencies,
  options: SchemaRetrievalOptions = {},
): Promise<RetrievalTrace> {
  const internals = await runRetrieval(question, deps, options)
  const { ranked, scoreByName, pinned, topKNames, candidateNames, expanded, limited } = internals

  const topKSet = new Set(topKNames)
  const pinnedSet = new Set(pinned)
  const candidateSet = new Set(candidateNames)

  const ranking: RankedTable[] = ranked.map((match) => ({
    tableName: match.tableName,
    score: match.score,
    isCandidate: topKSet.has(match.tableName),
  }))

  // Las que entraron como vecinas por FK (no eran candidatas), con su score semántico.
  const expansionAdded: ExpandedTable[] = expanded
    .filter((table) => !candidateSet.has(table.name))
    .map((table) => ({ tableName: table.name, score: scoreByName.get(table.name) ?? 0 }))
    .sort((a, b) => b.score - a.score)

  const reasonFor = (name: string): InclusionReason => {
    if (pinnedSet.has(name)) return 'pinned'
    if (topKSet.has(name)) return 'semantic'
    return 'expansion'
  }

  const finalContext: ContextTable[] = limited.map((table) => ({
    tableName: table.name,
    score: scoreByName.get(table.name) ?? 0,
    reason: reasonFor(table.name),
  }))

  return {
    question,
    ranking,
    candidates: topKNames,
    expansionAdded,
    finalContext,
    context: buildSchemaContext(limited),
    levers: { semanticTopK: internals.topK, maxContextTables: internals.maxTables },
  }
}
