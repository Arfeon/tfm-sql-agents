/**
 * Pipeline NL→SQL con revisión humana (SPEC-08).
 *
 * Es un grafo determinista, distinto del grafo conversacional de SPEC-01: recorre
 * recuperación → generación → Judge → REVISIÓN HUMANA → ejecución. La pieza nueva
 * es la revisión: el grafo se compila con `interrupt_before` en ese nodo, de modo
 * que LangGraph pausa y persiste el estado (checkpointer en PostgreSQL) antes de
 * ejecutar nada. Ninguna SQL se ejecuta sin el visto bueno del humano.
 *
 * Al reanudar con la decisión del humano, enruto:
 *   - aprobar   → ejecutar (SPEC-07)
 *   - rechazar  → fin, no se ejecuta
 *   - modificar → la SQL editada vuelve al Judge
 *   - fijar     → vuelvo a la recuperación con esas tablas fijadas (`mustInclude`)
 *
 * Las tablas fijadas viven en el estado, así que se conservan entre reintentos.
 * El bucle automático de reintento Judge↔SQL (con su cuenta de intentos) es del
 * supervisor (SPEC-10); aquí el control lo lleva el humano.
 *
 * Los colaboradores (recuperar, generar, juzgar, ejecutar) se inyectan con sus
 * implementaciones reales por defecto, para poder probar el enrutado con dobles y
 * un checkpointer en memoria, sin Docker ni LLM.
 */
import { StateGraph, Annotation, START, END, type BaseCheckpointSaver } from '@langchain/langgraph'
import { retrieveSchemaContext } from '../application/schemaRetrieval'
import { generateSql } from '../application/sqlGeneration'
import { judgeSql } from '../application/sqlJudging'
import { executeQuery } from '../application/queryExecution'
import type { SchemaContext } from '../domain/schema/SchemaContext'
import type { SqlStatement } from '../domain/sql/SqlStatement'
import type { JudgeVerdict } from '../domain/sql/JudgeVerdict'
import type { QueryResult } from '../domain/sql/QueryResult'
import type { HumanDecision } from '../domain/sql/HumanDecision'

/** El nodo que se pausa: la revisión humana. Se compila con `interrupt_before`. */
export const HUMAN_REVIEW_NODE = 'human_review'

/** Reducer de reemplazo (cada nodo sobrescribe el valor del canal). */
function replace<T>(_current: T, update: T): T {
  return update
}

/** El estado que fluye por el pipeline y que el checkpointer persiste. */
export const PipelineState = Annotation.Root({
  /** La pregunta en lenguaje natural. */
  question: Annotation<string>(),
  /** Dialecto del motor objetivo, para generar y juzgar la SQL. */
  dialect: Annotation<string>(),
  /** Tablas fijadas por el humano; se conservan entre reintentos. */
  mustInclude: Annotation<string[]>({ reducer: replace, default: () => [] }),
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
})

export type PipelineStateType = typeof PipelineState.State

/** Lo que el pipeline necesita del resto del sistema (con implementación real por defecto). */
export interface PipelineDependencies {
  retrieve(question: string, mustInclude: string[]): Promise<SchemaContext>
  generate(question: string, schemaContext: SchemaContext, dialect: string): Promise<SqlStatement>
  judge(sql: SqlStatement, schemaContext: SchemaContext, question: string): Promise<JudgeVerdict>
  execute(sql: SqlStatement): Promise<QueryResult>
}

/** Implementación real: los casos de uso de SPEC-04..07 con sus defaults. */
export const defaultPipelineDependencies: PipelineDependencies = {
  retrieve: (question, mustInclude) => retrieveSchemaContext(question, undefined, { mustInclude }),
  generate: (question, schemaContext, dialect) => generateSql(question, schemaContext, dialect),
  judge: (sql, schemaContext, question) => judgeSql(sql, schemaContext, question, { useDbCheck: true, useLlmJudge: true }),
  execute: (sql) => executeQuery(sql),
}

/** Construyo y compilo el pipeline con la pausa de revisión humana. */
export function createSqlPipelineGraph(
  checkpointer: BaseCheckpointSaver,
  deps: PipelineDependencies = defaultPipelineDependencies,
) {
  async function retrieve(state: PipelineStateType) {
    const schemaContext = await deps.retrieve(state.question, state.mustInclude)
    // Las fijadas que no acabaron en el contexto es que no existían: las marco para avisar.
    const ignoredPinned = state.mustInclude.filter((name) => !schemaContext.tableNames.includes(name))
    return { schemaContext, ignoredPinned }
  }

  async function generate(state: PipelineStateType) {
    const sql = await deps.generate(state.question, state.schemaContext!, state.dialect)
    return { sql }
  }

  async function judge(state: PipelineStateType) {
    const verdict = await deps.judge(state.sql!, state.schemaContext!, state.question)
    return { verdict, failed: !verdict.valid }
  }

  /**
   * Nodo de revisión. Con `interrupt_before` el grafo se pausa ANTES de este nodo,
   * y solo llega aquí cuando reanudo con una decisión ya fijada en el estado. Si es
   * modificar, aplico la SQL editada; si es fijar, sumo las tablas a las fijadas.
   * El enrutado a partir de la decisión lo hace `routeAfterReview`.
   */
  function humanReview(state: PipelineStateType) {
    const decision = state.decision
    if (decision?.action === 'modify') {
      return { sql: { text: decision.sql, dialect: state.dialect }, failed: false }
    }
    if (decision?.action === 'pin') {
      return { mustInclude: [...new Set([...state.mustInclude, ...decision.tables])] }
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
      case 'pin':
        return 'retrieve'
      default: // rechazar (o sin decisión): fin sin ejecutar
        return END
    }
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
    .addEdge('judge', HUMAN_REVIEW_NODE)
    .addConditionalEdges(HUMAN_REVIEW_NODE, routeAfterReview, ['execute', 'judge', 'retrieve', END])
    .addEdge('execute', END)
    .compile({ checkpointer, interruptBefore: [HUMAN_REVIEW_NODE] })
}

export type SqlPipelineGraph = ReturnType<typeof createSqlPipelineGraph>
