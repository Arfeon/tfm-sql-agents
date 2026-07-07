/**
 * Vectoriza Arcadia de verdad y comprueba que pgvector queda con un vector por tabla
 * y el modelo correcto. Opt-in; se salta si falta el proveedor de embeddings.
 */
import { describe, it, expect } from 'vitest'
import { vectorizeSchema } from '../../src/graphsql/application/schemaVectorization'
import { EmbeddingsFactory } from '../../src/graphsql/infrastructure/embeddings/EmbeddingsFactory'
import { EmbeddingProvider } from '../../src/graphsql/infrastructure/embeddings/EmbeddingProvider'
import { TableEmbeddingsStore } from '../../src/graphsql/infrastructure/postgres/TableEmbeddingsStore'
import { loadTargetDatabases } from '../../src/graphsql/infrastructure/config/targetDatabases'

const provider = (process.env.EMBEDDING_PROVIDER ?? EmbeddingProvider.OpenAI) as EmbeddingProvider
const hasCredentials =
  provider === EmbeddingProvider.OpenAI ? Boolean(process.env.OPENAI_API_KEY) : Boolean(process.env.LMSTUDIO_BASE_URL)

describe.skipIf(!hasCredentials)(`vectorizeSchema (integración, provider=${provider})`, () => {
  it(
    'vectoriza Arcadia y deja un vector por tabla en pgvector',
    async () => {
      const embeddings = EmbeddingsFactory.fromEnv()
      const summary = await vectorizeSchema(loadTargetDatabases()[0], provider, embeddings)

      console.log(`\n🔢 Vectorizadas ${summary.count} tablas (${summary.provider}, ${summary.model}, ${summary.dimensions} dims)\n`)

      expect(summary.count).toBe(17)
      expect(summary.model).toBe(embeddings.model)

      const store = await TableEmbeddingsStore.fromEnv()
      try {
        const indexed = await store.getIndexedModel()
        expect(indexed?.provider).toBe(provider)
        expect(indexed?.model).toBe(embeddings.model)
        expect(indexed?.dimensions).toBe(embeddings.dimensions)
      } finally {
        await store.close()
      }
    },
    180_000, // los embeddings locales en CPU pueden ir lentos
  )
})
