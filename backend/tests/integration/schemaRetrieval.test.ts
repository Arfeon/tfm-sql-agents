/**
 * Test de integración de la recuperación GraphRAG (SPEC-04).
 *
 * Recupera sobre la Arcadia real (pgvector + Neo4j), así que comprueba lo que los
 * unitarios no pueden: el mapeo multilingüe (español → esquema en inglés) y la
 * búsqueda por descripción de la tabla de nombre opaco `t_042`.
 *
 * Opt-in (`npm run test:integration`) y se salta si falta el proveedor de
 * embeddings. Requiere docker compose up -d y el esquema ya vectorizado
 * (con las descripciones incluidas).
 */
import { describe, it, expect } from 'vitest'
import { retrieveSchemaContext } from '../../src/graphsql/application/schemaRetrieval'
import { EmbeddingProvider } from '../../src/graphsql/infrastructure/embeddings/EmbeddingProvider'

const provider = (process.env.EMBEDDING_PROVIDER ?? EmbeddingProvider.OpenAI) as EmbeddingProvider
const hasCredentials =
  provider === EmbeddingProvider.OpenAI ? Boolean(process.env.OPENAI_API_KEY) : Boolean(process.env.LMSTUDIO_BASE_URL)

describe.skipIf(!hasCredentials)(`retrieveSchemaContext (integración, provider=${provider})`, () => {
  it(
    'mapea "clientes" (es) a la tabla customer (en)',
    async () => {
      const context = await retrieveSchemaContext('¿cuántos clientes hay en cada región?')
      console.log(`\n🔎 "clientes por región" → ${context.tableNames.join(', ')}\n`)
      expect(context.tableNames).toContain('customer')
    },
    60_000,
  )

  it(
    'encuentra la tabla de nombre opaco t_042 por su descripción (lista de deseos)',
    async () => {
      const context = await retrieveSchemaContext('¿qué juegos tiene un cliente en su lista de deseos?')
      console.log(`\n🔎 "lista de deseos" → ${context.tableNames.join(', ')}\n`)
      expect(context.tableNames).toContain('t_042')
    },
    60_000,
  )
})
