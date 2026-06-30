/**
 * Caso de uso: ejecutar una consulta ya validada contra la BD objetivo (SPEC-07).
 *
 * Lo importante no es solo ejecutar, sino hacerlo sin poder hacer daño:
 *
 *  - Antes de tocar la BD, vuelvo a comprobar la seguridad (que sea de solo lectura).
 *    Si no lo es, lanzo `UnsafeQueryError` y no ejecuto. Es la última barrera: aunque
 *    algo se saltara las comprobaciones previas, una consulta peligrosa no llega a correr.
 *  - La sesión es de solo lectura (la abre así el adaptador de Postgres), de modo que
 *    una escritura fallaría en la propia BD.
 *  - Aplico un tope de filas (envuelvo la consulta y pido una fila de más para saber
 *    si había más y marcar el resultado como truncado) y un `statement_timeout`, para
 *    no traerme una tabla entera ni quedarme colgado en una consulta lenta.
 *
 * Recibo la ejecución contra la BD inyectada (real por defecto), para probar el caso
 * de uso con un doble sin tocar la BD.
 */
import { TargetDatabaseFactory } from '../infrastructure/targetdb/TargetDatabaseFactory'
import { checkSqlSafety } from '../domain/sql/SqlSafetyPolicy'
import { UnsafeQueryError } from '../domain/sql/UnsafeQueryError'
import type { ITargetDatabase } from '../domain/ports/ITargetDatabase'
import type { SqlStatement } from '../domain/sql/SqlStatement'
import type { QueryResult } from '../domain/sql/QueryResult'

/** Filas máximas que devuelvo; por encima, marco el resultado como truncado. */
export const MAX_RESULT_ROWS = 1000
/** Tiempo máximo de una consulta antes de cortarla, en milisegundos. */
export const STATEMENT_TIMEOUT_MS = 15_000

export interface QueryExecutionOptions {
  maxRows?: number
  timeoutMs?: number
}

export interface QueryExecutionDependencies {
  /** Abre una conexión de solo lectura a la BD objetivo con el límite de tiempo dado. */
  connectDatabase(options: { statementTimeoutMs: number }): Promise<ITargetDatabase>
}

/** Implementación real: conecta con la BD objetivo a través del factory. */
export const defaultQueryExecutionDependencies: QueryExecutionDependencies = {
  connectDatabase: (options) => TargetDatabaseFactory.connectDefault(options),
}

/** Ejecuto la consulta validada y devuelvo el resultado (columnas, filas, si se truncó). */
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

  // Envuelvo la consulta y pido una fila de más: si vuelve, es que había más que el tope.
  const boundedSql = `SELECT * FROM (${stripTrailingSemicolon(sql.text)}) AS graphsql_result LIMIT ${maxRows + 1}`

  const db = await deps.connectDatabase({ statementTimeoutMs: timeoutMs })
  try {
    const fetched = await db.fetchAll(boundedSql)
    const truncated = fetched.length > maxRows
    const rows = truncated ? fetched.slice(0, maxRows) : fetched
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

/** Quito un único `;` final para poder envolver la consulta como subconsulta. */
function stripTrailingSemicolon(sql: string): string {
  return sql.trim().replace(/;\s*$/, '')
}
