/**
 * Adaptador de embeddings sobre la API OpenAI-compatible.
 *
 * Sirve tanto para OpenAI como para LM Studio (local): solo cambia el `baseUrl`.
 * Envuelve `OpenAIEmbeddings` de LangChain. La `dimension` configurada se usa
 * para la columna pgvector y para guardarla junto al vector; solo se la paso al
 * API de OpenAI (`sendDimensions`), porque los modelos de la familia
 * text-embedding-3 admiten reducir dimensión, mientras que un modelo local tiene
 * su dimensión nativa fija.
 */
import { OpenAIEmbeddings } from '@langchain/openai'
import type { IEmbeddings } from '../../domain/ports/IEmbeddings'

export interface OpenAICompatibleEmbeddingsConfig {
  apiKey: string
  model: string
  dimensions: number
  baseUrl?: string
  sendDimensions: boolean
}

export class OpenAICompatibleEmbeddings implements IEmbeddings {
  readonly model: string
  readonly dimensions: number
  private readonly client: OpenAIEmbeddings

  constructor(config: OpenAICompatibleEmbeddingsConfig) {
    this.model = config.model
    this.dimensions = config.dimensions
    this.client = new OpenAIEmbeddings({
      apiKey: config.apiKey,
      model: config.model,
      dimensions: config.sendDimensions ? config.dimensions : undefined,
      configuration: config.baseUrl ? { baseURL: config.baseUrl } : undefined,
    })
  }

  embed(text: string): Promise<number[]> {
    return this.client.embedQuery(text)
  }

  embedMany(texts: string[]): Promise<number[][]> {
    return this.client.embedDocuments(texts)
  }
}
