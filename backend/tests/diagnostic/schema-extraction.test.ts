/**
 * Test de diagnóstico: compruebo que extraigo correctamente el esquema de la
 * BD objetivo (Arcadia) — tablas, columnas y claves foráneas.
 *
 * Requisito: docker compose up -d (ver docs/instalacion.md)
 */
import { afterAll, beforeAll, describe, it, expect } from 'vitest'
import { PostgresTargetDatabase } from '../../src/graphsql/infrastructure/postgres/PostgresTargetDatabase'
import { PostgresSchemaReader } from '../../src/graphsql/infrastructure/postgres/PostgresSchemaReader'
import { loadTargetDatabases } from '../../src/graphsql/infrastructure/config/targetDatabases'
import type { TableSchema } from '../../src/graphsql/domain/schema/TableSchema'

const EXPECTED_TABLES = [
  'company', 'franchise', 'game', 'genre', 'platform',
  'game_genre', 'game_platform', 'dlc',
  'region', 'subscription_plan', 'customer', 'subscription',
  'purchase', 'play_session', 'rating', 'concurrent_snapshot',
  't_042',
]

let db: PostgresTargetDatabase
let tables: TableSchema[]

beforeAll(async () => {
  const target = loadTargetDatabases()[0]
  db = await PostgresTargetDatabase.fromParams({
    host: target.host,
    port: target.port,
    database: target.name,
    user: target.user,
    password: target.password,
  })
  tables = await new PostgresSchemaReader(db, target.schema).readSchema()
})

afterAll(async () => {
  await db?.close()
})

describe('PostgresSchemaReader (Arcadia)', () => {
  it('extrae las 17 tablas esperadas', () => {
    const names = new Set(tables.map((t) => t.name))
    const missing = EXPECTED_TABLES.filter((t) => !names.has(t))
    expect(missing).toEqual([])
  })

  it('game tiene columnas y clave primaria', () => {
    const game = tables.find((t) => t.name === 'game')
    expect(game).toBeDefined()
    expect(game!.columns.length).toBeGreaterThan(0)
    expect(game!.primaryKeys).toContain('game_id')
  })

  it('game referencia a company por sus claves foráneas', () => {
    const game = tables.find((t) => t.name === 'game')!
    const referencedTables = game.foreignKeys.map((fk) => fk.referencesTable)
    expect(referencedTables).toContain('company')
  })
})
