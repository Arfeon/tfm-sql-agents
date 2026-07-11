/**
 * Vectoriza el esquema de una BD objetivo en pgvector. Reconstruye el índice entero
 * y guarda el modelo y la dimensión usados junto a los vectores.
 */
import { TableEmbeddingsStore } from '../../infrastructure/postgres/TableEmbeddingsStore'
import { readTargetSchema } from './readTargetSchema'
import { fullTableName, type TableSchema } from '../../domain/schema/TableSchema'
import type { IEmbeddings } from '../../domain/ports/IEmbeddings'
import type { IEmbeddingsStore } from '../../domain/ports/IEmbeddingsStore'
import type { TargetDatabaseConfig } from '../../infrastructure/config/targetDatabases'

export interface VectorizationSummary {
  count: number
  provider: string
  model: string
  dimensions: number
}

export interface SchemaVectorizationDependencies {
  readSchema(target: TargetDatabaseConfig): Promise<TableSchema[]>
  openEmbeddingsStore(): Promise<IEmbeddingsStore>
}

export const defaultSchemaVectorizationDependencies: SchemaVectorizationDependencies = {
  readSchema: readTargetSchema,
  openEmbeddingsStore: () => TableEmbeddingsStore.fromEnv(),
}

/** El texto que representa a cada tabla en la búsqueda semántica. */
export function composeSearchText(table: TableSchema, description?: string): string {
  const columns = table.columns.map((column) => column.name).join(', ')
  const parts = [`Tabla: ${table.name}`]
  if (description) {
    parts.push(`Descripción: ${description}`)
  }
  parts.push(`Columnas: ${columns}`)
  return parts.join('. ')
}

export async function vectorizeSchema(
  target: TargetDatabaseConfig,
  provider: string,
  embeddings: IEmbeddings,
  descriptions?: Map<string, string>,
  deps: SchemaVectorizationDependencies = defaultSchemaVectorizationDependencies,
): Promise<VectorizationSummary> {
  const tables = await deps.readSchema(target)

  const texts = tables.map((table) => composeSearchText(table, descriptions?.get(table.name)))
  const vectors = await embeddings.embedMany(texts)

  // El índice queda anotado con la BD de la que viene (SPEC-18).
  const store = await deps.openEmbeddingsStore()
  try {
    await store.prepare(embeddings.dimensions, target.name)
    for (let i = 0; i < tables.length; i++) {
      const table = tables[i]
      const description = descriptions?.get(table.name) ?? null
      await store.upsertTable(table.name, fullTableName(table), provider, description, texts[i], vectors[i], embeddings.model, embeddings.dimensions)
    }
    return { count: await store.count(), provider, model: embeddings.model, dimensions: embeddings.dimensions }
  } finally {
    await store.close()
  }
}
