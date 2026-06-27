/**
 * Factory de embeddings.
 *
 * Elijo el proveedor (`EMBEDDING_PROVIDER`) y construyo el adaptador con su
 * config; igual que `ChatModelFactory`, solo creo el que se va a usar. OpenAI y
 * local comparten adaptador (API OpenAI-compatible) y solo cambian `baseUrl` y
 * si paso la dimensión al API.
 */
import type { IEmbeddings } from '../../domain/ports/IEmbeddings'
import { EmbeddingProvider } from './EmbeddingProvider'
import { OpenAICompatibleEmbeddings } from './OpenAICompatibleEmbeddings'

export class EmbeddingsFactory {
  // Config de embeddings por proveedor: el modelo y la dimensión dependen del
  // proveedor, así la elección en runtime escoge la suya.
  static create(provider: EmbeddingProvider, env: NodeJS.ProcessEnv = process.env): IEmbeddings {
    switch (provider) {
      case EmbeddingProvider.OpenAI:
        return new OpenAICompatibleEmbeddings({
          apiKey: env.OPENAI_API_KEY ?? '',
          model: env.OPENAI_EMBEDDING_MODEL ?? 'text-embedding-3-small',
          dimensions: parseInt(env.OPENAI_EMBEDDING_DIMENSIONS ?? '1536', 10),
          sendDimensions: true, // text-embedding-3 admite reducir dimensión
        })
      case EmbeddingProvider.Local:
        return new OpenAICompatibleEmbeddings({
          apiKey: env.LMSTUDIO_API_KEY ?? 'lm-studio',
          model: env.LMSTUDIO_EMBEDDING_MODEL ?? 'text-embedding-bge-m3',
          dimensions: parseInt(env.LMSTUDIO_EMBEDDING_DIMENSIONS ?? '1024', 10),
          baseUrl: env.LMSTUDIO_BASE_URL ?? 'http://localhost:1234/v1',
          sendDimensions: false, // el modelo local tiene su dimensión nativa fija
        })
      default:
        throw new Error(
          `Proveedor de embeddings no soportado: "${provider}". Valores válidos: ${Object.values(EmbeddingProvider).join(', ')}.`,
        )
    }
  }

  /** Proveedor por defecto (para tests/usos no interactivos); el CLI lo pregunta. */
  static fromEnv(env: NodeJS.ProcessEnv = process.env): IEmbeddings {
    const provider = (env.EMBEDDING_PROVIDER ?? EmbeddingProvider.OpenAI) as EmbeddingProvider
    return EmbeddingsFactory.create(provider, env)
  }
}
