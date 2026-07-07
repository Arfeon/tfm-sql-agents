/**
 * Factory de embeddings. OpenAI y local comparten adaptador (API OpenAI-compatible):
 * solo cambian `baseUrl` y si paso la dimensión al API.
 */
import type { IEmbeddings } from '../../domain/ports/IEmbeddings'
import { EmbeddingProvider } from './EmbeddingProvider'
import { OpenAICompatibleEmbeddings } from './OpenAICompatibleEmbeddings'

export class EmbeddingsFactory {
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

  /**
   * Reconstruyo el modelo con el que se indexó, no el del `.env`: para consultar
   * hay que estar en el mismo espacio vectorial con el que se vectorizó (SPEC-04).
   */
  static forIndexedModel(
    indexed: { provider: string; model: string; dimensions: number },
    env: NodeJS.ProcessEnv = process.env,
  ): IEmbeddings {
    const provider = indexed.provider as EmbeddingProvider
    switch (provider) {
      case EmbeddingProvider.OpenAI:
        return new OpenAICompatibleEmbeddings({
          apiKey: env.OPENAI_API_KEY ?? '',
          model: indexed.model,
          dimensions: indexed.dimensions,
          sendDimensions: true,
        })
      case EmbeddingProvider.Local:
        return new OpenAICompatibleEmbeddings({
          apiKey: env.LMSTUDIO_API_KEY ?? 'lm-studio',
          model: indexed.model,
          dimensions: indexed.dimensions,
          baseUrl: env.LMSTUDIO_BASE_URL ?? 'http://localhost:1234/v1',
          sendDimensions: false,
        })
      default:
        throw new Error(
          `Proveedor de embeddings indexado no soportado: "${indexed.provider}". Valores válidos: ${Object.values(EmbeddingProvider).join(', ')}.`,
        )
    }
  }
}
