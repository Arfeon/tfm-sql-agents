/**
 * Test de diagnóstico: compruebo que la instancia de Neo4j está levantada
 * y responde.
 *
 * Requisito: docker compose up -d (ver docs/instalacion.md)
 */
import { afterAll, beforeAll, describe, it, expect } from 'vitest'
import { Neo4jConnection } from '../../src/graphsql/infrastructure/neo4j/Neo4jConnection'

let neo4j: Neo4jConnection

beforeAll(() => {
  neo4j = Neo4jConnection.fromEnv()
})

afterAll(async () => {
  await neo4j?.close()
})

describe('Neo4j', () => {
  it('responde a una consulta trivial', async () => {
    const rows = await neo4j.run<{ ok: number }>('RETURN 1 AS ok')
    expect(rows[0].ok).toBe(1)
  })

  it('isUp devuelve true', async () => {
    expect(await neo4j.isUp()).toBe(true)
  })
})
