/**
 * Caso de uso: vectorizar el esquema de una BD objetivo en pgvector.
 *
 * Lee el esquema, compone un texto por tabla (nombre + columnas, y descripción
 * si se aporta), lo embebe con el modelo configurado y lo guarda en pgvector
 * junto al modelo y la dimensión usados. Reconstruye el índice entero.
 */
import { PostgresTargetDatabase } from '../infrastructure/postgres/PostgresTargetDatabase'
import { PostgresSchemaReader } from '../infrastructure/postgres/PostgresSchemaReader'
import { TableEmbeddingsStore } from '../infrastructure/postgres/TableEmbeddingsStore'
import type { IEmbeddings } from '../domain/ports/IEmbeddings'
import type { TableSchema } from '../domain/schema/TableSchema'
import type { TargetDatabaseConfig } from '../infrastructure/config/targetDatabases'

export interface VectorizationSummary {
  count: number
  provider: string
  model: string
  dimensions: number
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
): Promise<VectorizationSummary> {
  if (target.type !== 'postgresql') {
    throw new Error(`Tipo de BD objetivo no soportado todavía: "${target.type}". De momento solo PostgreSQL.`)
  }

  // 1. Leer el esquema de la BD objetivo.
  const db = await PostgresTargetDatabase.fromParams({
    host: target.host,
    port: target.port,
    database: target.name,
    user: target.user,
    password: target.password,
  })
  let tables: TableSchema[]
  try {
    tables = await new PostgresSchemaReader(db, target.schema).readSchema()
  } finally {
    await db.close()
  }

  // 2. Componer los textos y embeberlos (una sola llamada).
  const texts = tables.map((table) => composeSearchText(table, descriptions?.get(table.name)))
  const vectors = await embeddings.embedMany(texts)

  // 3. Reconstruir el índice y guardar cada tabla con su vector.
  const store = await TableEmbeddingsStore.fromEnv()
  try {
    await store.prepare(embeddings.dimensions)
    for (let i = 0; i < tables.length; i++) {
      const table = tables[i]
      const fullName = table.schema ? `${table.schema}.${table.name}` : table.name
      const description = descriptions?.get(table.name) ?? null
      await store.upsertTable(table.name, fullName, provider, description, texts[i], vectors[i], embeddings.model, embeddings.dimensions)
    }
    return { count: await store.count(), provider, model: embeddings.model, dimensions: embeddings.dimensions }
  } finally {
    await store.close()
  }
}
