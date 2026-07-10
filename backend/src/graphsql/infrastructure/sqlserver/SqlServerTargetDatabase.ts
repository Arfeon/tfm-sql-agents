import * as mssql from 'mssql'
import type { ITargetDatabase } from '../../domain/ports/ITargetDatabase'
import { stripTrailingSemicolon } from '../targetdb/sqlText'

interface ConnectionParams {
  host: string
  port: number
  database: string
  user: string
  password: string
}

/**
 * Adaptador de SQL Server para el puerto `ITargetDatabase`. La lectura efectiva de
 * "solo lectura" la garantiza el usuario de conexión (rol `db_datareader`) más la
 * comprobación de seguridad del Judge; SQL Server no tiene un equivalente exacto al
 * `SET TRANSACTION READ ONLY` de PostgreSQL.
 */
export class SqlServerTargetDatabase implements ITargetDatabase {
  private constructor(private readonly pool: mssql.ConnectionPool) {}

  static async fromParams(
    params: ConnectionParams,
    options: { statementTimeoutMs?: number } = {},
  ): Promise<SqlServerTargetDatabase> {
    const pool = new mssql.ConnectionPool({
      server: params.host,
      port: params.port,
      database: params.database,
      user: params.user,
      password: params.password,
      // On-premise sin certificado de CA válido: cifro en tránsito pero no valido la cadena.
      options: { encrypt: true, trustServerCertificate: true },
      // Tope por consulta, análogo al `statement_timeout` de PostgreSQL.
      requestTimeout: options.statementTimeoutMs,
    })
    await pool.connect()
    return new SqlServerTargetDatabase(pool)
  }

  async fetchAll<T extends Record<string, unknown>>(
    sql: string,
    params: unknown[] = [],
  ): Promise<T[]> {
    const result = await this.bind(params).query<T>(sql)
    return result.recordset
  }

  async fetchCapped<T extends Record<string, unknown>>(
    sql: string,
    maxRows: number,
  ): Promise<{ rows: T[]; truncated: boolean }> {
    // Leo en streaming y corto en cuanto paso del tope, sin traerme todo el resultado.
    const request = this.pool.request()
    request.stream = true
    const rows: T[] = []
    let truncated = false

    return new Promise((resolve, reject) => {
      let settled = false
      const settle = (action: () => void): void => {
        if (!settled) {
          settled = true
          action()
        }
      }
      request.on('row', (row: T) => {
        if (rows.length >= maxRows) {
          truncated = true
          request.cancel()
          return
        }
        rows.push(row)
      })
      request.on('error', (error: Error) => {
        // Al cancelar tras alcanzar el tope, mssql emite un error de cancelación: es lo esperado.
        if (truncated) settle(() => resolve({ rows, truncated }))
        else settle(() => reject(error))
      })
      request.on('done', () => settle(() => resolve({ rows, truncated })))
      // El control va por eventos; la promesa de query() también rechaza al cancelar, la ignoro.
      request.query(stripTrailingSemicolon(sql)).catch(() => {})
    })
  }

  async dryRun(sql: string): Promise<void> {
    // `dm_exec_describe_first_result_set` analiza y vincula la consulta (comprueba
    // sintaxis y que tablas/columnas existan) sin ejecutarla; si no es válida, lanza.
    const request = this.pool.request()
    request.input('tsql', stripTrailingSemicolon(sql))
    await request.query('SELECT 1 FROM sys.dm_exec_describe_first_result_set(@tsql, NULL, 0)')
  }

  async rowCount(table: string): Promise<number> {
    const result = await this.pool
      .request()
      .query<{ count: number }>(`SELECT COUNT(*) AS count FROM ${table}`)
    return Number(result.recordset[0].count)
  }

  async close(): Promise<void> {
    await this.pool.close()
  }

  /** Vincula los parámetros posicionales como `@p1`, `@p2`… (el SQL debe usar esos nombres). */
  private bind(params: unknown[]): mssql.Request {
    const request = this.pool.request()
    params.forEach((value, index) => request.input(`p${index + 1}`, value))
    return request
  }
}
