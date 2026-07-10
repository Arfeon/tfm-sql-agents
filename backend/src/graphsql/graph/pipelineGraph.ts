/**
 * Pipeline NL→SQL (SPEC-08/10/15): recuperar → generar ↔ Judge → revisión humana →
 * ejecutar. El enrutado es por reglas sobre el estado, no lo decide un LLM, y el
 * `interrupt_before` en la revisión persiste la pausa en PostgreSQL: nada se ejecuta
 * sin visto bueno. Una SQL editada a mano nunca entra en el reintento automático.
 */
import { StateGraph, Annotation, START, END, type BaseCheckpointSaver } from '@langchain/langgraph'
import { retrieveSchemaContext, LIVE_RETRIEVAL_OPTIONS } from '../application/schemaRetrieval'
import { generateSql, type Revision } from '../application/sqlGeneration'
import { judgeSql, defaultSqlJudgingDependencies } from '../application/sqlJudging'
import { executeQuery } from '../application/queryExecution'
import { checkSqlSyntax } from '../application/sqlSyntaxCheck'
import { TargetDatabaseFactory } from '../infrastructure/targetdb/TargetDatabaseFactory'
import type { TargetDatabaseConfig } from '../infrastructure/config/targetDatabases'
import type { SchemaContext } from '../domain/schema/SchemaContext'
import type { SqlStatement } from '../domain/sql/SqlStatement'
import type { JudgeVerdict } from '../domain/sql/JudgeVerdict'
import type { QueryResult } from '../domain/sql/QueryResult'
import type { HumanDecision } from '../domain/sql/HumanDecision'

/** El nodo que se pausa con `interrupt_before`. */
export const HUMAN_REVIEW_NODE = 'human_review'

/** Confianza mínima del juez LLM para dar la consulta por buena. */
export const MIN_CONFIDENCE = 0.7

/** Tope de intentos de generación por ciclo, contando el primero. */
export const MAX_JUDGE_ATTEMPTS = 3

function replace<T>(_current: T, update: T): T {
  return update
}

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
 * Los problemas del Judge como texto plano, para que la generación no dependa del
 * `JudgeVerdict`: recibe una instrucción en texto, venga del Judge o del humano.
 */
function describeJudgeFeedback(verdict: JudgeVerdict): string {
  const problemas = [...verdict.errors, ...verdict.warnings]
  if (problemas.length === 0) {
    return verdict.explanation || 'El Judge no dio más detalle.'
  }
  return problemas.map((problema) => `- ${problema}`).join('\n')
}

export const PipelineState = Annotation.Root({
  question: Annotation<string>(),
  dialect: Annotation<string>(),
  /** Tablas fijadas por el humano; se acumulan entre afinados. */
  mustInclude: Annotation<string[]>({ reducer: replace, default: () => [] }),
  /** Indicaciones del humano al afinar, acumuladas: alimentan recuperación y generación. */
  refinements: Annotation<string[]>({ reducer: replace, default: () => [] }),
  schemaContext: Annotation<SchemaContext | null>({ reducer: replace, default: () => null }),
  /** Tablas fijadas que no existen en el esquema (se ignoran, con aviso en el CLI). */
  ignoredPinned: Annotation<string[]>({ reducer: replace, default: () => [] }),
  sql: Annotation<SqlStatement | null>({ reducer: replace, default: () => null }),
  verdict: Annotation<JudgeVerdict | null>({ reducer: replace, default: () => null }),
  /** No superó el Judge: se puede revisar, pero no aprobar. */
  failed: Annotation<boolean>({ reducer: replace, default: () => false }),
  decision: Annotation<HumanDecision | null>({ reducer: replace, default: () => null }),
  result: Annotation<QueryResult | null>({ reducer: replace, default: () => null }),
  /** Intentos de generación del ciclo actual; se reinicia en `retrieve`. */
  attempts: Annotation<number>({ reducer: replace, default: () => 0 }),
})

export type PipelineStateType = typeof PipelineState.State

export interface PipelineDependencies {
  retrieve(question: string, mustInclude: string[]): Promise<SchemaContext>
  generate(question: string, schemaContext: SchemaContext, dialect: string, revision?: Revision): Promise<SqlStatement>
  judge(sql: SqlStatement, schemaContext: SchemaContext, question: string): Promise<JudgeVerdict>
  execute(sql: SqlStatement): Promise<QueryResult>
}

/** Implementación real: los casos de uso de SPEC-04..07 con sus defaults. */
export const defaultPipelineDependencies: PipelineDependencies = {
  // El pipeline en vivo usa híbrido + caminos + selección con LLM (LIVE_RETRIEVAL_OPTIONS,
  // compartidas con el modo depuración para que este depure el MISMO circuito que corre).
  // El ablation del golden set sigue con los valores por defecto, para poder comparar.
  retrieve: (question, mustInclude) =>
    retrieveSchemaContext(question, undefined, { ...LIVE_RETRIEVAL_OPTIONS, mustInclude }),
  generate: (question, schemaContext, dialect, revision) => generateSql(question, schemaContext, dialect, revision),
  judge: (sql, schemaContext, question) =>
    judgeSql(sql, schemaContext, question, { useDbCheck: true, useLlmJudge: true, minConfidence: MIN_CONFIDENCE }),
  execute: (sql) => executeQuery(sql),
}

/**
 * Dependencias reales apuntando a una BD objetivo CONCRETA (SPEC-18): el dry-run del
 * Judge y la ejecución conectan a `target`, no a la BD por defecto — cuando hay una BD
 * elegida, ninguna pieza debe usar `connectDefault` implícito. La recuperación y la
 * generación no cambian (leen el índice compartido).
 */
export function makePipelineDependencies(target: TargetDatabaseConfig): PipelineDependencies {
  const judgingDeps = {
    createChatModel: defaultSqlJudgingDependencies.createChatModel,
    checkSyntax: (sql: SqlStatement) =>
      checkSqlSyntax(sql, { connectDatabase: () => TargetDatabaseFactory.connect(target) }),
  }
  return {
    retrieve: defaultPipelineDependencies.retrieve,
    generate: defaultPipelineDependencies.generate,
    judge: (sql, schemaContext, question) =>
      judgeSql(sql, schemaContext, question, { useDbCheck: true, useLlmJudge: true, minConfidence: MIN_CONFIDENCE }, judgingDeps),
    execute: (sql) =>
      executeQuery(sql, {}, { connectDatabase: (options) => TargetDatabaseFactory.connect(target, options) }),
  }
}

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

  // Tras un afinado me guío por las indicaciones del humano; en un reintento automático,
  // por los problemas del Judge. En ambos casos parto de la consulta anterior.
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

  // El Judge evalúa contra la pregunta MÁS los afinados: si solo viera la pregunta
  // original, penalizaría justo lo que el humano acaba de pedir.
  async function judge(state: PipelineStateType) {
    const question =
      state.refinements.length === 0
        ? state.question
        : `${state.question}\nIndicaciones posteriores del usuario: ${state.refinements.join('; ')}`
    const verdict = await deps.judge(state.sql!, state.schemaContext!, question)
    return { verdict, failed: !verdict.valid }
  }

  // El grafo se pausa ANTES de este nodo; solo llega aquí al reanudar con una decisión.
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

  // El supervisor: una SQL editada a mano va SIEMPRE a revisión (regenerarla a ciegas
  // descartaría en silencio lo que el humano escribió); una inválida reintenta hasta el tope.
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
