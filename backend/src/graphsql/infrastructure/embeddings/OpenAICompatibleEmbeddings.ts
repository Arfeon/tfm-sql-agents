/**
 * Adaptador de embeddings sobre la API OpenAI-compatible (OpenAI y LM Studio; solo
 * cambia el `baseUrl`). Llamo a `/v1/embeddings` con `encoding_format: "float"` y NO
 * uso el cliente de LangChain a propósito: con LM Studio devolvía vectores de ceros
 * (por cómo el SDK maneja base64); pidiendo floats explícitos obtengo el vector real.
 */
import { z } from 'zod'
import type { IEmbeddings } from '../../domain/ports/IEmbeddings'

/** Respuesta de `/v1/embeddings`: valida que cada vector sea realmente una lista de números. */
const embeddingsResponseSchema = z.object({
  data: z.array(z.object({ embedding: z.array(z.number()) })).optional(),
})

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

    const payload = embeddingsResponseSchema.safeParse(await response.json())
    if (!payload.success) {
      throw new Error('Respuesta de embeddings inesperada: el cuerpo no tiene el formato de la API (data[].embedding numérico).')
    }
    const vectors = payload.data.data?.map((item) => item.embedding)
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
    const isAllZeros = (vector: number[]) => vector.every((value) => value === 0)
    if (vectors.every(isAllZeros)) {
      throw new Error(
        'El servidor de embeddings devolvió vectores de ceros. Comprueba que el modelo de embeddings esté cargado y sirva vectores reales.',
      )
    }
  }
}
