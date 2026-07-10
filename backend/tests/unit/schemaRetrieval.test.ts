/**
 * Tests unitarios de la recuperación de esquema (orquestación, SPEC-04).
 *
 * No tocan pgvector ni Neo4j: inyecto el ranking por similitud y la expansión por
 * FK como dobles, y compruebo que el caso de uso toma las top-K candidatas,
 * expande, y ACOTA el conjunto final por similitud. El mapeo multilingüe real y la
 * búsqueda por descripción se prueban en integración (vectores reales).
 */
import { describe, it, expect } from 'vitest'
import { retrieveSchemaContext } from '../../src/graphsql/application/schemaRetrieval'
import type { SchemaRetrievalDependencies } from '../../src/graphsql/application/schemaRetrieval'
import type { TableSchema } from '../../src/graphsql/domain/schema/TableSchema'
import { table, tableWithFk } from '../helpers/tableFixtures'

describe('retrieveSchemaContext', () => {
  it('toma las top-K candidatas, expande por FK y acota el conjunto por similitud', async () => {
    let expandedFrom: string[] = []
    const deps: SchemaRetrievalDependencies = {
      // ranking por similitud de todas las tablas (descendente).
      rankTablesBySimilarity: async () => [
        { tableName: 'customer', score: 0.9 },
        { tableName: 'region', score: 0.7 },
        { tableName: 'game', score: 0.6 },
        { tableName: 'purchase', score: 0.4 },
      ],
      // la expansión por FK trae candidatas + vecinas.
      expandByForeignKeys: async (names) => {
        expandedFrom = names
        return [table('customer'), table('region'), table('game'), table('purchase')]
      },
    }

    const context = await retrieveSchemaContext('¿cuántos clientes por región?', deps, { topK: 2, maxTables: 3 })

    // candidatas = top-2 por similitud
    expect(expandedFrom).toEqual(['customer', 'region'])
    // contexto acotado a 3 y ordenado por similitud → se cae 'purchase' (la de menor score)
    expect(context.tableNames).toEqual(['customer', 'region', 'game'])
    expect(context.ddl).toContain('CREATE TABLE customer')
    expect(context.ddl).not.toContain('CREATE TABLE purchase')
  })

  it('sin tablas devuelve un contexto vacío', async () => {
    const deps: SchemaRetrievalDependencies = {
      rankTablesBySimilarity: async () => [],
      expandByForeignKeys: async () => [],
    }

    const context = await retrieveSchemaContext('algo irrelevante', deps)

    expect(context.tableNames).toEqual([])
    expect(context.ddl).toBe('')
  })

  it('no recorta si el conjunto cabe dentro del máximo', async () => {
    const deps: SchemaRetrievalDependencies = {
      rankTablesBySimilarity: async () => [
        { tableName: 'customer', score: 0.9 },
        { tableName: 'region', score: 0.7 },
      ],
      expandByForeignKeys: async () => [table('customer'), table('region')],
    }

    const context = await retrieveSchemaContext('clientes por región', deps, { maxTables: 8 })

    expect(context.tableNames).toEqual(['customer', 'region'])
  })

  it('fija una tabla que el ranking no traería y la conserva pese al recorte', async () => {
    let expandedFrom: string[] = []
    const deps: SchemaRetrievalDependencies = {
      rankTablesBySimilarity: async () => [
        { tableName: 'customer', score: 0.9 },
        { tableName: 'region', score: 0.7 },
        { tableName: 'game', score: 0.6 },
        { tableName: 't_042', score: 0.1 }, // existe en el esquema, pero con score bajísimo
      ],
      expandByForeignKeys: async (names) => {
        expandedFrom = names
        return names.map(table)
      },
    }

    // Sin fijar, con topK=1 y maxTables=1, t_042 no aparecería.
    const context = await retrieveSchemaContext('wishlist', deps, {
      topK: 1,
      maxTables: 1,
      mustInclude: ['t_042'],
    })

    // La fijada entra como candidata (para expandir) y sobrevive al recorte.
    expect(expandedFrom).toContain('t_042')
    expect(context.tableNames).toContain('t_042')
  })

  it("modo 'paths': añade el conector puente entre anclas y lo conserva pese al recorte", async () => {
    let connectorsFrom: string[] = []
    const deps: SchemaRetrievalDependencies = {
      rankTablesBySimilarity: async () => [
        { tableName: 'dades_fiscals', score: 0.9 },
        { tableName: 'abo_linies', score: 0.8 },
        { tableName: 'fib_a', score: 0.7 },
        { tableName: 'fib_b', score: 0.6 },
        { tableName: 'abonats', score: 0.05 }, // hub central: la similitud lo dejaría fuera
      ],
      // a un salto: las anclas y dos tablas 'fib_*' que se parecen a la pregunta.
      expandByForeignKeys: async () => [table('dades_fiscals'), table('abo_linies'), table('fib_a'), table('fib_b')],
      findConnectingTables: async (names) => {
        connectorsFrom = names
        return [table('abonats')]
      },
    }

    const context = await retrieveSchemaContext('abonado con más líneas', deps, {
      topK: 2,
      maxTables: 3,
      expansionMode: 'paths',
    })

    // busco conectores entre las anclas (candidatas por significado).
    expect(connectorsFrom).toEqual(['dades_fiscals', 'abo_linies'])
    // 'abonats' entra como puente aunque su score lo dejaría fuera del recorte a 3.
    expect(context.tableNames).toContain('abonats')
  })

  it("modo 'neighbors' (por defecto): no busca conectores ni trae el puente", async () => {
    let askedForConnectors = false
    const deps: SchemaRetrievalDependencies = {
      rankTablesBySimilarity: async () => [
        { tableName: 'dades_fiscals', score: 0.9 },
        { tableName: 'abo_linies', score: 0.8 },
        { tableName: 'fib_a', score: 0.7 },
        { tableName: 'abonats', score: 0.05 },
      ],
      expandByForeignKeys: async () => [table('dades_fiscals'), table('abo_linies'), table('fib_a')],
      findConnectingTables: async () => {
        askedForConnectors = true
        return [table('abonats')]
      },
    }

    const context = await retrieveSchemaContext('abonado con más líneas', deps, { topK: 2, maxTables: 3 })

    expect(askedForConnectors).toBe(false)
    expect(context.tableNames).not.toContain('abonats')
  })

  it("modo 'paths': rescata del recorte el destino de FK de un ancla (su dimensión)", async () => {
    // Un ancla de líneas que REFERENCIA a 'abonats' por FK; 'abonats' puntúa bajísimo.
    const cliSub = tableWithFk('abo_linies', 'id_abonat', 'abonats')
    const deps: SchemaRetrievalDependencies = {
      rankTablesBySimilarity: async () => [
        { tableName: 'abo_linies', score: 0.9 },
        { tableName: 'fib_a', score: 0.8 },
        { tableName: 'fib_b', score: 0.7 },
        { tableName: 'abonats', score: 0.02 }, // la dimensión, score bajísimo
      ],
      // 'abonats' viene como vecina a un salto, pero el recorte por score la tiraría.
      expandByForeignKeys: async () => [cliSub, table('fib_a'), table('fib_b'), table('abonats')],
      // sin findConnectingTables: el rescate por destino de FK no depende de él.
    }

    const paths = await retrieveSchemaContext('abonado con más líneas', deps, {
      topK: 1,
      maxTables: 2,
      expansionMode: 'paths',
    })
    // 'abonats' es destino de FK del ancla → sobrevive pese al recorte a 2.
    expect(paths.tableNames).toContain('abonats')

    const neighbors = await retrieveSchemaContext('abonado con más líneas', deps, { topK: 1, maxTables: 2 })
    // sin 'paths', 'abonats' cae por score bajo.
    expect(neighbors.tableNames).not.toContain('abonats')
  })

  it('modo híbrido: el ranking léxico rescata al top-K una tabla que el denso entierra', async () => {
    let askedLexically = false
    const deps: SchemaRetrievalDependencies = {
      rankTablesBySimilarity: async () => [
        { tableName: 'fib_lin_a', score: 0.64 },
        { tableName: 'fib_lin_b', score: 0.63 },
        { tableName: 'fib_lin_c', score: 0.62 },
        { tableName: 'abonats', score: 0.1 }, // hundida en el denso, como en el índice real
      ],
      expandByForeignKeys: async () => [table('fib_lin_a'), table('fib_lin_b'), table('fib_lin_c'), table('abonats')],
      rankTablesLexically: async () => {
        askedLexically = true
        return [{ tableName: 'abonats', score: 2 }] // "cliente" casa con abonats
      },
    }

    const hybrid = await retrieveSchemaContext('qué abonado tiene más', deps, { topK: 2, maxTables: 2, lexical: true })
    expect(askedLexically).toBe(true)
    // La fusión RRF sube abonats por encima del ruido → entra como candidata top-K.
    expect(hybrid.tableNames).toContain('abonats')

    // Sin híbrido, el denso la deja fuera y no se consulta el léxico.
    askedLexically = false
    const denseOnly = await retrieveSchemaContext('qué abonado tiene más', deps, { topK: 2, maxTables: 2 })
    expect(askedLexically).toBe(false)
    expect(denseOnly.tableNames).not.toContain('abonats')
  })

  it('selector LLM: elige el pivote enterrado y el grafo completa el destino-FK del JOIN', async () => {
    const byName: Record<string, TableSchema> = {
      abonats: tableWithFk('abonats', 'id_fiscal', 'dades_fiscals'),
      abo_linies: tableWithFk('abo_linies', 'id_abonat', 'abonats'),
      fib_linies: table('fib_linies'),
      dades_fiscals: table('dades_fiscals'),
      ruido_a: table('ruido_a'),
    }

    let selectorSawPool: string[] = []
    const deps: SchemaRetrievalDependencies = {
      rankTablesBySimilarity: async () => [
        { tableName: 'fib_linies', score: 0.9 },
        { tableName: 'abo_linies', score: 0.85 },
        { tableName: 'ruido_a', score: 0.8 },
        { tableName: 'abonats', score: 0.1 }, // el pivote, enterrado
        { tableName: 'dades_fiscals', score: 0.05 },
      ],
      // Fase pool: las anclas + vecinas (abonats entra por ser vecina de abo_linies;
      // dades_fiscals NO, está a dos saltos). Fase completado: al pedir 'abonats' llega 'dades_fiscals'.
      expandByForeignKeys: async (names) => {
        const out = new Set(names)
        if (names.includes('abo_linies')) out.add('abonats')
        if (names.includes('abonats')) out.add('dades_fiscals')
        out.add('ruido_a')
        return [...out].map((name) => byName[name] ?? table(name))
      },
      selectTables: async (_question, pool) => {
        selectorSawPool = pool.map((t) => t.name)
        return ['abonats', 'abo_linies', 'fib_linies']
      },
    }

    const context = await retrieveSchemaContext('razón social del abonado con más líneas', deps, {
      topK: 2,
      maxTables: 3,
      useSelector: true,
    })

    // El pivote estaba en el pool (aunque enterrado en el ranking) y el LLM lo eligió.
    expect(selectorSawPool).toContain('abonats')
    expect(context.tableNames).toContain('abonats')
    // 'dades_fiscals' no estaba en el pool; el completado por grafo lo trae como destino-FK de abonats.
    expect(selectorSawPool).not.toContain('dades_fiscals')
    expect(context.tableNames).toContain('dades_fiscals')
  })

  it('selector LLM: si el LLM falla (excepción), cae al recorte por score sin tumbar la recuperación', async () => {
    const deps: SchemaRetrievalDependencies = {
      rankTablesBySimilarity: async () => [
        { tableName: 'fib_linies', score: 0.9 },
        { tableName: 'abo_linies', score: 0.85 },
        { tableName: 'abonats', score: 0.1 },
      ],
      expandByForeignKeys: async (names) => names.map(table),
      selectTables: async () => {
        throw new Error('LM Studio no responde')
      },
    }

    const context = await retrieveSchemaContext('algo', deps, { topK: 2, maxTables: 2, useSelector: true })

    // El selector es una mejora, no un punto único de fallo: cae a `limited` (top-2 por score).
    expect(context.tableNames.sort()).toEqual(['abo_linies', 'fib_linies'])
  })

  it('selector LLM: una tabla fijada entra aunque el LLM no la elija (SPEC-08 manda)', async () => {
    const deps: SchemaRetrievalDependencies = {
      rankTablesBySimilarity: async () => [
        { tableName: 'abo_linies', score: 0.9 },
        { tableName: 'fib_linies', score: 0.8 },
        { tableName: 't_042', score: 0.05 }, // la fijada, con score ínfimo
      ],
      expandByForeignKeys: async (names) => names.map(table),
      selectTables: async () => ['abo_linies'], // el LLM ignora la fijada
    }

    const context = await retrieveSchemaContext('líneas', deps, {
      topK: 2,
      maxTables: 3,
      mustInclude: ['t_042'],
      useSelector: true,
    })

    expect(context.tableNames).toContain('abo_linies')
    expect(context.tableNames).toContain('t_042')
  })

  it('selector LLM: si no elige nada válido, cae al recorte por score', async () => {
    const deps: SchemaRetrievalDependencies = {
      rankTablesBySimilarity: async () => [
        { tableName: 'fib_linies', score: 0.9 },
        { tableName: 'abo_linies', score: 0.85 },
        { tableName: 'abonats', score: 0.1 },
      ],
      expandByForeignKeys: async (names) => names.map(table),
      selectTables: async () => ['tabla_inventada'], // nada del pool → fallback
    }

    const context = await retrieveSchemaContext('algo', deps, { topK: 2, maxTables: 2, useSelector: true })

    // Cae a `limited` (top-2 por score): sin abonats.
    expect(context.tableNames.sort()).toEqual(['abo_linies', 'fib_linies'])
  })

  it('ignora una tabla fijada que no existe en el esquema (no fija un fantasma)', async () => {
    let expandedFrom: string[] = []
    const deps: SchemaRetrievalDependencies = {
      rankTablesBySimilarity: async () => [
        { tableName: 'customer', score: 0.9 },
        { tableName: 'region', score: 0.7 },
      ],
      expandByForeignKeys: async (names) => {
        expandedFrom = names
        return names.map(table)
      },
    }

    const context = await retrieveSchemaContext('clientes', deps, { mustInclude: ['tabla_inexistente'] })

    expect(expandedFrom).not.toContain('tabla_inexistente')
    expect(context.tableNames).not.toContain('tabla_inexistente')
  })
})
