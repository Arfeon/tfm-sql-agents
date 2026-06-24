import { Client } from 'pg'
import type { ITargetDatabase } from '../../domain/ports/ITargetDatabase'

interface ConnectionParams {
  host: string
  port: number
  database: string
  user: string
  password: string
}

export class PostgresTargetDatabase implements ITargetDatabase {
  private constructor(private readonly client: Client) {}

  static async fromParams(params: ConnectionParams): Promise<PostgresTargetDatabase> {
    const client = new Client(params)
    await client.connect()
    await client.query('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY')
    return new PostgresTargetDatabase(client)
  }

  async fetchAll<T extends Record<string, unknown>>(
    sql: string,
    params: unknown[] = []
  ): Promise<T[]> {
    const result = await this.client.query<T>(sql, params)
    return result.rows
  }

  async rowCount(table: string): Promise<number> {
    const result = await this.client.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM ${table}`
    )
    return parseInt(result.rows[0].count, 10)
  }

  async close(): Promise<void> {
    await this.client.end()
  }

  getClient(): Client {
    return this.client
  }
}
