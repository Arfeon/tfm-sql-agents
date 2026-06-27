/**
 * Utilidades del servidor local (LM Studio), API OpenAI-compatible.
 *
 * En local necesito tener cargados a la vez el modelo de chat y el de
 * embeddings. Esto consulta qué modelos están cargados para poder avisar antes
 * de usar uno que no esté disponible.
 */

/** Lista los identificadores de los modelos cargados en el servidor (GET /v1/models). */
export async function listLoadedModels(baseUrl: string): Promise<string[]> {
  const url = `${baseUrl.replace(/\/$/, '')}/models`
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`El servidor local respondió ${response.status} en ${url}`)
  }
  const body = (await response.json()) as { data?: Array<{ id: string }> }
  return (body.data ?? []).map((model) => model.id)
}
