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

function table(name: string): TableSchema {
  return { name, schema: null, columns: [{ name: `${name}_id`, type: 'integer', nullable: false }], primaryKeys: [`${name}_id`], foreignKeys: [] }
}

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
