/**
 * Tests unitarios de la ejecución (SPEC-07).
 *
 * Doblo la conexión a la BD (`connectDatabase` → un `ITargetDatabase` falso) para no
 * tocar nada: compruebo el mapeo de filas a columnas, el tope con su marca de
 * truncado, que una consulta no de solo lectura corta con `UnsafeQueryError` sin
 * conectar, y que envuelvo la consulta con el límite y paso el timeout a la conexión.
 * La ejecución real se prueba en integración.
 */
import { describe, it, expect } from 'vitest'
import { executeQuery, type QueryExecutionDependencies } from '../../src/graphsql/application/queryExecution'
import { UnsafeQueryError } from '../../src/graphsql/domain/sql/UnsafeQueryError'
import type { ITargetDatabase } from '../../src/graphsql/domain/ports/ITargetDatabase'
import type { SqlStatement } from '../../src/graphsql/domain/sql/SqlStatement'

const SELECT: SqlStatement = { text: 'SELECT id, name FROM customer', dialect: 'PostgreSQL' }

interface Spy {
  onConnect?: (options: { statementTimeoutMs: number }) => void
  onFetch?: (sql: string) => void
}

/** Doble de dependencias: conecta a un `ITargetDatabase` falso que devuelve filas fijas. */
function fakeDeps(rows: Array<Record<string, unknown>>, spy?: Spy): QueryExecutionDependencies {
  const db: ITargetDatabase = {
    fetchAll: async (sql) => {
      spy?.onFetch?.(sql)
      return rows as never
    },
    rowCount: async () => rows.length,
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
    const result = await executeQuery(SELECT, {}, fakeDeps([{ id: 1, name: 'a' }, { id: 2, name: 'b' }]))
    expect(result.columns).toEqual(['id', 'name'])
    expect(result.rowCount).toBe(2)
    expect(result.truncated).toBe(false)
  })

  it('marca truncado y recorta cuando hay más filas que el tope', async () => {
    // Con maxRows=2 pido 3 filas (2+1); el doble devuelve 3 → había más.
    const result = await executeQuery(SELECT, { maxRows: 2 }, fakeDeps([{ n: 1 }, { n: 2 }, { n: 3 }]))
    expect(result.truncated).toBe(true)
    expect(result.rowCount).toBe(2)
    expect(result.rows).toHaveLength(2)
  })

  it('si no hay filas, devuelve columnas vacías', async () => {
    const result = await executeQuery(SELECT, {}, fakeDeps([]))
    expect(result.columns).toEqual([])
    expect(result.rowCount).toBe(0)
  })

  it('rechaza una consulta que no es de solo lectura sin conectar a la BD', async () => {
    let connected = false
    const deps = fakeDeps([], { onConnect: () => { connected = true } })
    const unsafe: SqlStatement = { text: 'DROP TABLE customer', dialect: 'PostgreSQL' }
    await expect(executeQuery(unsafe, {}, deps)).rejects.toThrow(UnsafeQueryError)
    expect(connected).toBe(false)
  })

  it('envuelve la consulta con el límite, quita el ";" final y pasa el timeout a la conexión', async () => {
    let receivedSql = ''
    let receivedTimeout = 0
    const deps = fakeDeps([], {
      onFetch: (sql) => { receivedSql = sql },
      onConnect: (options) => { receivedTimeout = options.statementTimeoutMs },
    })
    await executeQuery({ text: 'SELECT 1;', dialect: 'PostgreSQL' }, { maxRows: 100, timeoutMs: 5000 }, deps)
    expect(receivedSql).toContain('SELECT 1')
    expect(receivedSql).not.toContain(';')
    expect(receivedSql).toContain('LIMIT 101')
    expect(receivedTimeout).toBe(5000)
  })
})
