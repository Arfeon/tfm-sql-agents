/**
 * Tests unitarios del factory de embeddings y de la composición del texto.
 *
 * No tocan red: solo compruebo que el factory crea un adaptador según el
 * proveedor, que un proveedor desconocido falla, y la lógica pura de texto y
 * parseo de descripciones.
 */
import { describe, it, expect } from 'vitest'
import { EmbeddingsFactory } from '../../src/graphsql/infrastructure/embeddings/EmbeddingsFactory'
import { EmbeddingProvider } from '../../src/graphsql/infrastructure/embeddings/EmbeddingProvider'
import { OpenAICompatibleEmbeddings } from '../../src/graphsql/infrastructure/embeddings/OpenAICompatibleEmbeddings'
import { composeSearchText } from '../../src/graphsql/application/schemaVectorization'
import { parseDescriptions } from '../../src/graphsql/infrastructure/config/descriptions'
import type { TableSchema } from '../../src/graphsql/domain/schema/TableSchema'

const TABLE: TableSchema = {
  name: 'game',
  schema: null,
  columns: [
    { name: 'game_id', type: 'integer', nullable: false },
    { name: 'title', type: 'text', nullable: false },
  ],
  primaryKeys: ['game_id'],
  foreignKeys: [],
}

describe('EmbeddingsFactory', () => {
  it('create_providerOpenai_devuelveAdaptador', () => {
    expect(EmbeddingsFactory.create(EmbeddingProvider.OpenAI)).toBeInstanceOf(OpenAICompatibleEmbeddings)
  })

  it('create_providerLocal_devuelveAdaptador', () => {
    expect(EmbeddingsFactory.create(EmbeddingProvider.Local)).toBeInstanceOf(OpenAICompatibleEmbeddings)
  })

  it('create_providerDesconocido_lanzaError', () => {
    expect(() => EmbeddingsFactory.create('cohere' as EmbeddingProvider)).toThrow(/no soportado/)
  })

  it('create_leeModeloYDimensionDelProveedor', () => {
    const embeddings = EmbeddingsFactory.create(EmbeddingProvider.OpenAI, {
      OPENAI_API_KEY: 'test',
      OPENAI_EMBEDDING_MODEL: 'text-embedding-3-large',
      OPENAI_EMBEDDING_DIMENSIONS: '3072',
    })
    expect(embeddings.model).toBe('text-embedding-3-large')
    expect(embeddings.dimensions).toBe(3072)
  })
})

describe('composeSearchText', () => {
  it('incluye nombre y columnas', () => {
    const text = composeSearchText(TABLE)
    expect(text).toContain('Tabla: game')
    expect(text).toContain('game_id, title')
    expect(text).not.toContain('Descripción')
  })

  it('incluye la descripción cuando se aporta', () => {
    const text = composeSearchText(TABLE, 'Catálogo de juegos')
    expect(text).toContain('Descripción: Catálogo de juegos')
  })
})

describe('parseDescriptions', () => {
  it('convierte el array a un mapa tabla→descripción', () => {
    const map = parseDescriptions('[{"tableName":"game","description":"x"},{"tableName":"company","description":"y"}]')
    expect(map.get('game')).toBe('x')
    expect(map.get('company')).toBe('y')
  })

  it('lanza error si el JSON no tiene el formato esperado', () => {
    expect(() => parseDescriptions('[{"name":"game"}]')).toThrow()
  })
})
