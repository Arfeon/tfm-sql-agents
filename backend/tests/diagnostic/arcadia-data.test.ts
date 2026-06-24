/**
 * Tests de diagnóstico: compruebo que la BD Arcadia tiene el esquema
 * correcto y el volumen de datos esperado (generado con seed=42).
 *
 * Ejecutar: npm test -- --reporter=verbose
 * Requisito: docker compose up -d (ver docs/instalacion.md)
 */
import { beforeAll, afterAll, describe, it, expect } from 'vitest'
import { PostgresTargetDatabase } from '../../src/graphsql/infrastructure/postgres/PostgresTargetDatabase'

const POSTGRES_PARAMS = {
  host: process.env.POSTGRES_HOST ?? 'localhost',
  port: parseInt(process.env.POSTGRES_PORT ?? '5432'),
  user: process.env.POSTGRES_USER ?? 'postgres',
  password: process.env.POSTGRES_PASSWORD ?? 'postgres',
}

const EXPECTED_TABLES = [
  'company', 'franchise', 'game', 'genre', 'platform',
  'game_genre', 'game_platform', 'dlc',
  'region', 'subscription_plan', 'customer', 'subscription',
  'purchase', 'play_session', 'rating', 'concurrent_snapshot',
]

const EXPECTED_ROW_COUNTS: Record<string, number> = {
  company: 60,
  franchise: 45,
  game: 320,
  genre: 12,
  platform: 8,
  region: 6,
  subscription_plan: 3,
  customer: 5_000,
}

let db: PostgresTargetDatabase

beforeAll(async () => {
  db = await PostgresTargetDatabase.fromParams({ ...POSTGRES_PARAMS, database: 'arcadia' })
})

afterAll(async () => {
  await db?.close()
})

describe('ArcadiaSchema', () => {
  it('all tables exist', async () => {
    const rows = await db.fetchAll<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public'"
    )
    const existingTables = new Set(rows.map(r => r.tablename))
    const missing = EXPECTED_TABLES.filter(t => !existingTables.has(t))
    expect(missing).toEqual([])
  })

  it('game has developer and publisher columns', async () => {
    const rows = await db.fetchAll<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'game'
         AND column_name IN ('developer_company_id', 'publisher_company_id')`
    )
    const found = new Set(rows.map(r => r.column_name))
    expect(found.has('developer_company_id')).toBe(true)
    expect(found.has('publisher_company_id')).toBe(true)
  })
})

describe('ArcadiaData', () => {
  it('expected row counts', async () => {
    for (const [table, expected] of Object.entries(EXPECTED_ROW_COUNTS)) {
      const count = await db.rowCount(table)
      expect(
        count,
        `Tabla '${table}': esperaba ${expected} filas, hay ${count}. ` +
        `¿El dataset está cargado? Ejecuta: docker compose down -v && docker compose up -d`
      ).toBe(expected)
    }
  })

  it('all games have valid age rating', async () => {
    const rows = await db.fetchAll(
      "SELECT DISTINCT age_rating FROM game WHERE age_rating NOT IN ('E','E10','T','M')"
    )
    expect(rows).toEqual([])
  })

  it('no game without developer', async () => {
    const rows = await db.fetchAll(
      `SELECT game_id FROM game
       WHERE developer_company_id NOT IN (SELECT company_id FROM company)`
    )
    expect(rows).toEqual([])
  })

  it('publisher only companies exist', async () => {
    const rows = await db.fetchAll(
      `SELECT company_id FROM company
       WHERE company_id NOT IN (SELECT DISTINCT developer_company_id FROM game)
         AND company_id IN (SELECT DISTINCT publisher_company_id FROM game)`
    )
    expect(rows.length).toBeGreaterThan(0)
  })

  it('all sessions have valid duration', async () => {
    const rows = await db.fetchAll<{ invalid: string }>(
      'SELECT COUNT(*) AS invalid FROM play_session WHERE duration_minutes <= 0'
    )
    expect(parseInt(rows[0].invalid, 10)).toBe(0)
  })

  it('ratings are between 1 and 5', async () => {
    const rows = await db.fetchAll<{ invalid: string }>(
      'SELECT COUNT(*) AS invalid FROM rating WHERE score < 1 OR score > 5'
    )
    expect(parseInt(rows[0].invalid, 10)).toBe(0)
  })
})
