/**
 * Test de integración de la ejecución (SPEC-07).
 *
 * Ejecuta de verdad contra la Arcadia real, así que comprueba lo que los unitarios
 * no pueden: que una SELECT devuelve filas, que el tope trunca, y que la sesión es
 * de solo lectura (un INSERT falla).
 *
 * Opt-in (`npm run test:integration`). Requiere docker compose up -d.
 */
import { describe, it, expect } from 'vitest'
import { executeQuery } from '../../src/graphsql/application/queryExecution'
import { PostgresTargetDatabase } from '../../src/graphsql/infrastructure/postgres/PostgresTargetDatabase'
import { loadTargetDatabases } from '../../src/graphsql/infrastructure/config/targetDatabases'

describe('executeQuery (integración)', () => {
  it(
    'ejecuta un SELECT real sobre Arcadia y devuelve filas',
    async () => {
      const result = await executeQuery({
        text: 'SELECT region_id, COUNT(*) AS n FROM customer GROUP BY region_id ORDER BY region_id',
        dialect: 'PostgreSQL',
      })
      console.log(`\n▶ ${result.rowCount} filas, columnas: ${result.columns.join(', ')}\n`)
      expect(result.rowCount).toBeGreaterThan(0)
      expect(result.columns).toContain('region_id')
    },
    30_000,
  )

  it(
    'marca truncado cuando hay más filas que el tope',
    async () => {
      const result = await executeQuery({ text: 'SELECT customer_id FROM customer', dialect: 'PostgreSQL' }, { maxRows: 5 })
      expect(result.truncated).toBe(true)
      expect(result.rowCount).toBe(5)
    },
    30_000,
  )

  it(
    'la sesión es de solo lectura: un INSERT falla en la BD',
    async () => {
      const target = loadTargetDatabases()[0]
      const db = await PostgresTargetDatabase.fromParams({
        host: target.host,
        port: target.port,
        database: target.name,
        user: target.user,
        password: target.password,
      })
      try {
        await expect(db.fetchAll(`INSERT INTO region (name) VALUES ('x')`)).rejects.toThrow()
      } finally {
        await db.close()
      }
    },
    30_000,
  )
})
