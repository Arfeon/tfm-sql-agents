/**
 * La traza de recuperación con dobles: candidatas vs expandidas por FK, el motivo
 * de cada tabla y los cortes (top-K y recorte del contexto).
 */
import { describe, it, expect } from 'vitest'
import { explainSchemaRetrieval } from '../../src/graphsql/application/schemaRetrieval'
import type { SchemaRetrievalDependencies } from '../../src/graphsql/application/schemaRetrieval'
import { table, tableWithFk } from '../helpers/tableFixtures'

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
    expect(trace.levers).toEqual({
      semanticTopK: 2,
      maxContextTables: 8,
      expansionMode: 'neighbors',
      maxPathLength: 3,
      lexical: false,
      useSelector: false,
      poolSize: 30,
    })
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

  it("modo 'paths': marca el puente como 'connector' y lo lista aparte de las vecinas", async () => {
    const deps: SchemaRetrievalDependencies = {
      rankTablesBySimilarity: async () => [
        { tableName: 'dades_fiscals', score: 0.9 },
        { tableName: 'abo_linies', score: 0.8 },
        { tableName: 'abonats', score: 0.05 }, // hub central: score bajísimo
      ],
      // a un salto solo aparecen las anclas; el hub no lo trae la vecindad.
      expandByForeignKeys: async () => [table('dades_fiscals'), table('abo_linies')],
      // el camino dades_fiscals—abonats—abo_linies rescata 'abonats' como puente.
      findConnectingTables: async () => [table('abonats')],
    }

    const trace = await explainSchemaRetrieval('abonado con más líneas', deps, {
      topK: 2,
      maxTables: 8,
      expansionMode: 'paths',
    })

    expect(trace.finalContext.find((c) => c.tableName === 'abonats')?.reason).toBe('connector')
    expect(trace.connectorsAdded.map((c) => c.tableName)).toEqual(['abonats'])
    // el puente no se cuela en la lista de vecinas a un salto.
    expect(trace.expansionAdded.map((e) => e.tableName)).not.toContain('abonats')
    expect(trace.levers.expansionMode).toBe('paths')
    expect(trace.levers.maxPathLength).toBe(3)
  })

  it("modo 'paths': marca la dimensión referenciada por FK como 'fk-target' y la lista aparte", async () => {
    const cliSub = tableWithFk('abo_linies', 'id_abonat', 'abonats')
    const deps: SchemaRetrievalDependencies = {
      rankTablesBySimilarity: async () => [
        { tableName: 'abo_linies', score: 0.9 },
        { tableName: 'abonats', score: 0.02 },
      ],
      expandByForeignKeys: async () => [cliSub, table('abonats')],
    }

    const trace = await explainSchemaRetrieval('abonado con más líneas', deps, {
      topK: 1,
      maxTables: 8,
      expansionMode: 'paths',
    })

    expect(trace.finalContext.find((c) => c.tableName === 'abonats')?.reason).toBe('fk-target')
    expect(trace.fkTargetsAdded.map((c) => c.tableName)).toEqual(['abonats'])
    expect(trace.expansionAdded.map((e) => e.tableName)).not.toContain('abonats')
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
