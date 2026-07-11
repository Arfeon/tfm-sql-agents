/**
 * Selección de esquema con LLM (schema linking por razonamiento): donde la similitud no
 * rescata el pivote, un LLM lee la pregunta y elige las tablas relevantes del pool. Devuelve
 * SOLO nombres del pool, nunca inventa; si algo falla, la recuperación cae al recorte por score.
 */
import { ChatModelFactory } from '../../infrastructure/llm/ChatModelFactory'
import { loadAgentPrompt } from '../../infrastructure/config/agentPrompts'
import { extractJsonArray } from '../llmReply'
import type { IChatModel } from '../../domain/ports/IChatModel'
import type { TableSchema } from '../../domain/schema/TableSchema'

export interface SchemaSelectionDependencies {
  createChatModel(): IChatModel
}

export const defaultSchemaSelectionDependencies: SchemaSelectionDependencies = {
  // Razonamiento: pensar qué tablas hacen falta (no escribe SQL).
  createChatModel: () => ChatModelFactory.fromEnv('reasoning'),
}

/** Resumen compacto de una tabla para el prompt: nombre + columnas (+ descripción si hay). */
function summarizeTable(table: TableSchema): string {
  const columns = table.columns.map((column) => column.name).join(', ')
  const description = table.description ? ` — ${table.description}` : ''
  return `- ${table.name}${description} (columnas: ${columns})`
}

/**
 * Interpreta la respuesta del LLM (lista JSON o nombres sueltos) y se queda SOLO con los
 * nombres que existen en el pool: el selector nunca puede inventar una tabla.
 */
export function parseSelectedTables(reply: string, poolNames: Set<string>): string[] {
  const candidates = new Set<string>()
  for (const item of extractJsonArray(reply) ?? []) {
    if (typeof item === 'string') {
      candidates.add(item.trim())
    }
  }
  // Sin lista JSON válida, caigo al troceo por tokens de la respuesta entera.
  if (candidates.size === 0) {
    for (const token of reply.split(/[^A-Za-z0-9_]+/)) {
      if (token) {
        candidates.add(token)
      }
    }
  }
  return [...candidates].filter((name) => poolNames.has(name))
}

export async function selectRelevantTables(
  question: string,
  pool: TableSchema[],
  deps: SchemaSelectionDependencies = defaultSchemaSelectionDependencies,
): Promise<string[]> {
  if (pool.length === 0) {
    return []
  }
  const model = deps.createChatModel()
  const catalog = pool.map(summarizeTable).join('\n')
  const reply = await model.chat([
    { role: 'system', content: loadAgentPrompt('schema-selector') },
    {
      role: 'user',
      content: `Pregunta: ${question}\n\nTablas candidatas:\n${catalog}\n\nDevuelve SOLO los nombres de las tablas necesarias, como lista JSON.`,
    },
  ])
  return parseSelectedTables(reply, new Set(pool.map((table) => table.name)))
}
