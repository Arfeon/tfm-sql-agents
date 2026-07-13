/**
 * Almacén de embeddings de tablas (PostgreSQL + pgvector), en la base `graphsql_memory`, no
 * en la BD objetivo. Guarda por tabla el texto de búsqueda, su vector y el modelo/dimensión.
 * `prepare` reconstruye la tabla desde cero: cada vectorización re-vectoriza todo.
 */
import { Client } from 'pg'
import { z } from 'zod'
import { loadEnv } from '../config/env'
import type { IEmbeddingsStore, TableMatch } from '../../domain/ports/IEmbeddingsStore'

export interface IndexedModel {
  provider: string
  model: string
  dimensions: number
  /** BD objetivo cuyo esquema contiene el índice; null en índices anteriores a SPEC-18. */
  targetName: string | null
}

/**
 * Fila con el modelo del índice: decide en qué espacio vectorial se consulta (SPEC-04),
 * así que la valido en vez de fiarme del tipo. `target_name` falta antes de SPEC-18 (→ null).
 */
const indexedModelRow = z.object({
  provider: z.string(),
  model: z.string(),
  dimensions: z.number().int().positive(),
  target_name: z.string().nullable(),
})

/** Representación textual de un vector para pgvector: `[v1,v2,…]`. */
function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`
}

export class TableEmbeddingsStore implements IEmbeddingsStore {
  private constructor(private readonly client: Client) {}

  static async fromEnv(env: NodeJS.ProcessEnv = process.env): Promise<TableEmbeddingsStore> {
    const vars = loadEnv(env)
    const client = new Client({
      host: vars.POSTGRES_HOST,
      port: vars.POSTGRES_PORT,
      database: vars.POSTGRES_DB,
      user: vars.POSTGRES_USER,
      password: vars.POSTGRES_PASSWORD,
    })
    await client.connect()
    return new TableEmbeddingsStore(client)
  }

  /** Lee el modelo/dimensión (y de qué BD es) del índice actual, o null si está vacío. */
  async getIndexedModel(): Promise<IndexedModel | null> {
    const exists = await this.client.query<{ exists: boolean }>(
      "SELECT to_regclass('public.table_embeddings') IS NOT NULL AS exists",
    )
    if (!exists.rows[0].exists) {
      return null
    }
    // `target_name` no existía antes de SPEC-18: en un índice viejo la columna falta,
    // así que la leo de forma tolerante y la devuelvo como null ("desconocido").
    const result = await this.client.query(
      `SELECT provider, model, dimensions,
              (to_jsonb(table_embeddings) ->> 'target_name') AS target_name
       FROM table_embeddings LIMIT 1`,
    )
    if (!result.rows[0]) {
      return null
    }
    const row = indexedModelRow.parse(result.rows[0])
    return { provider: row.provider, model: row.model, dimensions: row.dimensions, targetName: row.target_name }
  }

  /** La descripción guardada junto a cada vector (SPEC-29): es la base del diff incremental. */
  async getIndexedDescriptions(): Promise<Map<string, string | null>> {
    const result = await this.client.query<{ table_name: string; description: string | null }>(
      'SELECT table_name, description FROM table_embeddings',
    )
    return new Map(result.rows.map((row) => [row.table_name, row.description ?? null]))
  }

  /** Reconstruye la tabla de embeddings con la dimensión indicada, anotando de qué BD es. */
  async prepare(dimensions: number, targetName: string): Promise<void> {
    if (!Number.isInteger(dimensions) || dimensions <= 0) {
      throw new Error(`Dimensión de embeddings inválida: ${dimensions}`)
    }
    await this.client.query('CREATE EXTENSION IF NOT EXISTS vector')
    await this.client.query('DROP TABLE IF EXISTS table_embeddings')
    // La BD objetivo va como DEFAULT de la columna: el índice entero es de UNA BD
    // (se reconstruye completo en cada vectorización), así cada fila la lleva sin
    // tener que pasarla por `upsertTable`. Va escapada porque el DDL no admite $1.
    const escapedTargetName = this.client.escapeLiteral(targetName)
    await this.client.query(`
      CREATE TABLE table_embeddings (
        table_name TEXT PRIMARY KEY,
        full_name TEXT,
        description TEXT,
        search_text TEXT,
        embedding vector(${dimensions}),
        provider TEXT,
        model TEXT,
        dimensions INT,
        target_name TEXT DEFAULT ${escapedTargetName},
        updated_at TIMESTAMPTZ DEFAULT now()
      )
    `)
  }

  async upsertTable(
    tableName: string,
    fullName: string,
    provider: string,
    description: string | null,
    searchText: string,
    embedding: number[],
    model: string,
    dimensions: number,
  ): Promise<void> {
    await this.client.query(
      `INSERT INTO table_embeddings (table_name, full_name, provider, description, search_text, embedding, model, dimensions)
       VALUES ($1, $2, $3, $4, $5, $6::vector, $7, $8)
       ON CONFLICT (table_name) DO UPDATE SET
         full_name = EXCLUDED.full_name,
         provider = EXCLUDED.provider,
         description = EXCLUDED.description,
         search_text = EXCLUDED.search_text,
         embedding = EXCLUDED.embedding,
         model = EXCLUDED.model,
         dimensions = EXCLUDED.dimensions,
         updated_at = now()`,
      [tableName, fullName, provider, description, searchText, toVectorLiteral(embedding), model, dimensions],
    )
  }

  /** Las `limit` tablas más parecidas al vector, por distancia coseno */
  async searchSimilar(embedding: number[], limit: number): Promise<TableMatch[]> {
    const result = await this.client.query<{ table_name: string; score: number }>(
      `SELECT table_name, 1 - (embedding <=> $1::vector) AS score
       FROM table_embeddings
       ORDER BY embedding <=> $1::vector
       LIMIT $2`,
      [toVectorLiteral(embedding), limit],
    )
    return result.rows.map((row) => ({ tableName: row.table_name, score: Number(row.score) }))
  }

  /** Nombre + texto de búsqueda de todas las tablas, para el ranking léxico (schema linking híbrido). */
  async getAllTableTexts(): Promise<{ tableName: string; searchText: string }[]> {
    const result = await this.client.query<{ table_name: string; search_text: string | null }>(
      'SELECT table_name, search_text FROM table_embeddings',
    )
    return result.rows.map((row) => ({ tableName: row.table_name, searchText: row.search_text ?? '' }))
  }

  async count(): Promise<number> {
    const result = await this.client.query<{ count: string }>('SELECT COUNT(*) AS count FROM table_embeddings')
    return parseInt(result.rows[0].count, 10)
  }

  async close(): Promise<void> {
    await this.client.end()
  }
}
