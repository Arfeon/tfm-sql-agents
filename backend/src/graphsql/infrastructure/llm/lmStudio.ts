/**
 * Consulta qué modelos tiene cargados LM Studio, para avisar antes de usar uno
 * que no esté disponible (en local hacen falta chat y embeddings a la vez).
 */
import { z } from 'zod'

/** Respuesta de `GET /models` (formato OpenAI): solo nos interesa el id de cada modelo. */
const modelsResponseSchema = z.object({
  data: z.array(z.object({ id: z.string() })).optional(),
})

export async function listLoadedModels(baseUrl: string): Promise<string[]> {
  const url = `${baseUrl.replace(/\/$/, '')}/models`
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`El servidor local respondió ${response.status} en ${url}`)
  }
  const body = modelsResponseSchema.safeParse(await response.json())
  if (!body.success) {
    throw new Error(`La respuesta de ${url} no tiene el formato esperado (lista de modelos de la API OpenAI).`)
  }
  return (body.data.data ?? []).map((model) => model.id)
}
