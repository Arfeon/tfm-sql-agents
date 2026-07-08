/**
 * El Judge (SPEC-06): seguridad (siempre) + sintaxis contra la BD + juez LLM. Solo
 * las comprobaciones deterministas invalidan; el juez LLM aconseja pero no bloquea,
 * porque da falsos positivos (D-07).
 */
import { ChatModelFactory } from '../infrastructure/llm/ChatModelFactory'
import { loadAgentPrompt } from '../infrastructure/config/agentPrompts'
import type { IChatModel } from '../domain/ports/IChatModel'
import type { SchemaContext } from '../domain/schema/SchemaContext'
import type { SqlStatement } from '../domain/sql/SqlStatement'
import {
  type JudgeVerdict,
  type TablePurpose,
  type PurposeSource,
  securityFailureVerdict,
  syntaxFailureVerdict,
  checksPassedVerdict,
} from '../domain/sql/JudgeVerdict'
import { checkSqlSafety } from '../domain/sql/SqlSafetyPolicy'
import { JudgeResponseError } from '../domain/sql/JudgeResponseError'
import { checkSqlSyntax, type SqlSyntaxCheck } from './sqlSyntaxCheck'

export interface SqlJudgingDependencies {
  createChatModel(): IChatModel
  checkSyntax(sql: SqlStatement): Promise<SqlSyntaxCheck>
}

export const defaultSqlJudgingDependencies: SqlJudgingDependencies = {
  createChatModel: () => ChatModelFactory.fromEnv(),
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

/** Lanza `JudgeResponseError` si la respuesta no trae un JSON con `valid` booleano. */
export function parseJudgeVerdict(raw: string): JudgeVerdict {
  const jsonText = raw.match(/\{[\s\S]*\}/)
  if (!jsonText) {
    throw new JudgeResponseError(raw)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText[0])
  } catch {
    throw new JudgeResponseError(raw)
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new JudgeResponseError(raw)
  }
  if (typeof (parsed as { valid?: unknown }).valid !== 'boolean') {
    throw new JudgeResponseError(raw)
  }

  const fields = parsed as Record<string, unknown>
  const isValid = fields.valid as boolean
  const errors = toStringArray(fields.errors)
  const tablePurposes = toTablePurposes(fields.table_purposes)
  // El aviso de las tablas usadas "por suposición" lo genero yo a partir de
  // table_purposes, para que sea consistente aunque el LLM no lo redacte (SPEC-14).
  const assumedWarnings = tablePurposes
    .filter((purpose) => purpose.source === 'assumed')
    .map(
      (purpose) =>
        `Se usa la tabla ${purpose.table} por SUPOSICIÓN (nombre opaco y sin descripción); se asume que contiene "${purpose.purpose}". Verifícalo antes de fiarte del resultado.`,
    )
  // Si el LLM la marca inválida pero no da errores, pongo un motivo por defecto.
  const reportedErrors =
    isValid || errors.length > 0 ? errors : ['El juez LLM marcó la consulta como no válida sin detallar el motivo.']
  return {
    valid: isValid,
    confidence: toConfidence(fields.confidence),
    errors: reportedErrors,
    warnings: [...toStringArray(fields.warnings), ...assumedWarnings],
    suggestions: toStringArray(fields.suggestions),
    tablesVerified: toStringArray(fields.tables_verified),
    explanation: typeof fields.explanation === 'string' ? fields.explanation : '',
    tablePurposes,
  }
}

const PURPOSE_SOURCES: readonly PurposeSource[] = ['description', 'name', 'columns', 'assumed']

/** Interpreto `table_purposes`; una fuente desconocida la trato como "assumed" (conservador). */
function toTablePurposes(value: unknown): TablePurpose[] {
  if (!Array.isArray(value)) {
    return []
  }
  const purposes: TablePurpose[] = []
  for (const item of value) {
    if (typeof item !== 'object' || item === null) {
      continue
    }
    const fields = item as Record<string, unknown>
    if (typeof fields.table !== 'string') {
      continue
    }
    const isKnownSource = PURPOSE_SOURCES.includes(fields.source as PurposeSource)
    const source: PurposeSource = isKnownSource ? (fields.source as PurposeSource) : 'assumed'
    purposes.push({
      table: fields.table,
      purpose: typeof fields.purpose === 'string' ? fields.purpose : '',
      source,
    })
  }
  return purposes
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function toConfidence(value: unknown): number | undefined {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return undefined
  }
  return Math.min(1, Math.max(0, value))
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
