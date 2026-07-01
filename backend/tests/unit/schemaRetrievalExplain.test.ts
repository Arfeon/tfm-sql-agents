/**
 * Tests unitarios de la traza de recuperación (SPEC-13).
 *
 * Con dobles del ranking y la expansión (sin pgvector ni Neo4j) compruebo que la
 * traza refleja el circuito: distingue candidatas (top-K) de tablas expandidas por
 * FK, muestra el score bajo de las expandidas, marca el motivo de cada tabla del
 * contexto (semántica / expansión / fijada) y respeta el corte top-K y el recorte.
 */
import { describe, it, expect } from 'vitest'
import { explainSchemaRetrieval } from '../../src/graphsql/application/schemaRetrieval'
import type { SchemaRetrievalDependencies } from '../../src/graphsql/application/schemaRetrieval'
import type { TableSchema } from '../../src/graphsql/domain/schema/TableSchema'

function table(name: string): TableSchema {
  return { name, schema: null, columns: [{ name: `${name}_id`, type: 'integer', nullable: false }], primaryKeys: [`${name}_id`], foreignKeys: [] }
}

describe('explainSchemaRetrieval', () => {
  it('distingue candidatas de expandidas y muestra el score (bajo) de las expandidas', async () => {
    const deps: SchemaRetrievalDependencies = {
      rankTablesBySimilarity: async () => [
        { tableName: 'game', score: 0.9 },
        { tableName: 'customer', score: 0.8 },
        { tableName: 'purchase', score: 0.5 },
        { tableName: 't_042', score: 0.1 }, // opaca: score bajísimo, no candidata
      ],
      // expando desde las candidatas y aparece t_042 como vecina por FK.
      expandByForeignKeys: async () => [table('game'), table('customer'), table('t_042')],
    }

    const trace = await explainSchemaRetrieval('juegos en la wishlist', deps, { topK: 2, maxTables: 8 })

    expect(trace.candidates).toEqual(['game', 'customer'])
    // t_042 no es candidata (fuera del top-K) pero entra por expansión, con su score bajo.
    expect(trace.ranking.find((r) => r.tableName === 't_042')?.isCandidate).toBe(false)
    const expandedT042 = trace.expansionAdded.find((e) => e.tableName === 't_042')
    expect(expandedT042?.score).toBe(0.1)
    // su motivo en el contexto final es 'expansion'
    expect(trace.finalContext.find((c) => c.tableName === 't_042')?.reason).toBe('expansion')
    expect(trace.finalContext.find((c) => c.tableName === 'game')?.reason).toBe('semantic')
    expect(trace.levers).toEqual({ semanticTopK: 2, maxContextTables: 8 })
  })

  it('marca como fijada (pinned) una tabla del must-include', async () => {
    const deps: SchemaRetrievalDependencies = {
      rankTablesBySimilarity: async () => [
        { tableName: 'customer', score: 0.9 },
        { tableName: 'region', score: 0.7 },
        { tableName: 't_042', score: 0.1 },
      ],
      expandByForeignKeys: async (names) => names.map(table),
    }

    const trace = await explainSchemaRetrieval('clientes', deps, { topK: 1, maxTables: 8, mustInclude: ['t_042'] })

    // t_042 entra por fijada, no por semántica ni expansión.
    expect(trace.finalContext.find((c) => c.tableName === 't_042')?.reason).toBe('pinned')
    // y no aparece como "candidata" en el ranking (no está en el top-K semántico).
    expect(trace.ranking.find((r) => r.tableName === 't_042')?.isCandidate).toBe(false)
  })

  it('el ranking trae todas las tablas y el contexto respeta el recorte', async () => {
    const deps: SchemaRetrievalDependencies = {
      rankTablesBySimilarity: async () => [
        { tableName: 'a', score: 0.9 },
        { tableName: 'b', score: 0.8 },
        { tableName: 'c', score: 0.7 },
        { tableName: 'd', score: 0.6 },
      ],
      expandByForeignKeys: async () => [table('a'), table('b'), table('c'), table('d')],
    }

    const trace = await explainSchemaRetrieval('algo', deps, { topK: 2, maxTables: 2 })

    expect(trace.ranking.map((r) => r.tableName)).toEqual(['a', 'b', 'c', 'd'])
    // recorte a 2, ordenado por score → se quedan a y b
    expect(trace.finalContext.map((c) => c.tableName)).toEqual(['a', 'b'])
    expect(trace.context.tableNames).toEqual(['a', 'b'])
  })
})
