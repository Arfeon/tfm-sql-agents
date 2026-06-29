/**
 * Adaptador de embeddings sobre la API OpenAI-compatible (OpenAI y LM Studio).
 *
 * Llamo directamente a `/v1/embeddings` con `encoding_format: "float"`. NO uso el
 * cliente de embeddings de LangChain a propósito: con LM Studio devolvía vectores
 * de ceros (por cómo el SDK maneja base64); pidiendo floats explícitos obtengo el
 * vector real. Sirve para los dos proveedores: solo cambia el `baseUrl`.
 *
 * `dimensions` solo se envía si el proveedor lo admite (familia text-embedding-3);
 * un modelo local usa su dimensión nativa. Para no guardar basura en silencio,
 * compruebo que la respuesta tenga la dimensión esperada y no sea un vector de ceros.
 */
import type { IEmbeddings } from '../../domain/ports/IEmbeddings'

export interface OpenAICompatibleEmbeddingsConfig {
  apiKey: string
  model: string
  dimensions: number
  baseUrl?: string
  sendDimensions: boolean
}

const OPENAI_BASE_URL = 'https://api.openai.com/v1'

export class OpenAICompatibleEmbeddings implements IEmbeddings {
  readonly model: string
  readonly dimensions: number
  private readonly apiKey: string
  private readonly baseUrl: string
  private readonly sendDimensions: boolean

  constructor(config: OpenAICompatibleEmbeddingsConfig) {
    this.model = config.model
    this.dimensions = config.dimensions
    this.apiKey = config.apiKey
    this.baseUrl = (config.baseUrl ?? OPENAI_BASE_URL).replace(/\/+$/, '')
    this.sendDimensions = config.sendDimensions
  }

  async embed(text: string): Promise<number[]> {
    const [vector] = await this.embedMany([text])
    return vector
  }

  async embedMany(texts: string[]): Promise<number[][]> {
    const body: Record<string, unknown> = {
      model: this.model,
      input: texts,
      encoding_format: 'float',
    }
    if (this.sendDimensions) {
      body.dimensions = this.dimensions
    }

    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const detail = await response.text()
      throw new Error(`La API de embeddings respondió ${response.status}: ${detail.slice(0, 300)}`)
    }

    const payload = (await response.json()) as { data?: { embedding: number[] }[] }
    const vectors = payload.data?.map((item) => item.embedding)
    if (!vectors || vectors.length !== texts.length) {
      throw new Error(`Respuesta de embeddings inesperada: esperaba ${texts.length} vectores, recibí ${vectors?.length ?? 0}.`)
    }
    this.assertUsable(vectors)
    return vectors
  }

  /** No quiero guardar basura en silencio: la dimensión debe cuadrar y no pueden ser todo ceros. */
  private assertUsable(vectors: number[][]): void {
    for (const vector of vectors) {
      if (vector.length !== this.dimensions) {
        throw new Error(
          `El modelo "${this.model}" devolvió ${vector.length} dimensiones, pero la configuración es ${this.dimensions}. ` +
            `Ajusta la dimensión del proveedor (p. ej. LMSTUDIO_EMBEDDING_DIMENSIONS / OPENAI_EMBEDDING_DIMENSIONS).`,
        )
      }
    }
    if (vectors.every((vector) => vector.every((value) => value === 0))) {
      throw new Error(
        'El servidor de embeddings devolvió vectores de ceros. Comprueba que el modelo de embeddings esté cargado y sirva vectores reales.',
      )
    }
  }
}
