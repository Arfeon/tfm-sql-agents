/**
 * Juez LLM de equivalencia semántica entre dos SQL (SPEC-11, D-11). Es una métrica
 * COMPLEMENTARIA a la execution accuracy, nunca la titular: un LLM también se equivoca
 * juzgando equivalencia, así que la reporto al lado, no en su lugar.
 */
import { z } from 'zod'
import { ChatModelFactory } from '../../infrastructure/llm/ChatModelFactory'
import { loadAgentPrompt } from '../../infrastructure/config/agentPrompts'
import type { IChatModel } from '../../domain/ports/IChatModel'
import type { ResultRow } from './evaluationMetrics'
import { extractJsonObject } from '../llmReply'

export interface EquivalenceVerdict {
  equivalent: boolean
  reason: string
}

/** La respuesta esperada del juez: `equivalent` es imprescindible; un `reason` ilegible queda vacío. */
const equivalenceReplySchema = z.object({
  equivalent: z.boolean(),
  reason: z.string().catch(''),
})

export interface SqlEquivalenceDependencies {
  createChatModel(): IChatModel
}

export const defaultSqlEquivalenceDependencies: SqlEquivalenceDependencies = {
  // Generación: comparar dos SQL por equivalencia es tarea centrada en SQL.
  createChatModel: () => ChatModelFactory.fromEnv('generation'),
}

export function buildEquivalenceSystemPrompt(dialect: string): string {
  return loadAgentPrompt('equivalence-judge', { dialect })
}

/** Una respuesta ilegible cuenta como NO equivalente (conservador: no inflar aciertos). */
export function parseEquivalenceVerdict(raw: string): EquivalenceVerdict {
  const reply = equivalenceReplySchema.safeParse(extractJsonObject(raw))
  return reply.success ? reply.data : notInterpretable()
}

function notInterpretable(): EquivalenceVerdict {
  return { equivalent: false, reason: 'No se pudo interpretar el veredicto de equivalencia del LLM.' }
}

/** Los resultados de ejecutar ambas consultas, para anclar el veredicto en evidencia real. */
export interface ExecutedResults {
  reference: ResultRow[]
  candidate: ResultRow[]
}

/** Filas de muestra que le enseño al juez de cada resultado (las demás se resumen en el conteo). */
const RESULT_SAMPLE_ROWS = 20

export function formatResultForJudge(label: string, rows: ResultRow[]): string {
  // Ordeno la muestra de forma canónica: si un resultado viene sin ORDER BY y el otro
  // ordenado, las "primeras N filas" de cada uno serían ventanas incomparables y el juez
  // vería conjuntos distintos donde no los hay (falso negativo visto en la auditoría 2026-07-09).
  const canonical = [...rows].sort((a, b) =>
    JSON.stringify(Object.values(a)).localeCompare(JSON.stringify(Object.values(b))),
  )
  const sample = canonical.slice(0, RESULT_SAMPLE_ROWS)
  const truncationNote =
    rows.length > RESULT_SAMPLE_ROWS
      ? `(muestra de ${RESULT_SAMPLE_ROWS} de ${rows.length} filas, ordenada de forma canónica)`
      : `(${rows.length} filas en total)`
  return `Resultado ejecutado de la ${label} ${truncationNote}:\n${JSON.stringify(sample)}`
}

/** La ejecutabilidad de la candidata es precondición del que llama (SPEC-11). */
export async function judgeQueryEquivalence(
  question: string,
  referenceSql: string,
  candidateSql: string,
  dialect: string,
  results?: ExecutedResults,
  deps: SqlEquivalenceDependencies = defaultSqlEquivalenceDependencies,
): Promise<EquivalenceVerdict> {
  const model = deps.createChatModel()
  const userMessageParts = [
    `Pregunta: ${question}`,
    `Consulta de REFERENCIA:\n${referenceSql}`,
    `Consulta CANDIDATA:\n${candidateSql}`,
  ]
  if (results) {
    userMessageParts.push(formatResultForJudge('REFERENCIA', results.reference), formatResultForJudge('CANDIDATA', results.candidate))
  }
  const reply = await model.chat([
    { role: 'system', content: buildEquivalenceSystemPrompt(dialect) },
    { role: 'user', content: userMessageParts.join('\n\n') },
  ])
  return parseEquivalenceVerdict(reply)
}
