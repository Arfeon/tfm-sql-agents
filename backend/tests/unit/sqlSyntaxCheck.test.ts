/**
 * Tests de la comprobación de sintaxis del Judge (SPEC-06).
 *
 * Doblo la conexión (`connectDatabase` → un `ITargetDatabase` falso): si el `dryRun`
 * valida, la sintaxis es correcta; si lanza, devuelvo el error de la BD. Cómo hace
 * el dry-run cada motor (EXPLAIN en Postgres…) es cosa del adaptador; aquí solo
 * dependo del puerto. La comprobación real sobre Arcadia se prueba en integración.
 */
import { describe, it, expect } from 'vitest'
import { checkSqlSyntax, type SqlSyntaxCheckDependencies } from '../../src/graphsql/application/sqlSyntaxCheck'
import type { ITargetDatabase } from '../../src/graphsql/domain/ports/ITargetDatabase'
import type { SqlStatement } from '../../src/graphsql/domain/sql/SqlStatement'

const SQL: SqlStatement = { text: 'SELECT 1', dialect: 'PostgreSQL' }

/** Doble cuyo `dryRun` hace lo que se le indique, capturando la SQL recibida. */
function depsWith(dryRun: (sql: string) => Promise<void>): SqlSyntaxCheckDependencies {
  const db: ITargetDatabase = {
    fetchAll: async () => [] as never,
    fetchCapped: async () => ({ rows: [], truncated: false }),
    dryRun,
    rowCount: async () => 0,
    close: async () => {},
  }
  return { connectDatabase: async () => db }
}

describe('checkSqlSyntax', () => {
  it('es válida si el dry-run valida sin error', async () => {
    expect(await checkSqlSyntax(SQL, depsWith(async () => {}))).toEqual({ valid: true })
  })

  it('es inválida con el mensaje de la BD si el dry-run lanza', async () => {
    const deps = depsWith(async () => {
      throw new Error('column "foo" does not exist')
    })
    const result = await checkSqlSyntax(SQL, deps)
    expect(result.valid).toBe(false)
    expect(result.error).toContain('foo')
  })

  it('le pasa al dry-run el texto de la sentencia', async () => {
    let received = ''
    const deps = depsWith(async (sql) => { received = sql })
    await checkSqlSyntax({ text: 'SELECT name FROM customer', dialect: 'PostgreSQL' }, deps)
    expect(received).toBe('SELECT name FROM customer')
  })
})
