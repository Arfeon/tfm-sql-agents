/**
 * Test de diagnóstico: compruebo que, tras ingerir el esquema de Arcadia, una
 * tabla queda convertida en su nodo de Neo4j con sus columnas y relaciones.
 *
 * Ojo: este test MUTA Neo4j (limpia y reconstruye el grafo del esquema), que es
 * justo el estado que quiero dejar listo.
 *
 * Requisito: docker compose up -d (ver docs/instalacion.md)
 */
import { afterAll, beforeAll, describe, it, expect } from 'vitest'
import { Neo4jConnection } from '../../src/graphsql/infrastructure/neo4j/Neo4jConnection'
import { ingestSchema } from '../../src/graphsql/application/schemaIngestion'
import { loadTargetDatabases } from '../../src/graphsql/infrastructure/config/targetDatabases'

let neo4j: Neo4jConnection

beforeAll(async () => {
  await ingestSchema(loadTargetDatabases()[0])
  neo4j = Neo4jConnection.fromEnv()
}, 60_000)

afterAll(async () => {
  await neo4j?.close()
})

describe('Ingesta del esquema en Neo4j', () => {
  it('la tabla game se convierte en un nodo Table con sus columnas', async () => {
    const rows = await neo4j.run<{ name: string; columns: number }>(
      `MATCH (t:Table {name: $name})
       OPTIONAL MATCH (t)-[:HAS_COLUMN]->(c:Column)
       RETURN t.name AS name, count(c) AS columns`,
      { name: 'game' },
    )
    expect(rows[0].name).toBe('game')
    expect(rows[0].columns).toBeGreaterThan(0)
  })

  it('game tiene una relación REFERENCES hacia otra tabla', async () => {
    const rows = await neo4j.run<{ refs: number }>(
      `MATCH (:Table {name: $name})-[r:REFERENCES]->(:Table) RETURN count(r) AS refs`,
      { name: 'game' },
    )
    expect(rows[0].refs).toBeGreaterThan(0)
  })
})
