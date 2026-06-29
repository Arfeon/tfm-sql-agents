/**
 * Almacén de embeddings de tablas en PostgreSQL + pgvector.
 *
 * Guarda, por cada tabla, el texto de búsqueda, su vector y el modelo/dimensión
 * con que se generó. Vivo en la base `graphsql_memory` (la misma que usaré para
 * los checkpoints), no en la BD objetivo.
 *
 * `prepare` reconstruye la tabla desde cero (cada vectorización re-vectoriza
 * todo), así no tengo que lidiar con cambios de dimensión a medias.
 */
import { Client } from 'pg'
import type { IEmbeddingsStore, TableMatch } from '../../domain/ports/IEmbeddingsStore'

export interface IndexedModel {
  provider: string
  model: string
  dimensions: number
}

export class TableEmbeddingsStore implements IEmbeddingsStore {
  private constructor(private readonly client: Client) {}

  static async fromEnv(env: NodeJS.ProcessEnv = process.env): Promise<TableEmbeddingsStore> {
    const client = new Client({
      host: env.POSTGRES_HOST ?? 'localhost',
      port: parseInt(env.POSTGRES_PORT ?? '5432', 10),
      database: env.POSTGRES_DB ?? 'graphsql_memory',
      user: env.POSTGRES_USER ?? 'postgres',
      password: env.POSTGRES_PASSWORD ?? 'postgres',
    })
    await client.connect()
    return new TableEmbeddingsStore(client)
  }

  /** Lee el modelo/dimensión del índice actual, o null si está vacío. */
  async getIndexedModel(): Promise<IndexedModel | null> {
    const exists = await this.client.query<{ exists: boolean }>(
      "SELECT to_regclass('public.table_embeddings') IS NOT NULL AS exists",
    )
    if (!exists.rows[0].exists) {
      return null
    }
    const result = await this.client.query<IndexedModel>(
      'SELECT provider, model, dimensions FROM table_embeddings LIMIT 1',
    )
    return result.rows[0] ?? null
  }

  /** Reconstruye la tabla de embeddings con la dimensión indicada. */
  async prepare(dimensions: number): Promise<void> {
    if (!Number.isInteger(dimensions) || dimensions <= 0) {
      throw new Error(`Dimensión de embeddings inválida: ${dimensions}`)
    }
    await this.client.query('CREATE EXTENSION IF NOT EXISTS vector')
    await this.client.query('DROP TABLE IF EXISTS table_embeddings')
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
      [tableName, fullName, provider, description, searchText, `[${embedding.join(',')}]`, model, dimensions],
    )
  }

  /** Las `limit` tablas más parecidas al vector, por distancia coseno */
  async searchSimilar(embedding: number[], limit: number): Promise<TableMatch[]> {
    const result = await this.client.query<{ table_name: string; score: number }>(
      `SELECT table_name, 1 - (embedding <=> $1::vector) AS score
       FROM table_embeddings
       ORDER BY embedding <=> $1::vector
       LIMIT $2`,
      [`[${embedding.join(',')}]`, limit],
    )
    return result.rows.map((row) => ({ tableName: row.table_name, score: Number(row.score) }))
  }

  async count(): Promise<number> {
    const result = await this.client.query<{ count: string }>('SELECT COUNT(*) AS count FROM table_embeddings')
    return parseInt(result.rows[0].count, 10)
  }

  async close(): Promise<void> {
    await this.client.end()
  }
}
