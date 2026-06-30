/**
 * Tests de la comprobación de sintaxis del Judge (SPEC-06): el EXPLAIN contra la BD.
 *
 * Doblo la conexión (`connectDatabase` → un `ITargetDatabase` falso): si el EXPLAIN
 * planifica sin error, la sintaxis es válida; si lanza, devuelvo el error de la BD.
 * La comprobación real sobre Arcadia se prueba en integración.
 */
import { describe, it, expect } from 'vitest'
import { checkSqlSyntax, type SqlSyntaxCheckDependencies } from '../../src/graphsql/application/sqlSyntaxCheck'
import type { ITargetDatabase } from '../../src/graphsql/domain/ports/ITargetDatabase'
import type { SqlStatement } from '../../src/graphsql/domain/sql/SqlStatement'

const SQL: SqlStatement = { text: 'SELECT 1', dialect: 'PostgreSQL' }

/** Doble cuya `fetchAll` (el EXPLAIN) hace lo que se le indique, capturando la SQL. */
function depsWith(fetchAll: (sql: string) => Promise<void>): SqlSyntaxCheckDependencies {
  const db: ITargetDatabase = {
    fetchAll: async (sql) => {
      await fetchAll(sql)
      return [] as never
    },
    fetchCapped: async () => ({ rows: [], truncated: false }),
    rowCount: async () => 0,
    close: async () => {},
  }
  return { connectDatabase: async () => db }
}

describe('checkSqlSyntax', () => {
  it('es válida si el EXPLAIN planifica sin error', async () => {
    expect(await checkSqlSyntax(SQL, depsWith(async () => {}))).toEqual({ valid: true })
  })

  it('es inválida con el mensaje de la BD si el EXPLAIN lanza', async () => {
    const deps = depsWith(async () => {
      throw new Error('column "foo" does not exist')
    })
    const result = await checkSqlSyntax(SQL, deps)
    expect(result.valid).toBe(false)
    expect(result.error).toContain('foo')
  })

  it('comprueba la sintaxis con un EXPLAIN sobre la sentencia', async () => {
    let received = ''
    const deps = depsWith(async (sql) => { received = sql })
    await checkSqlSyntax({ text: 'SELECT name FROM customer', dialect: 'PostgreSQL' }, deps)
    expect(received).toBe('EXPLAIN SELECT name FROM customer')
  })
})
