/**
 * Consulta qué modelos tiene cargados LM Studio, para avisar antes de usar uno
 * que no esté disponible (en local hacen falta chat y embeddings a la vez).
 */
export async function listLoadedModels(baseUrl: string): Promise<string[]> {
  const url = `${baseUrl.replace(/\/$/, '')}/models`
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`El servidor local respondió ${response.status} en ${url}`)
  }
  const body = (await response.json()) as { data?: Array<{ id: string }> }
  return (body.data ?? []).map((model) => model.id)
}
