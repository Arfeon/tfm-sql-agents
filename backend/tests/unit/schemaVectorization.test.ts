/**
 * Tests unitarios del caso de uso de vectorización.
 *
 * No tocan red ni pgvector: uso unos embeddings falsos (devuelven un vector
 * predecible por texto) y un almacén falso en memoria que apunta lo que recibe.
 * Compruebo que cada tabla se guarda con su nombre cualificado, su texto de
 * búsqueda y su vector, que el resumen cuadra, y que el almacén se cierra
 * siempre (también si falla un guardado).
 */
import { describe, it, expect } from 'vitest'
import { vectorizeSchema, composeSearchText } from '../../src/graphsql/application/schemaVectorization'
import type { SchemaVectorizationDependencies } from '../../src/graphsql/application/schemaVectorization'
import type { IEmbeddingsStore } from '../../src/graphsql/domain/ports/IEmbeddingsStore'
import type { IEmbeddings } from '../../src/graphsql/domain/ports/IEmbeddings'
import type { TableSchema } from '../../src/graphsql/domain/schema/TableSchema'
import type { TargetDatabaseConfig } from '../../src/graphsql/infrastructure/config/targetDatabases'

const TARGET: TargetDatabaseConfig = {
  type: 'postgresql',
  name: 'arcadia',
  host: 'localhost',
  port: 5432,
  user: 'postgres',
  password: 'postgres',
  schema: 'public',
}

const TABLES: TableSchema[] = [
  { name: 'game', schema: 'catalog', columns: [{ name: 'game_id', type: 'integer', nullable: false }], primaryKeys: ['game_id'], foreignKeys: [] },
  { name: 'company', schema: null, columns: [], primaryKeys: [], foreignKeys: [] },
]

/** Embeddings falsos: cada texto se convierte en un vector con su índice repetido. */
class FakeEmbeddings implements IEmbeddings {
  readonly model = 'fake-model'
  readonly dimensions = 3
  async embed(): Promise<number[]> {
    return [0, 0, 0]
  }
  async embedMany(texts: string[]): Promise<number[][]> {
    return texts.map((_, index) => [index, index, index])
  }
}

interface RecordedUpsert {
  tableName: string
  fullName: string
  provider: string
  description: string | null
  searchText: string
  embedding: number[]
  model: string
  dimensions: number
}

/** Almacén falso en memoria: apunta las llamadas para poder aseverarlas. */
class FakeEmbeddingsStore implements IEmbeddingsStore {
  preparedDimensions?: number
  upserts: RecordedUpsert[] = []
  closed = false

  async prepare(dimensions: number): Promise<void> {
    this.preparedDimensions = dimensions
  }
  async upsertTable(
    tableName: string,
    fullName: string,
    provider: string,
    description: string | null,
    searchText: string,
    embedding: number[],
    model: string,
    dimensions: number,
  ): Promise<void> {
    this.upserts.push({ tableName, fullName, provider, description, searchText, embedding, model, dimensions })
  }
  async count(): Promise<number> {
    return this.upserts.length
  }
  async close(): Promise<void> {
    this.closed = true
  }
}

describe('vectorizeSchema', () => {
  it('guardaCadaTablaConSuNombreCualificadoTextoYVector', async () => {
    const store = new FakeEmbeddingsStore()
    const deps: SchemaVectorizationDependencies = {
      readSchema: async () => TABLES,
      openEmbeddingsStore: async () => store,
    }

    const summary = await vectorizeSchema(TARGET, 'openai', new FakeEmbeddings(), new Map([['game', 'juegos']]), deps)

    expect(store.preparedDimensions).toBe(3)
    expect(store.upserts).toHaveLength(2)

    // game lleva esquema -> nombre cualificado, y la descripción aportada.
    expect(store.upserts[0]).toMatchObject({
      tableName: 'game',
      fullName: 'catalog.game',
      provider: 'openai',
      description: 'juegos',
      searchText: composeSearchText(TABLES[0], 'juegos'),
      embedding: [0, 0, 0],
      model: 'fake-model',
      dimensions: 3,
    })
    // company no tiene esquema ni descripción.
    expect(store.upserts[1]).toMatchObject({ tableName: 'company', fullName: 'company', description: null })

    expect(summary).toEqual({ count: 2, provider: 'openai', model: 'fake-model', dimensions: 3 })
    expect(store.closed).toBe(true)
  })

  it('cierraElAlmacenAunqueFalleUnGuardado', async () => {
    const store = new FakeEmbeddingsStore()
    store.upsertTable = async () => {
      throw new Error('fallo al guardar')
    }
    const deps: SchemaVectorizationDependencies = {
      readSchema: async () => TABLES,
      openEmbeddingsStore: async () => store,
    }

    await expect(vectorizeSchema(TARGET, 'openai', new FakeEmbeddings(), undefined, deps)).rejects.toThrow('fallo al guardar')
    expect(store.closed).toBe(true)
  })
})
