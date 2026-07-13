/**
 * El Judge (SPEC-06): seguridad (siempre) + sintaxis contra la BD + juez LLM. Solo
 * las comprobaciones deterministas invalidan; el juez LLM aconseja pero no bloquea,
 * porque da falsos positivos (D-07).
 */
import { z } from 'zod'
import { ChatModelFactory } from '../../infrastructure/llm/ChatModelFactory'
import { loadAgentPrompt } from '../../infrastructure/config/agentPrompts'
import type { IChatModel } from '../../domain/ports/IChatModel'
import type { SchemaContext } from '../../domain/schema/SchemaContext'
import type { SqlStatement } from '../../domain/sql/SqlStatement'
import {
  type JudgeVerdict,
  type PurposeSource,
  securityFailureVerdict,
  syntaxFailureVerdict,
  checksPassedVerdict,
} from '../../domain/sql/JudgeVerdict'
import { checkSqlSafety } from '../../domain/sql/SqlSafetyPolicy'
import { JudgeResponseError } from '../../domain/sql/JudgeResponseError'
import { extractJsonObject } from '../llmReply'
import { checkSqlSyntax, type SqlSyntaxCheck } from './sqlSyntaxCheck'

export interface SqlJudgingDependencies {
  createChatModel(): IChatModel
  checkSyntax(sql: SqlStatement): Promise<SqlSyntaxCheck>
}

export const defaultSqlJudgingDependencies: SqlJudgingDependencies = {
  // Generación: evaluar SQL es una tarea centrada en SQL, va con el modelo de la SELECT.
  createChatModel: () => ChatModelFactory.fromEnv('generation'),
  checkSyntax: (sql) => checkSqlSyntax(sql),
}

export interface SqlJudgingOptions {
  useDbCheck?: boolean
  useLlmJudge?: boolean
  /** Umbral opcional del operador (0..1): por debajo, marco la consulta inválida. */
  minConfidence?: number
}

export function buildJudgeSystemPrompt(dialect: string): string {
  return loadAgentPrompt('judge', { dialect })
}

const PURPOSE_SOURCES = ['description', 'name', 'columns', 'assumed'] as const satisfies readonly PurposeSource[]

/** Lista tolerante: si no viene una lista, queda vacía; los elementos no-string se descartan. */
const tolerantStringList = z
  .array(z.unknown())
  .catch([])
  .transform((items) => items.filter((item): item is string => typeof item === 'string'))

/** Una fuente desconocida se trata como "assumed" (conservador); un propósito ilegible, como vacío. */
const tablePurposeSchema = z.object({
  table: z.string(),
  purpose: z.string().catch(''),
  source: z.enum(PURPOSE_SOURCES).catch('assumed'),
})

/** Lista tolerante de propósitos: los elementos sin `table` (string) se descartan. */
const tolerantTablePurposeList = z
  .array(z.unknown())
  .catch([])
  .transform((items) => items.flatMap((item) => tablePurposeSchema.safeParse(item).data ?? []))

/**
 * La respuesta esperada del juez LLM. Solo `valid` es imprescindible (sin él no hay
 * veredicto); el resto de campos son tolerantes: si el LLM los omite o los devuelve mal
 * formados, caen a un valor neutro en vez de invalidar la respuesta entera.
 */
const judgeReplySchema = z.object({
  valid: z.boolean(),
  confidence: z
    .number()
    .transform((value) => Math.min(1, Math.max(0, value)))
    .optional()
    .catch(undefined),
  errors: tolerantStringList,
  warnings: tolerantStringList,
  suggestions: tolerantStringList,
  tables_verified: tolerantStringList,
  explanation: z.string().catch(''),
  table_purposes: tolerantTablePurposeList,
})

/** Lanza `JudgeResponseError` si la respuesta no trae un JSON con `valid` booleano. */
export function parseJudgeVerdict(raw: string): JudgeVerdict {
  const reply = judgeReplySchema.safeParse(extractJsonObject(raw))
  if (!reply.success) {
    throw new JudgeResponseError(raw)
  }
  const fields = reply.data

  // El aviso de las tablas usadas "por suposición" lo genero yo a partir de
  // table_purposes, para que sea consistente aunque el LLM no lo redacte (SPEC-14).
  const assumedWarnings = fields.table_purposes
    .filter((purpose) => purpose.source === 'assumed')
    .map(
      (purpose) =>
        `Se usa la tabla ${purpose.table} por SUPOSICIÓN (nombre opaco y sin descripción); se asume que contiene "${purpose.purpose}". Verifícalo antes de fiarte del resultado.`,
    )
  // Si el LLM la marca inválida pero no da errores, pongo un motivo por defecto.
  const reportedErrors =
    fields.valid || fields.errors.length > 0
      ? fields.errors
      : ['El juez LLM marcó la consulta como no válida sin detallar el motivo.']
  return {
    valid: fields.valid,
    confidence: fields.confidence,
    errors: reportedErrors,
    warnings: [...fields.warnings, ...assumedWarnings],
    suggestions: fields.suggestions,
    tablesVerified: fields.tables_verified,
    explanation: fields.explanation,
    tablePurposes: fields.table_purposes,
  }
}

export async function judgeSqlWithLlm(
  sql: SqlStatement,
  schemaContext: SchemaContext,
  question: string,
  deps: SqlJudgingDependencies = defaultSqlJudgingDependencies,
): Promise<JudgeVerdict> {
  const model = deps.createChatModel()
  const reply = await model.chat([
    { role: 'system', content: buildJudgeSystemPrompt(sql.dialect) },
    {
      role: 'user',
      content: [
        `Esquema disponible (DDL):\n${schemaContext.ddl}`,
        `Pregunta: ${question}`,
        `Consulta SQL a revisar:\n${sql.text}`,
      ].join('\n\n'),
    },
  ])
  return parseJudgeVerdict(reply)
}

export async function judgeSql(
  sql: SqlStatement,
  schemaContext: SchemaContext,
  question: string,
  options: SqlJudgingOptions = {},
  deps: SqlJudgingDependencies = defaultSqlJudgingDependencies,
): Promise<JudgeVerdict> {
  const safety = checkSqlSafety(sql.text)
  if (!safety.valid) {
    return securityFailureVerdict(safety.errors)
  }

  if (options.useDbCheck) {
    const syntax = await deps.checkSyntax(sql)
    if (!syntax.valid) {
      return syntaxFailureVerdict(syntax.error)
    }
  }

  if (!options.useLlmJudge) {
    return checksPassedVerdict(options.useDbCheck ?? false)
  }

  try {
    const llm = await judgeSqlWithLlm(sql, schemaContext, question, deps)
    return applyConfidenceThreshold(asAdvisory(llm), options.minConfidence)
  } catch (error) {
    if (error instanceof JudgeResponseError) {
      // El juez LLM solo aconseja y su respuesta no es interpretable: me quedo con el
      // visto bueno de las comprobaciones automáticas y lo dejo como aviso, sin romper el flujo.
      return {
        valid: true,
        errors: [],
        warnings: ['No se pudo interpretar la evaluación del juez LLM; me quedo con las comprobaciones automáticas.'],
        suggestions: [],
        tablesVerified: [],
        explanation: 'La consulta superó las comprobaciones automáticas; el juez LLM no devolvió un veredicto interpretable.',
      }
    }
    throw error
  }
}

/** El juez LLM solo aconseja: sus "errores" pasan a avisos y el veredicto queda válido. */
function asAdvisory(llm: JudgeVerdict): JudgeVerdict {
  return {
    valid: true,
    confidence: llm.confidence,
    errors: [],
    warnings: [...llm.warnings, ...llm.errors],
    suggestions: llm.suggestions,
    tablesVerified: llm.tablesVerified,
    explanation: llm.explanation,
    tablePurposes: llm.tablePurposes,
  }
}

function applyConfidenceThreshold(verdict: JudgeVerdict, minConfidence?: number): JudgeVerdict {
  if (minConfidence === undefined || verdict.confidence === undefined || verdict.confidence >= minConfidence) {
    return verdict
  }
  return {
    ...verdict,
    valid: false,
    errors: [
      ...verdict.errors,
      `Confianza ${verdict.confidence.toFixed(2)} por debajo del mínimo exigido (${minConfidence.toFixed(2)}).`,
    ],
  }
}
