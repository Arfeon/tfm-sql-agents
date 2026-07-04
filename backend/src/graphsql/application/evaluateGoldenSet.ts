/**
 * Caso de uso: evaluación experimental (ablation) sobre el golden set (SPEC-11).
 *
 * Por cada pregunta y cada MODO de recuperación mido:
 *   - schema-linking recall: cuántas de las tablas correctas trae la recuperación,
 *   - tamaño de contexto: cuántas tablas (y tokens estimados) se le pasan al SQL Agent,
 *   - execution accuracy: la SQL generada, ejecutada, ¿da el mismo resultado que la de
 *     referencia? (solo la ejecuto si pasa la comprobación de seguridad),
 *   - equivalencia semántica (métrica COMPLEMENTARIA, D-11): un LLM juez decide si la SQL
 *     candidata responde a la MISMA pregunta que la de referencia, con la ejecución de la
 *     candidata como precondición. Captura aciertos que la comparación de resultados
 *     descarta (columnas de más, empates, agregaciones equivalentes), a costa de fiarme
 *     de un LLM; por eso va al lado de la execution accuracy, no en su lugar.
 *
 * Los tres modos (la variable independiente del ablation):
 *   - `none`:     el contexto es el esquema ENTERO (baseline que revienta el contexto).
 *   - `vector`:   las top-K por significado, SIN expandir por claves foráneas.
 *   - `graphrag`: top-K + expansión por FK en el grafo (lo actual).
 *
 * Recibo los colaboradores inyectados (recuperar/generar/ejecutar) con implementación
 * real por defecto, para poder probar la orquestación con dobles sin Docker ni LLM.
 */
import { checkSqlSafety } from '../domain/sql/SqlSafetyPolicy'
import { schemaLinkingRecall, resultsMatch, resultsContain, estimateTokens, type ResultRow } from './evaluationMetrics'
import { retrieveSchemaContext, defaultSchemaRetrievalDependencies, type SchemaRetrievalDependencies } from './schemaRetrieval'
import { generateSql } from './sqlGeneration'
import { judgeQueryEquivalence } from './sqlEquivalence'
import { executeQuery } from './queryExecution'
import { TargetDatabaseFactory } from '../infrastructure/targetdb/TargetDatabaseFactory'
import { readTargetSchema } from './readTargetSchema'
import { buildSchemaContext, type SchemaContext } from '../domain/schema/SchemaContext'
import { Neo4jConnection } from '../infrastructure/neo4j/Neo4jConnection'
import { SchemaGraphManager } from '../infrastructure/neo4j/SchemaGraphManager'
import { sqlDialectFor, type TargetDatabaseConfig } from '../infrastructure/config/targetDatabases'
import type { GoldenCase, GoldenDifficulty } from './goldenSet'

/** Los tres niveles de recuperación que compara el ablation. */
export type RetrievalMode = 'none' | 'vector' | 'graphrag'

export const RETRIEVAL_MODES: readonly RetrievalMode[] = ['none', 'vector', 'graphrag']

/** Resultado de evaluar un caso en un modo. */
export interface CaseResult {
  id: string
  difficulty: GoldenDifficulty
  mode: RetrievalMode
  retrievedTables: string[]
  schemaLinkingRecall: number
  contextTableCount: number
  contextTokenEstimate: number
  generatedSql: string
  safe: boolean
  /** Execution accuracy estricta: mismo resultado exacto (cota inferior). */
  executionMatchStrict: boolean
  /** Execution accuracy justa: la candidata contiene el resultado de referencia (correcto o más rico). */
  executionMatchFair: boolean
  /** Equivalencia semántica (D-11): un LLM juzga si candidata y referencia responden a lo mismo. Complementaria. */
  executionMatchSemantic: boolean
  /** Motivo del juez de equivalencia (por qué las consideró equivalentes o no). */
  equivalenceReason?: string
  /** Motivo si algo falló (SQL insegura, error de ejecución, fallo de recuperación). */
  error?: string
}

/** Agregado por dificultad. */
export interface DifficultyBreakdown {
  count: number
  meanRecall: number
  executionAccuracyFair: number
}

/** Informe de un modo: los casos y sus agregados. */
export interface ModeReport {
  mode: RetrievalMode
  cases: CaseResult[]
  summary: {
    count: number
    meanRecall: number
    meanContextTables: number
    meanContextTokens: number
    /** Execution accuracy estricta (cota inferior). */
    executionAccuracyStrict: number
    /** Execution accuracy justa (referencia contenida en la candidata). Es el titular objetivo. */
    executionAccuracyFair: number
    /** Equivalencia semántica media (juez LLM). Complementaria: la reporto al lado, no en lugar de la justa. */
    executionAccuracySemantic: number
  }
  byDifficulty: Record<GoldenDifficulty, DifficultyBreakdown>
}

/** Lo que la evaluación necesita del mundo exterior. */
export interface EvaluationDependencies {
  retrieve(question: string, mode: RetrievalMode): Promise<SchemaContext>
  generate(question: string, context: SchemaContext, dialect: string): Promise<{ text: string; dialect: string }>
  runQuery(sqlText: string): Promise<ResultRow[]>
  /** Juez de equivalencia (D-11): ¿candidata y referencia responden a la misma pregunta? */
  judgeEquivalence(question: string, referenceSql: string, candidateSql: string): Promise<{ equivalent: boolean; reason: string }>
}

/** Evalúo un caso en un modo: recupero, genero, y (si es segura) comparo la ejecución. */
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
      // La candidata se ejecutó sin error (precondición de la equivalencia): pregunto al
      // juez LLM si responde a la misma pregunta que la de referencia (D-11).
      const equivalence = await deps.judgeEquivalence(goldenCase.question, goldenCase.sql, sql.text)
      result.executionMatchSemantic = equivalence.equivalent
      result.equivalenceReason = equivalence.reason
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error)
    }
    return result
  } catch (error) {
    // Un fallo de recuperación o generación no rompe la evaluación: cuenta como caso fallido.
    return {
      ...base,
      retrievedTables: [],
      schemaLinkingRecall: 0,
      contextTableCount: 0,
      contextTokenEstimate: 0,
      generatedSql: '',
      safe: false,
      executionMatchStrict: false,
      executionMatchFair: false,
      executionMatchSemantic: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/** Evalúo todo el golden set en un modo y agrego los resultados. */
export async function evaluateGoldenSet(
  cases: GoldenCase[],
  mode: RetrievalMode,
  dialect: string,
  deps: EvaluationDependencies,
): Promise<ModeReport> {
  const results: CaseResult[] = []
  for (const goldenCase of cases) {
    results.push(await evaluateCase(goldenCase, mode, dialect, deps))
  }
  return summarize(mode, results)
}

/** Compongo el informe agregado (medias globales y desglose por dificultad). */
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
      executionAccuracySemantic: mean(cases.map((c) => (c.executionMatchSemantic ? 1 : 0))),
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

/** Media de una lista; 0 si está vacía (evito NaN en el informe). */
function mean(values: number[]): number {
  if (values.length === 0) {
    return 0
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

// --- Implementación real por defecto (wiring de infraestructura) -----------------

/** Recuperación "solo vectorial": las candidatas por significado, sin expandir por FK. */
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

/** Construyo el contexto de esquema según el modo del ablation. */
async function retrieveRawForMode(question: string, mode: RetrievalMode, target: TargetDatabaseConfig): Promise<SchemaContext> {
  if (mode === 'none') {
    // Sin recuperación: el esquema entero como contexto.
    const tables = await readTargetSchema(target)
    return buildSchemaContext(tables)
  }
  if (mode === 'vector') {
    return retrieveSchemaContext(question, vectorOnlyRetrievalDependencies)
  }
  return retrieveSchemaContext(question)
}

/**
 * El contexto del modo, quitando la descripción si el ablation de descripciones la
 * apaga (SPEC-11): reconstruyo el contexto sin `description`, así el DDL que ve el SQL
 * Agent no lleva el comentario de propósito. El efecto de las descripciones sobre el
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

/** Opciones del wiring real (para el ablation de descripciones, SPEC-11). */
export interface EvaluationDependencyOptions {
  /** Si es `false`, quito las descripciones del contexto. Por defecto se incluyen. */
  includeDescriptions?: boolean
}

/**
 * Dependencias reales para la BD objetivo dada: recuperación por modo, generación con
 * el LLM configurado, y ejecución de solo lectura contra la BD. El runner la construye
 * con la BD del catálogo; los tests inyectan dobles en su lugar.
 */
export function makeEvaluationDependencies(
  target: TargetDatabaseConfig,
  options: EvaluationDependencyOptions = {},
): EvaluationDependencies {
  const dialect = sqlDialectFor(target)
  const stripDescriptions = options.includeDescriptions === false
  return {
    retrieve: (question, mode) => retrieveForMode(question, mode, target, stripDescriptions),
    generate: (question, context) => generateSql(question, context, dialect),
    // Ejecuto contra la BD que estoy evaluando (no la de por defecto): al evaluar Nebula,
    // executeQuery conectaba a Arcadia (`connectDefault`) y las consultas a tablas propias de
    // Nebula fallaban con "relation does not exist". Le inyecto la conexión al `target` correcto.
    runQuery: async (sqlText) =>
      (
        await executeQuery(
          { text: sqlText, dialect },
          {},
          { connectDatabase: (options) => TargetDatabaseFactory.connect(target, options) },
        )
      ).rows,
    judgeEquivalence: (question, referenceSql, candidateSql) =>
      judgeQueryEquivalence(question, referenceSql, candidateSql, dialect),
  }
}
