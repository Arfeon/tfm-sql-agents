/**
 * Factory de embeddings. OpenAI y local comparten adaptador (API OpenAI-compatible):
 * solo cambian `baseUrl` y si paso la dimensión al API.
 */
import type { IEmbeddings } from '../../domain/ports/IEmbeddings'
import { loadEnv } from '../config/env'
import { EmbeddingProvider } from './EmbeddingProvider'
import { OpenAICompatibleEmbeddings } from './OpenAICompatibleEmbeddings'

export class EmbeddingsFactory {
  static create(provider: EmbeddingProvider, env: NodeJS.ProcessEnv = process.env): IEmbeddings {
    const vars = loadEnv(env)
    switch (provider) {
      case EmbeddingProvider.OpenAI:
        return new OpenAICompatibleEmbeddings({
          apiKey: vars.OPENAI_API_KEY,
          model: vars.OPENAI_EMBEDDING_MODEL,
          dimensions: vars.OPENAI_EMBEDDING_DIMENSIONS,
          sendDimensions: true, // text-embedding-3 admite reducir dimensión
        })
      case EmbeddingProvider.Local:
        return new OpenAICompatibleEmbeddings({
          apiKey: vars.LMSTUDIO_API_KEY,
          model: vars.LMSTUDIO_EMBEDDING_MODEL,
          dimensions: vars.LMSTUDIO_EMBEDDING_DIMENSIONS,
          baseUrl: vars.LMSTUDIO_BASE_URL,
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
    const provider = (loadEnv(env).EMBEDDING_PROVIDER ?? EmbeddingProvider.OpenAI) as EmbeddingProvider
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
    const vars = loadEnv(env)
    const provider = indexed.provider as EmbeddingProvider
    switch (provider) {
      case EmbeddingProvider.OpenAI:
        return new OpenAICompatibleEmbeddings({
          apiKey: vars.OPENAI_API_KEY,
          model: indexed.model,
          dimensions: indexed.dimensions,
          sendDimensions: true,
        })
      case EmbeddingProvider.Local:
        return new OpenAICompatibleEmbeddings({
          apiKey: vars.LMSTUDIO_API_KEY,
          model: indexed.model,
          dimensions: indexed.dimensions,
          baseUrl: vars.LMSTUDIO_BASE_URL,
          sendDimensions: false,
        })
      default:
        throw new Error(
          `Proveedor de embeddings indexado no soportado: "${indexed.provider}". Valores válidos: ${Object.values(EmbeddingProvider).join(', ')}.`,
        )
    }
  }
}
