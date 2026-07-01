/**
 * Caso de uso: el Judge (SPEC-06). Valida que una SQL es segura y correcta antes
 * de ejecutarla.
 *
 * El Judge hace siempre una comprobación de seguridad (que la consulta sea de solo
 * lectura, sin patrones peligrosos). Sobre eso, según lo que se pida, puede sumar
 * una comprobación de sintaxis contra la base de datos (`EXPLAIN`, la autoridad
 * objetiva de si la consulta es válida) y una revisión del juez LLM.
 *
 * Quien decide si la consulta se da por inválida son las comprobaciones automáticas
 * (seguridad y sintaxis). El juez LLM solo aconseja: aporta confianza, avisos y
 * sugerencias, pero no invalida la consulta por sí solo, porque puede ser demasiado
 * estricto y dar falsos positivos.
 *
 * Recibo el `IChatModel` y la comprobación de sintaxis inyectados (reales por
 * defecto), para probarlo con dobles sin tocar red ni BD.
 */
import { ChatModelFactory } from '../infrastructure/llm/ChatModelFactory'
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

/** Implementación real: el modelo del entorno (`LLM_PROVIDER`) y el EXPLAIN contra la BD. */
export const defaultSqlJudgingDependencies: SqlJudgingDependencies = {
  createChatModel: () => ChatModelFactory.fromEnv(),
  checkSyntax: (sql) => checkSqlSyntax(sql),
}

export interface SqlJudgingOptions {
  /** Si está activo, compruebo la sintaxis contra la BD con un EXPLAIN. */
  useDbCheck?: boolean
  /** Si está activo, consulto también al juez LLM. */
  useLlmJudge?: boolean
  /**
   * Confianza mínima (0..1) para dar por buena la consulta. Si el juez LLM
   * responde con menos, la marco inválida. Es una palanca opcional del operador,
   * no la opinión del LLM. Si no se indica, no aplico umbral.
   */
  minConfidence?: number
}

/** Mensaje de sistema del juez LLM: criterios de evaluación y formato de salida. */
export function buildJudgeSystemPrompt(dialect: string): string {
  return [
    `Eres un experto revisor de consultas SQL para ${dialect}. Evalúas si una consulta es correcta, segura y responde a la pregunta del usuario.`,
    '',
    'Criterios:',
    `1. Corrección sintáctica: ¿la sintaxis es correcta para ${dialect}? ¿JOINs, WHERE, GROUP BY, ORDER BY bien? ¿las columnas no agregadas están en GROUP BY?`,
    '2. Corrección semántica: ¿usa tablas y columnas que existan en el esquema, con sus nombres exactos (sin traducir)? ¿los JOINs siguen las claves foráneas?',
    '3. Completitud: ¿responde de verdad a la pregunta? ¿falta algún filtro o condición evidente?',
    '4. Seguridad: ¿es de solo lectura (SELECT/WITH), sin operaciones destructivas?',
    '5. Optimización: ¿podría ser más eficiente? ¿falta un LIMIT cuando la pregunta lo pide?',
    '',
    'Cuando algo esté mal, di EXACTAMENTE qué y cómo corregirlo (p. ej. "la columna c.name no puede ir en GROUP BY; usa una subconsulta").',
    '',
    'Además, por CADA tabla que use la consulta, evalúa si SABES qué contiene, con la evidencia del esquema (su comentario/descripción, su nombre y sus columnas):',
    '- Si la tabla tiene descripción en el esquema, su propósito está DOCUMENTADO ("source": "description").',
    '- Si no tiene descripción pero el nombre lo deja claro (p. ej. customer), "source": "name"; si lo dejan claro las columnas, "source": "columns".',
    '- Si el nombre es OPACO (p. ej. t_042) y NO tiene descripción, su propósito es una SUPOSICIÓN tuya a partir de las columnas: "source": "assumed". Es importante marcarlo, porque esa tabla podría contener algo distinto de lo que asumes.',
    'En "purpose" resume en pocas palabras qué crees que contiene o representa la tabla.',
    '',
    'Responde EXCLUSIVAMENTE con un JSON con esta forma, sin texto alrededor:',
    '{"valid": true|false, "confidence": 0.0-1.0, "errors": ["..."], "warnings": ["..."], "suggestions": ["..."], "tables_verified": ["..."], "table_purposes": [{"table": "...", "purpose": "...", "source": "description|name|columns|assumed"}], "explanation": "..."}',
    'En "errors" van solo los problemas que hacen la consulta incorrecta o insegura; el estilo o las mejoras van en "warnings"/"suggestions". Si es válida, "errors" va vacío.',
    'NO metas en "warnings" el aviso de las tablas "assumed": eso se genera aparte a partir de "table_purposes". En "warnings" van otras cautelas.',
    'En "explanation" justifica brevemente la confianza: por qué das esa nota y qué la baja (en una o dos frases).',
  ].join('\n')
}

/**
 * Interpreto la respuesta del juez como `JudgeVerdict`. Si no es un JSON con al
 * menos el campo booleano `valid`, lanzo `JudgeResponseError` (la decisión de qué
 * hacer es de quien combina las capas).
 */
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

  if (typeof parsed !== 'object' || parsed === null || typeof (parsed as { valid?: unknown }).valid !== 'boolean') {
    throw new JudgeResponseError(raw)
  }

  const fields = parsed as Record<string, unknown>
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
  return {
    valid: fields.valid as boolean,
    confidence: toConfidence(fields.confidence),
    errors: (fields.valid as boolean) || errors.length > 0 ? errors : ['El juez LLM marcó la consulta como no válida sin detallar el motivo.'],
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
    const source = PURPOSE_SOURCES.includes(fields.source as PurposeSource) ? (fields.source as PurposeSource) : 'assumed'
    purposes.push({
      table: fields.table,
      purpose: typeof fields.purpose === 'string' ? fields.purpose : '',
      source,
    })
  }
  return purposes
}

/** Me quedo con las cadenas de un array; cualquier otra cosa se ignora. */
function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

/** Confianza válida (número entre 0 y 1); si no lo es, la dejo ausente. */
function toConfidence(value: unknown): number | undefined {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return undefined
  }
  return Math.min(1, Math.max(0, value))
}

/** Solo la revisión del juez LLM: le pregunto y devuelvo su veredicto. */
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

/**
 * Comprueba la seguridad (siempre); si falla, se acabó. Si se pide, valida la
 * sintaxis contra la BD; si la BD la rechaza, se acabó. Si se pide, añade la
 * revisión del juez LLM, que solo aconseja (no invalida) y cuya respuesta ilegible
 * no rompe el flujo.
 */
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

/**
 * El juez LLM solo aconseja: paso sus "errores" a avisos y dejo el veredicto como
 * válido, conservando confianza, avisos y sugerencias. Quien invalida una consulta
 * son las comprobaciones automáticas (seguridad y sintaxis), no el LLM.
 */
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

/** Si hay umbral y la confianza queda por debajo, marco la consulta inválida. */
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
