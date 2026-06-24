/**
 * Tests de diagnóstico: compruebo que el servidor Postgres responde
 * y que la BD Arcadia existe con pgvector activado.
 *
 * Ejecutar: npm test -- --reporter=verbose
 * Requisito: docker compose up -d (ver docs/instalacion.md)
 */
import { beforeAll, afterAll, describe, it, expect } from 'vitest'
import { Client } from 'pg'
import { PostgresTargetDatabase } from '../../src/graphsql/infrastructure/postgres/PostgresTargetDatabase'

const POSTGRES_PARAMS = {
  host: process.env.POSTGRES_HOST ?? 'localhost',
  port: parseInt(process.env.POSTGRES_PORT ?? '5432'),
  user: process.env.POSTGRES_USER ?? 'postgres',
  password: process.env.POSTGRES_PASSWORD ?? 'postgres',
}

let db: PostgresTargetDatabase
let rawClient: Client

beforeAll(async () => {
  rawClient = new Client({ ...POSTGRES_PARAMS, database: 'postgres' })
  await rawClient.connect()
  db = await PostgresTargetDatabase.fromParams({ ...POSTGRES_PARAMS, database: 'arcadia' })
})

afterAll(async () => {
  await db?.close()
  await rawClient?.end()
})

describe('PostgresConnection', () => {
  it('server accepts connections', async () => {
    const result = await rawClient.query<{ '?column?': number }>('SELECT 1')
    expect(result.rows[0]['?column?']).toBe(1)
  })

  it('arcadia database exists', async () => {
    const result = await rawClient.query(
      "SELECT datname FROM pg_database WHERE datname = 'arcadia'"
    )
    expect(result.rows).toHaveLength(1)
  })

  it('graphsql_memory database exists', async () => {
    const result = await rawClient.query(
      "SELECT datname FROM pg_database WHERE datname = 'graphsql_memory'"
    )
    expect(result.rows).toHaveLength(1)
  })

  it('pgvector extension active in arcadia', async () => {
    const rows = await db.fetchAll(
      "SELECT extname FROM pg_extension WHERE extname = 'vector'"
    )
    expect(rows).toHaveLength(1)
  })

  it('arcadia connection is readonly', async () => {
    await expect(
      db.getClient().query("INSERT INTO genre (name) VALUES ('Test')")
    ).rejects.toMatchObject({ code: '25006' })
  })
})
