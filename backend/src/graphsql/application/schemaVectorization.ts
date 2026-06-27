/**
 * Caso de uso: vectorizar el esquema de una BD objetivo en pgvector.
 *
 * Leo el esquema, compongo un texto por tabla (nombre + columnas, y descripción
 * si se aporta), lo embebo con el modelo configurado y lo guardo en pgvector
 * junto al modelo y la dimensión usados. Reconstruyo el índice entero.
 *
 * Recibo como dependencias el lector de esquema y el almacén (con implementación
 * real por defecto), para poder probar la orquestación con dobles.
 */
import { TableEmbeddingsStore } from '../infrastructure/postgres/TableEmbeddingsStore'
import { readTargetSchema } from './readTargetSchema'
import { fullTableName, type TableSchema } from '../domain/schema/TableSchema'
import type { IEmbeddings } from '../domain/ports/IEmbeddings'
import type { IEmbeddingsStore } from '../domain/ports/IEmbeddingsStore'
import type { TargetDatabaseConfig } from '../infrastructure/config/targetDatabases'

export interface VectorizationSummary {
  count: number
  provider: string
  model: string
  dimensions: number
}

/** Lo que necesita la vectorización del mundo exterior. */
export interface SchemaVectorizationDependencies {
  readSchema(target: TargetDatabaseConfig): Promise<TableSchema[]>
  openEmbeddingsStore(): Promise<IEmbeddingsStore>
}

/** Implementación real: Postgres para leer el esquema, pgvector para guardar. */
export const defaultSchemaVectorizationDependencies: SchemaVectorizationDependencies = {
  readSchema: readTargetSchema,
  openEmbeddingsStore: () => TableEmbeddingsStore.fromEnv(),
}

/** Texto que represento de cada tabla para la búsqueda semántica. */
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
  // 1. Leer el esquema de la BD objetivo.
  const tables = await deps.readSchema(target)

  // 2. Componer los textos y embeberlos (una sola llamada).
  const texts = tables.map((table) => composeSearchText(table, descriptions?.get(table.name)))
  const vectors = await embeddings.embedMany(texts)

  // 3. Reconstruir el índice y guardar cada tabla con su vector.
  const store = await deps.openEmbeddingsStore()
  try {
    await store.prepare(embeddings.dimensions)
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
