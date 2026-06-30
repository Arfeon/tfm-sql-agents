/**
 * Tests unitarios de la ejecución (SPEC-07).
 *
 * Doblo la conexión a la BD (`connectDatabase` → un `ITargetDatabase` falso) para no
 * tocar nada: compruebo el mapeo de filas a columnas, que se respeta la marca de
 * truncado que da el adaptador, que una consulta no de solo lectura corta con
 * `UnsafeQueryError` sin conectar, y que paso la consulta, el tope y el timeout.
 * El límite de filas real (cursor) se prueba en integración.
 */
import { describe, it, expect } from 'vitest'
import { executeQuery, type QueryExecutionDependencies } from '../../src/graphsql/application/queryExecution'
import { UnsafeQueryError } from '../../src/graphsql/domain/sql/UnsafeQueryError'
import type { ITargetDatabase } from '../../src/graphsql/domain/ports/ITargetDatabase'
import type { SqlStatement } from '../../src/graphsql/domain/sql/SqlStatement'

const SELECT: SqlStatement = { text: 'SELECT id, name FROM customer', dialect: 'PostgreSQL' }

interface Spy {
  onConnect?: (options: { statementTimeoutMs: number }) => void
  onFetch?: (sql: string, maxRows: number) => void
}

/** Doble: conecta a un `ITargetDatabase` falso que devuelve un resultado fijo. */
function fakeDeps(
  result: { rows: Array<Record<string, unknown>>; truncated: boolean },
  spy?: Spy,
): QueryExecutionDependencies {
  const db: ITargetDatabase = {
    fetchAll: async () => [] as never,
    fetchCapped: async (sql, maxRows) => {
      spy?.onFetch?.(sql, maxRows)
      return result as never
    },
    rowCount: async () => result.rows.length,
    close: async () => {},
  }
  return {
    connectDatabase: async (options) => {
      spy?.onConnect?.(options)
      return db
    },
  }
}

describe('executeQuery', () => {
  it('mapea filas a columnas y cuenta', async () => {
    const result = await executeQuery(SELECT, {}, fakeDeps({ rows: [{ id: 1, name: 'a' }, { id: 2, name: 'b' }], truncated: false }))
    expect(result.columns).toEqual(['id', 'name'])
    expect(result.rowCount).toBe(2)
    expect(result.truncated).toBe(false)
  })

  it('respeta la marca de truncado que da el adaptador', async () => {
    const result = await executeQuery(SELECT, {}, fakeDeps({ rows: [{ n: 1 }], truncated: true }))
    expect(result.truncated).toBe(true)
  })

  it('si no hay filas, devuelve columnas vacías', async () => {
    const result = await executeQuery(SELECT, {}, fakeDeps({ rows: [], truncated: false }))
    expect(result.columns).toEqual([])
    expect(result.rowCount).toBe(0)
  })

  it('rechaza una consulta que no es de solo lectura sin conectar a la BD', async () => {
    let connected = false
    const deps = fakeDeps({ rows: [], truncated: false }, { onConnect: () => { connected = true } })
    const unsafe: SqlStatement = { text: 'DROP TABLE customer', dialect: 'PostgreSQL' }
    await expect(executeQuery(unsafe, {}, deps)).rejects.toThrow(UnsafeQueryError)
    expect(connected).toBe(false)
  })

  it('pasa la consulta y el tope a fetchCapped, y el timeout a la conexión', async () => {
    let receivedSql = ''
    let receivedMaxRows = 0
    let receivedTimeout = 0
    const deps = fakeDeps({ rows: [], truncated: false }, {
      onFetch: (sql, maxRows) => { receivedSql = sql; receivedMaxRows = maxRows },
      onConnect: (options) => { receivedTimeout = options.statementTimeoutMs },
    })
    await executeQuery({ text: 'SELECT 1', dialect: 'PostgreSQL' }, { maxRows: 100, timeoutMs: 5000 }, deps)
    expect(receivedSql).toBe('SELECT 1')
    expect(receivedMaxRows).toBe(100)
    expect(receivedTimeout).toBe(5000)
  })
})
