/**
 * Comprobación de sintaxis del Judge: un `dryRun` contra la BD (cada motor sabe el
 * suyo, p. ej. EXPLAIN en PostgreSQL). La BD es la autoridad sobre si una consulta
 * es válida, no la opinión del juez LLM — esto corrige sus falsos positivos.
 */
import { TargetDatabaseFactory } from '../infrastructure/targetdb/TargetDatabaseFactory'
import type { ITargetDatabase } from '../domain/ports/ITargetDatabase'
import type { SqlStatement } from '../domain/sql/SqlStatement'

export interface SqlSyntaxCheck {
  valid: boolean
  error?: string
}

export interface SqlSyntaxCheckDependencies {
  connectDatabase(): Promise<ITargetDatabase>
}

export const defaultSqlSyntaxCheckDependencies: SqlSyntaxCheckDependencies = {
  connectDatabase: () => TargetDatabaseFactory.connectDefault(),
}

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
