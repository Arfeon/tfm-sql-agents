/**
 * Evaluación experimental (ablation) sobre el golden set (SPEC-11). La variable
 * independiente es el modo de recuperación (none = esquema entero, vector = top-K sin
 * expandir, graphrag = top-K + expansión por FK). La equivalencia semántica (D-11) es
 * complementaria a la execution accuracy, nunca la sustituye.
 */
import { checkSqlSafety } from '../domain/sql/SqlSafetyPolicy'
import { schemaLinkingRecall, resultsMatch, resultsContain, isSemanticPass, estimateTokens, type ResultRow } from './evaluationMetrics'
import { retrieveSchemaContext, defaultSchemaRetrievalDependencies, type SchemaRetrievalDependencies } from './schemaRetrieval'
import { generateSql } from './sqlGeneration'
import { judgeQueryEquivalence, type ExecutedResults } from './sqlEquivalence'
import { executeQuery } from './queryExecution'
import { TargetDatabaseFactory } from '../infrastructure/targetdb/TargetDatabaseFactory'
import { readTargetSchema } from './readTargetSchema'
import { buildSchemaContext, type SchemaContext } from '../domain/schema/SchemaContext'
import { Neo4jConnection } from '../infrastructure/neo4j/Neo4jConnection'
import { SchemaGraphManager } from '../infrastructure/neo4j/SchemaGraphManager'
import { sqlDialectFor, type TargetDatabaseConfig } from '../infrastructure/config/targetDatabases'
import type { GoldenCase, GoldenDifficulty } from './goldenSet'

export type RetrievalMode = 'none' | 'vector' | 'graphrag'

export const RETRIEVAL_MODES: readonly RetrievalMode[] = ['none', 'vector', 'graphrag']

export interface CaseResult {
  id: string
  difficulty: GoldenDifficulty
  mode: RetrievalMode
  retrievedTables: string[]
  schemaLinkingRecall: number
  contextTableCount: number
  contextTokenEstimate: number
  /** La SQL de referencia del golden set, guardada junto a la generada para revisar a mano. */
  referenceSql: string
  generatedSql: string
  safe: boolean
  /** Estricta: mismo resultado exacto (cota inferior). */
  executionMatchStrict: boolean
  /** Justa: la candidata contiene el resultado de referencia (correcto o más rico). */
  executionMatchFair: boolean
  /**
   * Veredicto CRUDO del juez LLM (D-11). Se guarda tal cual, aunque contradiga a la
   * métrica objetiva, para poder auditar cuándo el juez se equivoca. El criterio de
   * equivalencia que cuenta en la métrica es `isSemanticPass(fair, este)`: el juez solo
   * rescata, nunca descarta lo que la ejecución ya da por bueno.
   */
  executionMatchSemantic: boolean
  equivalenceReason?: string
  error?: string
}

export interface DifficultyBreakdown {
  count: number
  meanRecall: number
  executionAccuracyFair: number
}

export interface ModeReport {
  mode: RetrievalMode
  cases: CaseResult[]
  summary: {
    count: number
    meanRecall: number
    meanContextTables: number
    meanContextTokens: number
    /** Estricta (cota inferior). */
    executionAccuracyStrict: number
    /** Justa: es el titular objetivo. */
    executionAccuracyFair: number
    /**
     * Equivalencia: casos que pasan la métrica objetiva O que el juez rescata (`isSemanticPass`).
     * Complementaria: la reporto al lado de la justa, no en su lugar. Por construcción ≥ justa.
     */
    executionAccuracySemantic: number
  }
  byDifficulty: Record<GoldenDifficulty, DifficultyBreakdown>
}

export interface EvaluationDependencies {
  retrieve(question: string, mode: RetrievalMode): Promise<SchemaContext>
  generate(question: string, context: SchemaContext, dialect: string): Promise<{ text: string; dialect: string }>
  runQuery(sqlText: string): Promise<ResultRow[]>
  judgeEquivalence(
    question: string,
    referenceSql: string,
    candidateSql: string,
    results?: ExecutedResults,
  ): Promise<{ equivalent: boolean; reason: string }>
}

/** Caso que ni siquiera se llegó a ejecutar (falló la recuperación o la generación): todo a cero. */
function failedCaseResult(
  base: Pick<CaseResult, 'id' | 'difficulty' | 'mode'>,
  referenceSql: string,
  error: unknown,
): CaseResult {
  return {
    ...base,
    retrievedTables: [],
    schemaLinkingRecall: 0,
    contextTableCount: 0,
    contextTokenEstimate: 0,
    referenceSql,
    generatedSql: '',
    safe: false,
    executionMatchStrict: false,
    executionMatchFair: false,
    executionMatchSemantic: false,
    error: error instanceof Error ? error.message : String(error),
  }
}

/** La SQL generada solo se ejecuta si pasa la comprobación de seguridad. */
export async function evaluateCase(
  goldenCase: GoldenCase,
  mode: RetrievalMode,
  dialect: string,
  deps: EvaluationDependencies,
): Promise<CaseResult> {
  const base = { id: goldenCase.id, difficulty: goldenCase.difficulty, mode }
  try {
    const context = await deps.retrieve(goldenCase.question, mode)
    const sql = await deps.generate(goldenCase.question, context, dialect)
    const safe = checkSqlSafety(sql.text).valid

    const result: CaseResult = {
      ...base,
      retrievedTables: context.tableNames,
      schemaLinkingRecall: schemaLinkingRecall(goldenCase.tables, context.tableNames),
      contextTableCount: context.tables.length,
      contextTokenEstimate: estimateTokens(context.ddl),
      referenceSql: goldenCase.sql,
      generatedSql: sql.text,
      safe,
      executionMatchStrict: false,
      executionMatchFair: false,
      executionMatchSemantic: false,
    }

    if (!safe) {
      result.error = 'La SQL generada no pasó la comprobación de seguridad.'
      return result
    }
    try {
      const expected = await deps.runQuery(goldenCase.sql)
      const actual = await deps.runQuery(sql.text)
      result.executionMatchStrict = resultsMatch(expected, actual)
      result.executionMatchFair = resultsContain(expected, actual)
      // Que la candidata se haya ejecutado sin error es precondición del juez (D-11).
      // Le paso los resultados ejecutados para anclar el veredicto en evidencia real.
      const equivalence = await deps.judgeEquivalence(goldenCase.question, goldenCase.sql, sql.text, {
        reference: expected,
        candidate: actual,
      })
      result.executionMatchSemantic = equivalence.equivalent
      result.equivalenceReason = equivalence.reason
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error)
    }
    return result
  } catch (error) {
    // Un fallo de recuperación o generación no rompe la evaluación: cuenta como caso fallido.
    return failedCaseResult(base, goldenCase.sql, error)
  }
}

/** Aviso opcional al terminar cada caso, para poder mostrar progreso en tiradas largas. */
export type CaseProgress = (result: CaseResult, index: number, total: number) => void

export async function evaluateGoldenSet(
  cases: GoldenCase[],
  mode: RetrievalMode,
  dialect: string,
  deps: EvaluationDependencies,
  onCaseDone?: CaseProgress,
): Promise<ModeReport> {
  const results: CaseResult[] = []
  for (const [index, goldenCase] of cases.entries()) {
    const result = await evaluateCase(goldenCase, mode, dialect, deps)
    results.push(result)
    onCaseDone?.(result, index, cases.length)
  }
  return summarize(mode, results)
}

function summarize(mode: RetrievalMode, cases: CaseResult[]): ModeReport {
  return {
    mode,
    cases,
    summary: {
      count: cases.length,
      meanRecall: mean(cases.map((c) => c.schemaLinkingRecall)),
      meanContextTables: mean(cases.map((c) => c.contextTableCount)),
      meanContextTokens: mean(cases.map((c) => c.contextTokenEstimate)),
      executionAccuracyStrict: mean(cases.map((c) => (c.executionMatchStrict ? 1 : 0))),
      executionAccuracyFair: mean(cases.map((c) => (c.executionMatchFair ? 1 : 0))),
      executionAccuracySemantic: mean(cases.map((c) => (isSemanticPass(c.executionMatchFair, c.executionMatchSemantic) ? 1 : 0))),
    },
    byDifficulty: {
      easy: breakdownFor(cases, 'easy'),
      medium: breakdownFor(cases, 'medium'),
      hard: breakdownFor(cases, 'hard'),
    },
  }
}

function breakdownFor(cases: CaseResult[], difficulty: GoldenDifficulty): DifficultyBreakdown {
  const subset = cases.filter((c) => c.difficulty === difficulty)
  return {
    count: subset.length,
    meanRecall: mean(subset.map((c) => c.schemaLinkingRecall)),
    executionAccuracyFair: mean(subset.map((c) => (c.executionMatchFair ? 1 : 0))),
  }
}

/** 0 si la lista está vacía, para evitar NaN en el informe. */
function mean(values: number[]): number {
  if (values.length === 0) {
    return 0
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

// --- Implementación real por defecto -----------------

/** Modo `vector`: candidatas por significado, sin expandir por FK. */
const vectorOnlyRetrievalDependencies: SchemaRetrievalDependencies = {
  rankTablesBySimilarity: defaultSchemaRetrievalDependencies.rankTablesBySimilarity,
  async expandByForeignKeys(tableNames) {
    const neo4j = Neo4jConnection.fromEnv()
    try {
      return await new SchemaGraphManager(neo4j).getTables(tableNames)
    } finally {
      await neo4j.close()
    }
  },
}

async function retrieveRawForMode(question: string, mode: RetrievalMode, target: TargetDatabaseConfig): Promise<SchemaContext> {
  if (mode === 'none') {
    const tables = await readTargetSchema(target)
    return buildSchemaContext(tables)
  }
  if (mode === 'vector') {
    return retrieveSchemaContext(question, vectorOnlyRetrievalDependencies)
  }
  return retrieveSchemaContext(question)
}

/**
 * Quitar aquí la descripción solo afecta al DDL que ve el SQL Agent; su efecto sobre el
 * ranking de recuperación lo controla aparte el índice (vectorizado con/sin descripción).
 */
async function retrieveForMode(
  question: string,
  mode: RetrievalMode,
  target: TargetDatabaseConfig,
  stripDescriptions: boolean,
): Promise<SchemaContext> {
  const context = await retrieveRawForMode(question, mode, target)
  if (!stripDescriptions) {
    return context
  }
  return buildSchemaContext(context.tables.map((table) => ({ ...table, description: null })))
}

export interface EvaluationDependencyOptions {
  /** `false` quita las descripciones del contexto; por defecto se incluyen. */
  includeDescriptions?: boolean
}

export function makeEvaluationDependencies(
  target: TargetDatabaseConfig,
  options: EvaluationDependencyOptions = {},
): EvaluationDependencies {
  const dialect = sqlDialectFor(target)
  const stripDescriptions = options.includeDescriptions === false
  return {
    retrieve: (question, mode) => retrieveForMode(question, mode, target, stripDescriptions),
    generate: (question, context) => generateSql(question, context, dialect),
    // El default de `executeQuery` conecta a la primera BD del catálogo; aquí el
    // `target` puede ser otra, así que le inyecto su conexión.
    runQuery: async (sqlText) =>
      (
        await executeQuery(
          { text: sqlText, dialect },
          {},
          { connectDatabase: (options) => TargetDatabaseFactory.connect(target, options) },
        )
      ).rows,
    judgeEquivalence: (question, referenceSql, candidateSql, results) =>
      judgeQueryEquivalence(question, referenceSql, candidateSql, dialect, results),
  }
}
