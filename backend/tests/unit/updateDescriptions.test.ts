/**
 * Tests de la actualización incremental de descripciones (SPEC-29), con dobles:
 * el diff puro, que solo se re-embebe lo afectado, el contrato de coste cero sin
 * cambios, y las guardas de índice inexistente o de otra BD.
 */
import { describe, it, expect } from 'vitest'
import {
  diffDescriptions,
  updateIndexedDescriptions,
  type UpdateDescriptionsDependencies,
  type EmbeddingUpsert,
} from '../../src/graphsql/application/scan/updateDescriptions'
import type { TableSchema } from '../../src/graphsql/domain/schema/TableSchema'
import type { TargetDatabaseConfig } from '../../src/graphsql/infrastructure/config/targetDatabases'

const target = { name: 'arcadia' } as TargetDatabaseConfig

function makeTable(name: string): TableSchema {
  return { name, schema: 'public', description: null, columns: [{ name: 'id', type: 'int', nullable: false }], primaryKeys: ['id'], foreignKeys: [] }
}

interface DoubleOptions {
  indexedModel?: { provider: string; model: string; dimensions: number; targetName: string | null } | null
  indexedDescriptions?: Map<string, string | null>
  schema?: TableSchema[]
}

/** Deps dobles que registran qué se embebió y qué se escribió en cada almacén. */
function makeDeps(options: DoubleOptions = {}) {
  const embedded: string[] = []
  const upserted: EmbeddingUpsert[] = []
  let graphChanges: Map<string, string | null> | null = null

  const deps: UpdateDescriptionsDependencies = {
    readIndexedModel: async () =>
      options.indexedModel === undefined
        ? { provider: 'local', model: 'bge-m3', dimensions: 4, targetName: 'arcadia' }
        : options.indexedModel,
    readIndexedDescriptions: async () => options.indexedDescriptions ?? new Map(),
    readSchema: async () => options.schema ?? [],
    embeddingsForIndex: () => ({
      provider: 'local',
      model: 'bge-m3',
      dimensions: 4,
      embed: async () => [0, 0, 0, 0],
      embedMany: async (texts: string[]) => {
        embedded.push(...texts)
        return texts.map(() => [0, 0, 0, 0])
      },
    }),
    upsertEmbeddings: async (rows) => {
      upserted.push(...rows)
    },
    updateGraphDescriptions: async (changes) => {
      graphChanges = changes
    },
  }
  return { deps, embedded, upserted, graph: () => graphChanges }
}

describe('diffDescriptions', () => {
  it('clasifica nuevas, modificadas, eliminadas y desconocidas', () => {
    const indexed = new Map<string, string | null>([
      ['game', null],
      ['customer', 'Clientes de la plataforma'],
      ['region', 'Regiones'],
    ])
    const incoming = new Map([
      ['game', 'Catálogo de juegos'],
      ['customer', 'Clientes registrados'],
      ['fantasma', 'Tabla que no existe en el índice'],
    ])
    const diff = diffDescriptions(indexed, incoming)
    expect(diff.added).toEqual(['game'])
    expect(diff.changed).toEqual(['customer'])
    expect(diff.removed).toEqual(['region'])
    expect(diff.unknown).toEqual(['fantasma'])
  })

  it('sin diferencias, todos los conjuntos quedan vacíos', () => {
    const indexed = new Map<string, string | null>([['game', 'Catálogo'], ['region', null]])
    const incoming = new Map([['game', 'Catálogo']])
    const diff = diffDescriptions(indexed, incoming)
    expect(diff).toEqual({ added: [], changed: [], removed: [], unknown: [] })
  })
})

describe('updateIndexedDescriptions', () => {
  it('re-embebe solo las tablas afectadas y actualiza los dos almacenes con lo mismo', async () => {
    const { deps, embedded, upserted, graph } = makeDeps({
      indexedDescriptions: new Map([
        ['game', null],
        ['customer', 'Vieja descripción'],
        ['region', 'Regiones'],
      ]),
      schema: [makeTable('game'), makeTable('customer'), makeTable('region')],
    })
    const summary = await updateIndexedDescriptions(
      target,
      new Map([
        ['game', 'Catálogo de juegos'],
        ['customer', 'Clientes registrados'],
        ['region', 'Regiones'],
      ]),
      deps,
    )

    expect(summary.embedded).toBe(2)
    expect(summary.totalIndexed).toBe(3)
    expect(upserted.map((row) => row.table.name).sort()).toEqual(['customer', 'game'])
    expect(embedded).toHaveLength(2)
    expect(embedded[0]).toContain('Catálogo de juegos')
    // La misma descripción va al grafo: los dos almacenes no pueden divergir.
    expect(graph()).toEqual(new Map([['game', 'Catálogo de juegos'], ['customer', 'Clientes registrados']]))
  })

  it('sin cambios no llama al proveedor de embeddings ni escribe nada', async () => {
    const { deps, embedded, upserted, graph } = makeDeps({
      indexedDescriptions: new Map([['game', 'Catálogo']]),
      schema: [makeTable('game')],
    })
    const summary = await updateIndexedDescriptions(target, new Map([['game', 'Catálogo']]), deps)
    expect(summary.embedded).toBe(0)
    expect(embedded).toHaveLength(0)
    expect(upserted).toHaveLength(0)
    expect(graph()).toBeNull()
  })

  it('una descripción eliminada del JSON se re-embebe sin descripción', async () => {
    const { deps, upserted, graph } = makeDeps({
      indexedDescriptions: new Map([['game', 'Catálogo']]),
      schema: [makeTable('game')],
    })
    const summary = await updateIndexedDescriptions(target, new Map(), deps)
    expect(summary.diff.removed).toEqual(['game'])
    expect(upserted[0].description).toBeNull()
    expect(upserted[0].searchText).not.toContain('Descripción')
    expect(graph()).toEqual(new Map([['game', null]]))
  })

  it('sin índice, o con índice de otra BD, falla con un mensaje que pide escaneo completo', async () => {
    const sinIndice = makeDeps({ indexedModel: null })
    await expect(updateIndexedDescriptions(target, new Map(), sinIndice.deps)).rejects.toThrow(/escaneo completo/)

    const otraBd = makeDeps({ indexedModel: { provider: 'local', model: 'bge-m3', dimensions: 4, targetName: 'nebula' } })
    await expect(updateIndexedDescriptions(target, new Map(), otraBd.deps)).rejects.toThrow(/nebula/)
  })

  it('las entradas del JSON sin tabla en el índice se ignoran (no se embeben)', async () => {
    const { deps, embedded } = makeDeps({
      indexedDescriptions: new Map([['game', 'Catálogo']]),
      schema: [makeTable('game')],
    })
    const summary = await updateIndexedDescriptions(
      target,
      new Map([
        ['game', 'Catálogo'],
        ['tabla_del_erp', 'Descripción de otra BD'],
      ]),
      deps,
    )
    expect(summary.diff.unknown).toEqual(['tabla_del_erp'])
    expect(embedded).toHaveLength(0)
  })
})
