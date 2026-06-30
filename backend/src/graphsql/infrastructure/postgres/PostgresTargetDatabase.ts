import { Client } from 'pg'
import Cursor from 'pg-cursor'
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

  static async fromParams(
    params: ConnectionParams,
    options: { statementTimeoutMs?: number } = {},
  ): Promise<PostgresTargetDatabase> {
    const client = new Client(params)
    await client.connect()
    await client.query('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY')
    if (options.statementTimeoutMs !== undefined) {
      await client.query(`SET statement_timeout = ${options.statementTimeoutMs}`)
    }
    return new PostgresTargetDatabase(client)
  }

  async fetchAll<T extends Record<string, unknown>>(
    sql: string,
    params: unknown[] = []
  ): Promise<T[]> {
    const result = await this.client.query<T>(sql, params)
    return result.rows
  }

  async fetchCapped<T extends Record<string, unknown>>(
    sql: string,
    maxRows: number,
  ): Promise<{ rows: T[]; truncated: boolean }> {
    // Con un cursor leo solo maxRows+1 filas de la BD (sin traerme todo el
    // resultado); si llega esa de más, es que había más que el tope.
    const cursor = this.client.query(new Cursor(stripTrailingSemicolon(sql)))
    try {
      const read = await readFromCursor<T>(cursor, maxRows + 1)
      const truncated = read.length > maxRows
      return { rows: truncated ? read.slice(0, maxRows) : read, truncated }
    } finally {
      await closeCursor(cursor)
    }
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

/** Leo hasta `count` filas del cursor (envuelvo la API de callback en una promesa). */
function readFromCursor<T extends Record<string, unknown>>(cursor: Cursor, count: number): Promise<T[]> {
  return new Promise((resolve, reject) => {
    cursor.read(count, (error: Error | undefined, rows: unknown[]) => {
      if (error) reject(error)
      else resolve(rows as T[])
    })
  })
}

/** Cierro el cursor (envuelvo la API de callback en una promesa). */
function closeCursor(cursor: Cursor): Promise<void> {
  return new Promise((resolve, reject) => {
    cursor.close((error?: Error) => (error ? reject(error) : resolve()))
  })
}

/** Quito un único `;` final para que el cursor (protocolo extendido) no se queje. */
function stripTrailingSemicolon(sql: string): string {
  return sql.trim().replace(/;\s*$/, '')
}
