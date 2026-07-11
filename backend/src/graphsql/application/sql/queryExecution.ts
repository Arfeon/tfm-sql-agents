/**
 * Ejecuta una consulta ya validada contra la BD objetivo (SPEC-07). Aquí vive la
 * última barrera de seguridad: re-compruebo que sea de solo lectura antes de tocar
 * la BD, además la sesión es read-only y hay tope de filas y statement_timeout.
 */
import { TargetDatabaseFactory } from '../../infrastructure/targetdb/TargetDatabaseFactory'
import { checkSqlSafety } from '../../domain/sql/SqlSafetyPolicy'
import { UnsafeQueryError } from '../../domain/sql/UnsafeQueryError'
import type { ITargetDatabase } from '../../domain/ports/ITargetDatabase'
import type { SqlStatement } from '../../domain/sql/SqlStatement'
import type { QueryResult } from '../../domain/sql/QueryResult'

/** Por encima de este tope, el resultado se marca como truncado. */
export const MAX_RESULT_ROWS = 1000
export const STATEMENT_TIMEOUT_MS = 15_000

export interface QueryExecutionOptions {
  maxRows?: number
  timeoutMs?: number
}

export interface QueryExecutionDependencies {
  /** La conexión que abre es de solo lectura. */
  connectDatabase(options: { statementTimeoutMs: number }): Promise<ITargetDatabase>
}

export const defaultQueryExecutionDependencies: QueryExecutionDependencies = {
  connectDatabase: (options) => TargetDatabaseFactory.connectDefault(options),
}

export async function executeQuery(
  sql: SqlStatement,
  options: QueryExecutionOptions = {},
  deps: QueryExecutionDependencies = defaultQueryExecutionDependencies,
): Promise<QueryResult> {
  // Última barrera de seguridad: si no es de solo lectura, no toco la BD.
  const safety = checkSqlSafety(sql.text)
  if (!safety.valid) {
    throw new UnsafeQueryError(safety.errors)
  }

  const maxRows = options.maxRows ?? MAX_RESULT_ROWS
  const timeoutMs = options.timeoutMs ?? STATEMENT_TIMEOUT_MS

  const db = await deps.connectDatabase({ statementTimeoutMs: timeoutMs })
  try {
    const { rows, truncated } = await db.fetchCapped(sql.text, maxRows)
    return {
      columns: rows.length > 0 ? Object.keys(rows[0]) : [],
      rows,
      rowCount: rows.length,
      truncated,
    }
  } finally {
    await db.close()
  }
}
