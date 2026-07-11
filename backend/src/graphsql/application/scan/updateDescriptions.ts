/**
 * Actualización incremental de descripciones (SPEC-29): re-vectoriza SOLO las tablas
 * cuya descripción cambió respecto a lo indexado, y deja Neo4j y pgvector con la misma
 * descripción. Nunca reconstruye el índice ni mezcla modelos: usa el del índice actual.
 * El diff es automático — el índice guarda la descripción junto a cada vector.
 */
import { TableEmbeddingsStore, type IndexedModel } from '../../infrastructure/postgres/TableEmbeddingsStore'
import { Neo4jConnection } from '../../infrastructure/neo4j/Neo4jConnection'
import { SchemaGraphManager } from '../../infrastructure/neo4j/SchemaGraphManager'
import { EmbeddingsFactory } from '../../infrastructure/embeddings/EmbeddingsFactory'
import { readTargetSchema } from './readTargetSchema'
import { composeSearchText } from './schemaVectorization'
import { fullTableName, type TableSchema } from '../../domain/schema/TableSchema'
import type { IEmbeddings } from '../../domain/ports/IEmbeddings'
import type { TargetDatabaseConfig } from '../../infrastructure/config/targetDatabases'

/** El diff entre lo indexado y el JSON: qué tablas hay que re-embeber y por qué. */
export interface DescriptionsDiff {
  /** Tabla indexada sin descripción que ahora tiene una. */
  added: string[]
  /** Tabla indexada cuya descripción cambió de texto. */
  changed: string[]
  /** Tabla indexada con descripción que ya no está en el JSON (se re-embebe sin ella). */
  removed: string[]
  /** Entradas del JSON que no corresponden a ninguna tabla indexada (p. ej. de otra BD). */
  unknown: string[]
}

export interface UpdateDescriptionsSummary {
  diff: DescriptionsDiff
  /** Embeddings gastados (= added + changed + removed) sobre el total de tablas indexadas. */
  embedded: number
  totalIndexed: number
  model: string
}

/**
 * Comparación pura entre las descripciones indexadas (tabla → descripción o null)
 * y las entrantes del JSON. Es la única fuente del "qué se re-embebe".
 */
export function diffDescriptions(
  indexed: Map<string, string | null>,
  incoming: Map<string, string>,
): DescriptionsDiff {
  const added: string[] = []
  const changed: string[] = []
  const removed: string[] = []
  const unknown: string[] = []

  for (const [tableName, description] of incoming) {
    if (!indexed.has(tableName)) {
      unknown.push(tableName)
    } else if (indexed.get(tableName) === null) {
      added.push(tableName)
    } else if (indexed.get(tableName) !== description) {
      changed.push(tableName)
    }
  }
  for (const [tableName, description] of indexed) {
    if (description !== null && !incoming.has(tableName)) {
      removed.push(tableName)
    }
  }
  return { added, changed, removed, unknown }
}

export interface UpdateDescriptionsDependencies {
  readIndexedModel(): Promise<IndexedModel | null>
  readIndexedDescriptions(): Promise<Map<string, string | null>>
  readSchema(target: TargetDatabaseConfig): Promise<TableSchema[]>
  embeddingsForIndex(indexed: IndexedModel): IEmbeddings
  /** Upsert de las filas re-embebidas en pgvector (sin `prepare`: el índice no se reconstruye). */
  upsertEmbeddings(rows: EmbeddingUpsert[]): Promise<void>
  /** La misma descripción, al grafo (escaneo atómico: los dos almacenes juntos). */
  updateGraphDescriptions(changes: Map<string, string | null>): Promise<void>
}

export interface EmbeddingUpsert {
  table: TableSchema
  description: string | null
  searchText: string
  vector: number[]
}

export const defaultUpdateDescriptionsDependencies: UpdateDescriptionsDependencies = {
  async readIndexedModel() {
    const store = await TableEmbeddingsStore.fromEnv()
    try {
      return await store.getIndexedModel()
    } finally {
      await store.close()
    }
  },
  async readIndexedDescriptions() {
    const store = await TableEmbeddingsStore.fromEnv()
    try {
      return await store.getIndexedDescriptions()
    } finally {
      await store.close()
    }
  },
  readSchema: readTargetSchema,
  embeddingsForIndex: (indexed) => EmbeddingsFactory.forIndexedModel(indexed),
  async upsertEmbeddings(rows) {
    const store = await TableEmbeddingsStore.fromEnv()
    try {
      const indexed = await store.getIndexedModel()
      if (!indexed) {
        throw new Error('El índice desapareció durante la actualización.')
      }
      for (const row of rows) {
        await store.upsertTable(
          row.table.name,
          fullTableName(row.table),
          indexed.provider,
          row.description,
          row.searchText,
          row.vector,
          indexed.model,
          indexed.dimensions,
        )
      }
    } finally {
      await store.close()
    }
  },
  async updateGraphDescriptions(changes) {
    const neo4j = Neo4jConnection.fromEnv()
    try {
      await new SchemaGraphManager(neo4j).updateTableDescriptions(changes)
    } finally {
      await neo4j.close()
    }
  },
}

export async function updateIndexedDescriptions(
  target: TargetDatabaseConfig,
  descriptions: Map<string, string>,
  deps: UpdateDescriptionsDependencies = defaultUpdateDescriptionsDependencies,
): Promise<UpdateDescriptionsSummary> {
  const indexedModel = await deps.readIndexedModel()
  if (!indexedModel) {
    throw new Error('No hay índice vectorial: haz primero un escaneo completo.')
  }
  if (indexedModel.targetName !== target.name) {
    throw new Error(
      `El índice actual es de "${indexedModel.targetName ?? 'desconocida'}", no de "${target.name}": la actualización incremental necesita un escaneo completo previo de la misma BD.`,
    )
  }

  const indexedDescriptions = await deps.readIndexedDescriptions()
  const diff = diffDescriptions(indexedDescriptions, descriptions)
  const affectedNames = [...diff.added, ...diff.changed, ...diff.removed]
  const summaryBase = { diff, totalIndexed: indexedDescriptions.size, model: indexedModel.model }

  // Sin cambios no se llama al proveedor de embeddings: ese es el contrato de coste.
  if (affectedNames.length === 0) {
    return { ...summaryBase, embedded: 0 }
  }

  // El search_text necesita las columnas reales (SQL gratis); solo lo afectado se embebe.
  const schemaByName = new Map((await deps.readSchema(target)).map((table) => [table.name, table]))
  const affected = affectedNames
    .map((name) => schemaByName.get(name))
    .filter((table): table is TableSchema => table !== undefined)

  const embeddings = deps.embeddingsForIndex(indexedModel)
  const texts = affected.map((table) => composeSearchText(table, descriptions.get(table.name)))
  const vectors = await embeddings.embedMany(texts)

  const rows: EmbeddingUpsert[] = affected.map((table, i) => ({
    table,
    description: descriptions.get(table.name) ?? null,
    searchText: texts[i],
    vector: vectors[i],
  }))
  await deps.upsertEmbeddings(rows)
  await deps.updateGraphDescriptions(new Map(rows.map((row) => [row.table.name, row.description])))

  return { ...summaryBase, embedded: rows.length }
}
