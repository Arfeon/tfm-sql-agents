/**
 * Comprobación de sintaxis del Judge (SPEC-06): valida la sintaxis real contra la BD objetivo.
 *
 * Es la verificación objetiva: le pido a la conexión un `dryRun` (validar la consulta
 * sin ejecutarla); cada adaptador sabe cómo hacerlo en su motor. Si valida, la
 * sintaxis es correcta; si lanza, devuelvo el error de la BD. Tomé la idea del juez
 * del proyecto Python anterior, que hacía lo mismo (EXPLAIN en PostgreSQL/MySQL,
 * `SET NOEXEC ON` en SQL Server).
 *
 * Esto es lo que arregla los falsos positivos del juez LLM: la BD es la autoridad
 * sobre si una consulta es válida, no la opinión (a veces demasiado estricta) del LLM.
 *
 * Recibo la conexión a la BD inyectada (real por defecto, vía el factory), para
 * probar el caso de uso con un doble sin tocar la BD.
 */
import { TargetDatabaseFactory } from '../infrastructure/targetdb/TargetDatabaseFactory'
import type { ITargetDatabase } from '../domain/ports/ITargetDatabase'
import type { SqlStatement } from '../domain/sql/SqlStatement'

export interface SqlSyntaxCheck {
  valid: boolean
  /** Mensaje de error de la BD si la sintaxis no es válida. */
  error?: string
}

export interface SqlSyntaxCheckDependencies {
  /** Abre una conexión de solo lectura a la BD objetivo. */
  connectDatabase(): Promise<ITargetDatabase>
}

/** Implementación real: conecta con la BD objetivo a través del factory. */
export const defaultSqlSyntaxCheckDependencies: SqlSyntaxCheckDependencies = {
  connectDatabase: () => TargetDatabaseFactory.connectDefault(),
}

/** Compruebo la sintaxis de la consulta contra la BD y devuelvo el resultado. */
export async function checkSqlSyntax(
  sql: SqlStatement,
  deps: SqlSyntaxCheckDependencies = defaultSqlSyntaxCheckDependencies,
): Promise<SqlSyntaxCheck> {
  const db = await deps.connectDatabase()
  try {
    await db.dryRun(sql.text)
    return { valid: true }
  } catch (error) {
    return { valid: false, error: error instanceof Error ? error.message : String(error) }
  } finally {
    await db.close()
  }
}
