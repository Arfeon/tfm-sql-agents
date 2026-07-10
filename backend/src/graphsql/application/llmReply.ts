/**
 * Extracción tolerante del JSON de una respuesta de LLM (primer bloque, texto alrededor
 * ignorado, inválido = nada). Compartida por el juez, la equivalencia y el selector para
 * que sus reglas de tolerancia no evolucionen por separado.
 */

/** Primer objeto JSON ({…}) de la respuesta, parseado; undefined si no hay o no es válido. */
export function extractJsonObject(reply: string): Record<string, unknown> | undefined {
  const parsed = extractFirst(reply, /\{[\s\S]*\}/)
  return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : undefined
}

/** Primera lista JSON ([…]) de la respuesta, parseada; undefined si no hay o no es válida. */
export function extractJsonArray(reply: string): unknown[] | undefined {
  const parsed = extractFirst(reply, /\[[\s\S]*\]/)
  return Array.isArray(parsed) ? parsed : undefined
}

function extractFirst(reply: string, pattern: RegExp): unknown {
  const match = reply.match(pattern)
  if (!match) {
    return undefined
  }
  try {
    return JSON.parse(match[0])
  } catch {
    return undefined
  }
}
