/**
 * Consulta qué modelos sirve un servidor con API OpenAI-compatible, para avisar antes de
 * usar uno que no esté disponible: en LM Studio hacen falta chat y embeddings cargados a la
 * vez, y en un gateway el nombre es un alias suyo que es fácil escribir mal.
 */
import { z } from 'zod'

/** Respuesta de `GET /models` (formato OpenAI): solo nos interesa el id de cada modelo. */
const modelsResponseSchema = z.object({
  data: z.array(z.object({ id: z.string() })).optional(),
})

/** La `apiKey` es opcional: LM Studio no la pide, un gateway devuelve 401 sin ella. */
export async function listLoadedModels(baseUrl: string, apiKey?: string): Promise<string[]> {
  const url = `${baseUrl.replace(/\/$/, '')}/models`
  const response = await fetch(url, {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
  })
  if (!response.ok) {
    throw new Error(`El servidor respondió ${response.status} en ${url}`)
  }
  const body = modelsResponseSchema.safeParse(await response.json())
  if (!body.success) {
    throw new Error(`La respuesta de ${url} no tiene el formato esperado (lista de modelos de la API OpenAI).`)
  }
  return (body.data.data ?? []).map((model) => model.id)
}
