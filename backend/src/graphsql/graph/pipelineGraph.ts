/**
 * Pipeline NL→SQL con revisión humana (SPEC-08) y supervisor determinista (SPEC-10).
 *
 * Es un grafo determinista, distinto del grafo conversacional de SPEC-01: recorre
 * recuperación → generación → Judge → REVISIÓN HUMANA → ejecución. El grafo se
 * compila con `interrupt_before` en la revisión, de modo que LangGraph pausa y
 * persiste el estado (checkpointer en PostgreSQL) antes de ejecutar nada. Ninguna
 * SQL se ejecuta sin el visto bueno del humano.
 *
 * Al reanudar con la decisión del humano, enruto:
 *   - aprobar   → ejecutar (SPEC-07)
 *   - rechazar  → fin, no se ejecuta
 *   - modificar → la SQL editada vuelve al Judge
 *   - afinar    → vuelvo a la recuperación con la indicación del humano y las tablas
 *                 forzadas (`mustInclude`); regenero la SQL guiándome por ella (SPEC-15)
 *
 * La indicación y las tablas forzadas viven en el estado, así que se conservan y
 * acumulan entre afinados.
 *
 * Bucle automático Judge↔SQL (SPEC-10). Tras el Judge, si el veredicto no es
 * válido y quedan intentos (`attempts < MAX_JUDGE_ATTEMPTS`), vuelvo sin más al
 * SQL Agent con los errores del Judge, SIN pasar por Human Review ni rehacer la
 * recuperación (las tablas no cambian). El contador se reinicia en `retrieve`
 * (al empezar y al afinar): es un ciclo nuevo. Si la SQL viene de una
 * MODIFICACIÓN MANUAL (`decision.action === 'modify'`), el reintento automático
 * NO se aplica: el veredicto sobre una edición del humano siempre vuelve a Human
 * Review, gane o pierda, porque regenerarla a ciegas descartaría en silencio lo
 * que el humano acaba de escribir.
 *
 * Los colaboradores (recuperar, generar, juzgar, ejecutar) se inyectan con sus
 * implementaciones reales por defecto, para poder probar el enrutado con dobles y
 * un checkpointer en memoria, sin Docker ni LLM.
 */
import { StateGraph, Annotation, START, END, type BaseCheckpointSaver } from '@langchain/langgraph'
import { retrieveSchemaContext } from '../application/schemaRetrieval'
import { generateSql, type Revision } from '../application/sqlGeneration'
import { judgeSql } from '../application/sqlJudging'
import { executeQuery } from '../application/queryExecution'
import type { SchemaContext } from '../domain/schema/SchemaContext'
import type { SqlStatement } from '../domain/sql/SqlStatement'
import type { JudgeVerdict } from '../domain/sql/JudgeVerdict'
import type { QueryResult } from '../domain/sql/QueryResult'
import type { HumanDecision } from '../domain/sql/HumanDecision'

/** El nodo que se pausa: la revisión humana. Se compila con `interrupt_before`. */
export const HUMAN_REVIEW_NODE = 'human_review'

/** Confianza mínima del juez LLM para dar la consulta por buena (SPEC-10). */
export const MIN_CONFIDENCE = 0.7

/** Tope de intentos de generación por ciclo, contando el primero (SPEC-10). */
export const MAX_JUDGE_ATTEMPTS = 3

/** Reducer de reemplazo (cada nodo sobrescribe el valor del canal). */
function replace<T>(_current: T, update: T): T {
  return update
}

/** Añado `nuevas` a `existentes` sin duplicar, conservando el orden. */
function mergeUnique(existentes: string[], nuevas: string[]): string[] {
  const resultado = [...existentes]
  for (const tabla of nuevas) {
    if (!resultado.includes(tabla)) {
      resultado.push(tabla)
    }
  }
  return resultado
}

/**
 * Paso los problemas del Judge a texto para el reintento automático (SPEC-10): sus
 * errores y avisos como lista. Es lo que el SQL Agent recibe como "lo que hay que
 * ajustar". Vive aquí (no en `generateSql`) para que la generación no dependa del
 * `JudgeVerdict`: solo recibe una instrucción ya en texto, venga del Judge o del humano.
 */
function describeJudgeFeedback(verdict: JudgeVerdict): string {
  const problemas = [...verdict.errors, ...verdict.warnings]
  if (problemas.length === 0) {
    return verdict.explanation || 'El Judge no dio más detalle.'
  }
  return problemas.map((problema) => `- ${problema}`).join('\n')
}

/** El estado que fluye por el pipeline y que el checkpointer persiste. */
export const PipelineState = Annotation.Root({
  /** La pregunta en lenguaje natural. */
  question: Annotation<string>(),
  /** Dialecto del motor objetivo, para generar y juzgar la SQL. */
  dialect: Annotation<string>(),
  /** Tablas fijadas por el humano; se conservan y acumulan entre afinados. */
  mustInclude: Annotation<string[]>({ reducer: replace, default: () => [] }),
  /**
   * Indicaciones del humano al afinar (SPEC-15), acumuladas. Alimentan la recuperación
   * (para encontrar tablas nuevas) y guían al SQL Agent. Persisten entre afinados.
   */
  refinements: Annotation<string[]>({ reducer: replace, default: () => [] }),
  /** Contexto de esquema recuperado (SPEC-04). */
  schemaContext: Annotation<SchemaContext | null>({ reducer: replace, default: () => null }),
  /** Tablas que el humano fijó pero no existen en el esquema (se ignoraron). */
  ignoredPinned: Annotation<string[]>({ reducer: replace, default: () => [] }),
  /** La SQL generada (o editada a mano). */
  sql: Annotation<SqlStatement | null>({ reducer: replace, default: () => null }),
  /** El veredicto del Judge (SPEC-06). */
  verdict: Annotation<JudgeVerdict | null>({ reducer: replace, default: () => null }),
  /** La consulta no superó el Judge: se puede revisar, pero no aprobar para ejecutar. */
  failed: Annotation<boolean>({ reducer: replace, default: () => false }),
  /** La decisión del humano, que el CLI fija antes de reanudar. */
  decision: Annotation<HumanDecision | null>({ reducer: replace, default: () => null }),
  /** El resultado de la ejecución, si se aprobó (SPEC-07). */
  result: Annotation<QueryResult | null>({ reducer: replace, default: () => null }),
  /** Intentos de generación en el ciclo actual (SPEC-10); se reinicia en `retrieve`. */
  attempts: Annotation<number>({ reducer: replace, default: () => 0 }),
})

export type PipelineStateType = typeof PipelineState.State

/** Lo que el pipeline necesita del resto del sistema (con implementación real por defecto). */
export interface PipelineDependencies {
  retrieve(question: string, mustInclude: string[]): Promise<SchemaContext>
  generate(question: string, schemaContext: SchemaContext, dialect: string, revision?: Revision): Promise<SqlStatement>
  judge(sql: SqlStatement, schemaContext: SchemaContext, question: string): Promise<JudgeVerdict>
  execute(sql: SqlStatement): Promise<QueryResult>
}

/** Implementación real: los casos de uso de SPEC-04..07 con sus defaults. */
export const defaultPipelineDependencies: PipelineDependencies = {
  retrieve: (question, mustInclude) => retrieveSchemaContext(question, undefined, { mustInclude }),
  generate: (question, schemaContext, dialect, revision) => generateSql(question, schemaContext, dialect, revision),
  judge: (sql, schemaContext, question) =>
    judgeSql(sql, schemaContext, question, { useDbCheck: true, useLlmJudge: true, minConfidence: MIN_CONFIDENCE }),
  execute: (sql) => executeQuery(sql),
}

/** Construyo y compilo el pipeline con la pausa de revisión humana. */
export function createSqlPipelineGraph(
  checkpointer: BaseCheckpointSaver,
  deps: PipelineDependencies = defaultPipelineDependencies,
) {
  async function retrieve(state: PipelineStateType) {
    // La búsqueda semántica usa la pregunta más las indicaciones acumuladas (SPEC-15),
    // para que un afinado ("añade wishlist") pueda hacer aparecer una tabla nueva.
    const searchQuery = [state.question, ...state.refinements].join('. ')
    const schemaContext = await deps.retrieve(searchQuery, state.mustInclude)
    // Las fijadas que no acabaron en el contexto es que no existían: las marco para avisar.
    const ignoredPinned = state.mustInclude.filter((name) => !schemaContext.tableNames.includes(name))
    // Nuevo ciclo de recuperación: el contador de reintentos del Judge arranca de cero.
    return { schemaContext, ignoredPinned, attempts: 0 }
  }

  /**
   * Genero la SQL. Si es el primer intento tras un afinado del humano, me guío por sus
   * indicaciones (SPEC-15); si es un reintento automático del supervisor, por los
   * problemas del Judge (SPEC-10). En ambos casos parto de la consulta anterior.
   */
  async function generate(state: PipelineStateType) {
    const hasPreviousSql = state.sql !== null
    const judgeRejectedIt = state.verdict !== null && !state.verdict.valid
    const isFirstTryAfterRefine = state.attempts === 0 && state.refinements.length > 0 && hasPreviousSql
    const isAutoRetryAfterJudge = state.attempts > 0 && hasPreviousSql && judgeRejectedIt

    let revision: Revision | undefined
    if (isFirstTryAfterRefine) {
      revision = { previousSql: state.sql!, instructions: state.refinements.join('; ') }
    } else if (isAutoRetryAfterJudge) {
      revision = { previousSql: state.sql!, instructions: describeJudgeFeedback(state.verdict!) }
    }

    const sql = await deps.generate(state.question, state.schemaContext!, state.dialect, revision)
    return { sql, attempts: state.attempts + 1 }
  }

  async function judge(state: PipelineStateType) {
    const verdict = await deps.judge(state.sql!, state.schemaContext!, state.question)
    return { verdict, failed: !verdict.valid }
  }

  /**
   * Nodo de revisión. Con `interrupt_before` el grafo se pausa ANTES de este nodo,
   * y solo llega aquí cuando reanudo con una decisión ya fijada en el estado. Si es
   * modificar, aplico la SQL editada; si es afinar, acumulo la indicación y las
   * tablas forzadas. El enrutado a partir de la decisión lo hace `routeAfterReview`.
   */
  function humanReview(state: PipelineStateType) {
    const decision = state.decision
    if (decision?.action === 'modify') {
      return { sql: { text: decision.sql, dialect: state.dialect }, failed: false }
    }
    if (decision?.action === 'refine') {
      const mustInclude = mergeUnique(state.mustInclude, decision.tables ?? [])
      const refinements = decision.guidance
        ? [...state.refinements, decision.guidance]
        : state.refinements
      return { mustInclude, refinements }
    }
    return {}
  }

  async function execute(state: PipelineStateType) {
    const result = await deps.execute(state.sql!)
    return { result }
  }

  /** Enruto según la decisión del humano tras la revisión. */
  function routeAfterReview(state: PipelineStateType) {
    switch (state.decision?.action) {
      case 'approve':
        return 'execute'
      case 'modify':
        return 'judge'
      case 'refine':
        return 'retrieve'
      default: // rechazar (o sin decisión): fin sin ejecutar
        return END
    }
  }

  /**
   * Supervisor (SPEC-10): decido qué pasa tras el Judge.
   *   - Válida                                  → Human Review.
   *   - SQL editada a mano (`modify` en curso)   → Human Review siempre (sin reintento automático).
   *   - Inválida y quedan intentos               → vuelvo al SQL Agent con el error.
   *   - Inválida y agotados los intentos         → Human Review, marcada fracasada.
   */
  function routeAfterJudge(state: PipelineStateType) {
    if (state.verdict?.valid) {
      return HUMAN_REVIEW_NODE
    }
    if (state.decision?.action === 'modify') {
      return HUMAN_REVIEW_NODE
    }
    if (state.attempts < MAX_JUDGE_ATTEMPTS) {
      return 'generate'
    }
    return HUMAN_REVIEW_NODE
  }

  return new StateGraph(PipelineState)
    .addNode('retrieve', retrieve)
    .addNode('generate', generate)
    .addNode('judge', judge)
    .addNode(HUMAN_REVIEW_NODE, humanReview)
    .addNode('execute', execute)
    .addEdge(START, 'retrieve')
    .addEdge('retrieve', 'generate')
    .addEdge('generate', 'judge')
    .addConditionalEdges('judge', routeAfterJudge, ['generate', HUMAN_REVIEW_NODE])
    .addConditionalEdges(HUMAN_REVIEW_NODE, routeAfterReview, ['execute', 'judge', 'retrieve', END])
    .addEdge('execute', END)
    .compile({ checkpointer, interruptBefore: [HUMAN_REVIEW_NODE] })
}

export type SqlPipelineGraph = ReturnType<typeof createSqlPipelineGraph>
