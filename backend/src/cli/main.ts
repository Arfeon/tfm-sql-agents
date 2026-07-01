/**
 * Punto de entrada del CLI de GraphSQL.
 *
 * Es la capa más externa de la aplicación (composición): muestra una cabecera,
 * un menú, deja elegir el proveedor del modelo y abre una conversación a través
 * del grafo de LangGraph (SPEC-01), que puede completar acciones con tools.
 *
 * Arrancar con: npm start
 */
import { config } from 'dotenv'
config({ path: '../.env' })

import { randomUUID } from 'node:crypto'
import boxen from 'boxen'
import chalk from 'chalk'
import { select, input, confirm } from '@inquirer/prompts'
import { LlmProvider } from '../graphsql/infrastructure/llm/LlmProvider'
import { createConversationGraph, askGraph } from '../graphsql/graph/agentGraph'
import { loadTargetDatabases, targetDatabaseLabel, sqlDialectFor, type TargetDatabaseConfig } from '../graphsql/infrastructure/config/targetDatabases'
import { createSqlPipelineGraph, HUMAN_REVIEW_NODE, type PipelineStateType } from '../graphsql/graph/pipelineGraph'
import { CheckpointerFactory } from '../graphsql/infrastructure/checkpoint/CheckpointerFactory'
import type { JudgeVerdict } from '../graphsql/domain/sql/JudgeVerdict'
import type { HumanDecision } from '../graphsql/domain/sql/HumanDecision'
import type { QueryResult } from '../graphsql/domain/sql/QueryResult'
import { ingestSchema } from '../graphsql/application/schemaIngestion'
import { vectorizeSchema } from '../graphsql/application/schemaVectorization'
import { EmbeddingsFactory } from '../graphsql/infrastructure/embeddings/EmbeddingsFactory'
import { EmbeddingProvider } from '../graphsql/infrastructure/embeddings/EmbeddingProvider'
import { TableEmbeddingsStore } from '../graphsql/infrastructure/postgres/TableEmbeddingsStore'
import { hasDescriptionsFile, loadDescriptions, DESCRIPTIONS_DIR } from '../graphsql/infrastructure/config/descriptions'
import { listLoadedModels } from '../graphsql/infrastructure/llm/lmStudio'
import type { IEmbeddings } from '../graphsql/domain/ports/IEmbeddings'

/** Muestro la cabecera de bienvenida dentro de un recuadro con color. */
function showHeader(): void {
  const title = chalk.cyan.bold('GraphSQL Agent')
  const subtitle = chalk.dim('Tu agente de SQL en lenguaje natural')
  console.log(
    boxen(`${title}\n${subtitle}`, {
      padding: 1,
      margin: 1,
      borderStyle: 'round',
      borderColor: 'cyan',
    }),
  )
}

/** Preflight: en local, aviso si el modelo (chat o embeddings) no está cargado en LM Studio. */
async function warnIfLocalModelMissing(kind: 'chat' | 'embeddings', modelId: string): Promise<void> {
  const baseUrl = process.env.LMSTUDIO_BASE_URL ?? 'http://localhost:1234/v1'
  let loaded: string[]
  try {
    loaded = await listLoadedModels(baseUrl)
  } catch (error) {
    console.log(chalk.yellow(`⚠ No pude consultar los modelos de LM Studio en ${baseUrl}.`))
    console.log(chalk.dim(`¿Está el servidor levantado? Detalle: ${error instanceof Error ? error.message : String(error)}`))
    return
  }
  if (!loaded.includes(modelId)) {
    console.log(chalk.yellow(`⚠ El modelo de ${kind} "${modelId}" no está cargado en LM Studio.`))
    console.log(
      chalk.dim(
        `Modelos cargados: ${loaded.join(', ') || '(ninguno)'}. Cárgalo en LM Studio — puedes tener el de chat y el de embeddings a la vez.`,
      ),
    )
  }
}

/** Menú principal: elijo qué hacer. */
function askMainAction(): Promise<'chat' | 'query' | 'scan' | 'exit'> {
  return select({
    message: '¿Qué quieres hacer?',
    choices: [
      { name: 'Consultar en lenguaje natural (con revisión humana)', value: 'query' },
      { name: 'Iniciar una conversación', value: 'chat' },
      { name: 'Escanear el esquema de la BD objetivo', value: 'scan' },
      { name: 'Salir', value: 'exit' },
    ],
  })
}

/**
 * Escaneo de esquema. Primero pregunto todo (BD objetivo, descripciones y si
 * vectorizar, con su aviso) y luego ejecuto el circuito (Neo4j + pgvector) sin
 * más interrupciones.
 */
async function runSchemaScan(): Promise<void> {
  const targets = loadTargetDatabases()

  // --- Fase 1: preguntar todo ---
  const target = await select({
    message: 'Elige la base de datos objetivo a escanear',
    choices: targets.map((t) => ({ name: targetDatabaseLabel(t), value: t })),
  })
  const descriptions = await askDescriptions()
  const embeddingProvider = await askEmbeddingProvider()
  const embeddings = EmbeddingsFactory.create(embeddingProvider)

  // Un escaneo reconstruye Neo4j Y pgvector JUNTOS, con la misma decisión de
  // descripciones: así los dos almacenes nunca quedan desincronizados. La
  // confirmación (con su aviso de coste) gatea el escaneo completo; si no la doy,
  // no se toca nada.
  const confirmed = await confirmScan(embeddingProvider, embeddings)
  if (!confirmed) {
    console.log(chalk.dim('\nEscaneo cancelado: no se ha tocado ni Neo4j ni el índice vectorial.\n'))
    return
  }

  // --- Fase 2: reconstruir ambos almacenes con la misma decisión de descripciones ---
  console.log(chalk.dim(`\nEscaneando "${targetDatabaseLabel(target)}" e ingiriendo en Neo4j...\n`))
  try {
    const summary = await ingestSchema(target, descriptions)
    console.log(
      chalk.green('✔ Esquema en Neo4j:') +
        ` ${summary.tables} tablas, ${summary.columns} columnas, ${summary.relationships} relaciones.\n`,
    )
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    console.log(chalk.red('\n⚠ No he podido ingerir el esquema en Neo4j.'))
    console.log(chalk.dim('¿Están disponibles la BD objetivo y Neo4j? (docker compose up -d)'))
    console.log(chalk.dim(`Detalle: ${detail}\n`))
    return
  }

  const vectorized = await executeVectorization(target, embeddingProvider, embeddings, descriptions)
  if (!vectorized) {
    console.log(
      chalk.red(
        '⚠ Neo4j se actualizó pero la vectorización falló: el índice vectorial ha quedado DESINCRONIZADO respecto a Neo4j. Vuelve a escanear cuando el proveedor de embeddings esté disponible para realinearlos.\n',
      ),
    )
  }
}

/** Si hay un fichero de descripciones (no el de ejemplo), pregunto si incluirlas. */
async function askDescriptions(): Promise<Map<string, string> | undefined> {
  if (!hasDescriptionsFile()) {
    return undefined
  }
  const include = await confirm({
    message: `He encontrado descripciones en ${DESCRIPTIONS_DIR}/. ¿Incluirlas (en Neo4j y en la vectorización)?`,
    default: true,
  })
  return include ? loadDescriptions() : undefined
}

/** Submenú de proveedor de embeddings: con cuál vectorizar el esquema. */
function askEmbeddingProvider(): Promise<EmbeddingProvider> {
  return select({
    message: '¿Con qué proveedor de embeddings vectorizar?',
    choices: [
      { name: 'OpenAI (nube)', value: EmbeddingProvider.OpenAI },
      { name: 'LM Studio (local)', value: EmbeddingProvider.Local },
    ],
  })
}

/**
 * Aviso de mismatch de modelo + coste/tiempo y confirmación del escaneo COMPLETO.
 * Como el escaneo reconstruye Neo4j y pgvector a la vez, esta confirmación gatea todo
 * el proceso (no solo la vectorización), para que ambos almacenes vayan siempre juntos.
 */
async function confirmScan(provider: EmbeddingProvider, embeddings: IEmbeddings): Promise<boolean> {
  if (provider === EmbeddingProvider.Local) {
    await warnIfLocalModelMissing('embeddings', embeddings.model)
  }

  // Si ya hay un índice con otro modelo/dimensión, aviso de que lo reemplazaré.
  const store = await TableEmbeddingsStore.fromEnv()
  let indexed
  try {
    indexed = await store.getIndexedModel()
  } finally {
    await store.close()
  }
  if (indexed && (indexed.model !== embeddings.model || indexed.dimensions !== embeddings.dimensions)) {
    console.log(
      chalk.yellow(
        `⚠ El índice actual usa ${indexed.model} (${indexed.dimensions} dims) y el modelo activo es ${embeddings.model} (${embeddings.dimensions} dims). Re-vectorizar lo reemplazará por completo.`,
      ),
    )
  }

  console.log(chalk.bold(`\nVectorización del esquema con ${embeddings.model} (${embeddings.dimensions} dims):`))
  if (provider === EmbeddingProvider.OpenAI) {
    console.log(chalk.red('⚠ Usa la API de OpenAI: tiene coste por uso.'))
  }
  console.log(chalk.dim('Tiempo estimado: unos segundos (más en bases de datos grandes).'))

  return confirm({ message: '¿Escanear ahora? (reconstruye Neo4j y el índice vectorial a la vez)', default: true })
}

/** Ejecuta la vectorización ya confirmada y muestra el resultado. Devuelve si tuvo éxito. */
async function executeVectorization(
  target: TargetDatabaseConfig,
  provider: EmbeddingProvider,
  embeddings: IEmbeddings,
  descriptions?: Map<string, string>,
): Promise<boolean> {
  console.log(chalk.dim('Vectorizando el esquema en pgvector...\n'))
  try {
    const summary = await vectorizeSchema(target, provider, embeddings, descriptions)
    console.log(
      chalk.green('✔ Esquema vectorizado:') +
        ` ${summary.count} tablas (${summary.provider}, modelo ${summary.model}, ${summary.dimensions} dims).\n`,
    )
    return true
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    console.log(chalk.red('\n⚠ No he podido vectorizar el esquema.'))
    console.log(chalk.dim('Revisa el proveedor de embeddings (OPENAI_API_KEY o LM Studio) y que pgvector esté disponible.'))
    console.log(chalk.dim(`Detalle: ${detail}\n`))
    return false
  }
}

/**
 * Consulta NL→SQL con revisión humana (SPEC-08).
 *
 * Lanzo el pipeline (recuperación → SQL → Judge), que se PARA en la revisión antes
 * de ejecutar nada. Presento la consulta y el veredicto en cajas, recojo mi decisión
 * y reanudo el grafo por su `thread_id` hasta que apruebo (y se ejecuta), rechazo, o
 * el bucle de fijar/modificar me devuelve a la revisión.
 */
async function runSqlPipeline(): Promise<void> {
  const target = loadTargetDatabases()[0]
  const dialect = sqlDialectFor(target)
  const question = await input({ message: chalk.green('Tu pregunta:') })
  if (question.trim() === '') {
    return
  }

  let checkpointer
  try {
    checkpointer = await CheckpointerFactory.fromEnv()
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    console.log(chalk.red('\n⚠ No pude preparar el checkpointer (PostgreSQL / graphsql_memory).'))
    console.log(chalk.dim('¿Está Postgres levantado? (docker compose up -d)'))
    console.log(chalk.dim(`Detalle: ${detail}\n`))
    return
  }

  const graph = createSqlPipelineGraph(checkpointer)
  const config = { configurable: { thread_id: randomUUID() } }

  try {
    console.log(chalk.dim('\nRecuperando tablas, generando la SQL y validándola con el Judge...\n'))
    await graph.invoke({ question, dialect, mustInclude: [] }, config)

    // Bucle de revisión: mientras el grafo siga parado antes de la revisión.
    while (true) {
      const snapshot = await graph.getState(config)
      if (!snapshot.next.includes(HUMAN_REVIEW_NODE)) {
        break
      }
      presentReview(snapshot.values)
      const decision = await askHumanDecision(snapshot.values)
      await graph.updateState(config, { decision })
      await graph.invoke(null, config)
    }

    const finalState = (await graph.getState(config)).values
    if (finalState.result) {
      presentResult(finalState.result)
    } else {
      console.log(chalk.dim('\nNo se ejecutó ninguna consulta.\n'))
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    console.log(chalk.red('\n⚠ El pipeline no pudo completarse.'))
    console.log(chalk.dim('¿Está el esquema vectorizado y disponibles la BD objetivo y el LLM?'))
    console.log(chalk.dim(`Detalle: ${detail}\n`))
  } finally {
    await checkpointer.end()
  }
}

/** Presento la consulta y la evaluación del Judge en dos cajas separadas. */
function presentReview(state: PipelineStateType): void {
  const tables = state.schemaContext?.tableNames ?? []
  const sqlBody = `${chalk.cyan(state.sql?.text ?? '(sin consulta)')}\n\n${chalk.dim(`Tablas usadas: ${tables.join(', ') || '(ninguna)'}`)}`
  console.log(
    boxen(sqlBody, {
      title: state.failed ? '❌ Consulta SQL (no superó el Judge)' : '📝 Consulta SQL propuesta',
      padding: 1,
      margin: { top: 1, bottom: 0, left: 0, right: 0 },
      borderStyle: 'round',
      borderColor: state.failed ? 'red' : 'cyan',
    }),
  )
  if (state.verdict) {
    console.log(renderJudgeBox(state.verdict))
  }
  if (state.ignoredPinned.length > 0) {
    console.log(chalk.yellow(`⚠ Ignoré tablas fijadas que no existen en el esquema: ${state.ignoredPinned.join(', ')}`))
  }
}

/** La evaluación del Judge en su propia caja, con color según el veredicto. */
function renderJudgeBox(verdict: JudgeVerdict): string {
  const color = verdict.valid ? 'green' : 'red'
  const confidence = verdict.confidence !== undefined ? ` · confianza ${Math.round(verdict.confidence * 100)}%` : ''
  const lines = [chalk[color].bold(`${verdict.valid ? '✅ Válida' : '❌ No válida'}${confidence}`)]
  if (verdict.explanation) {
    lines.push('', chalk.dim(verdict.explanation))
  }
  if (verdict.errors.length > 0) {
    lines.push('', chalk.red.bold('Problemas (impiden ejecutarla):'), ...verdict.errors.map((error) => chalk.red(`  • ${error}`)))
  }
  if (verdict.warnings.length > 0) {
    lines.push('', chalk.yellow('Qué le resta confianza / cautelas:'), ...verdict.warnings.map((warning) => chalk.dim(`  • ${warning}`)))
  }
  if (verdict.suggestions.length > 0) {
    lines.push('', chalk.cyan('Sugerencias (opcionales):'), ...verdict.suggestions.map((suggestion) => chalk.dim(`  • ${suggestion}`)))
  }
  return boxen(lines.join('\n'), {
    title: 'Evaluación del Judge',
    padding: 1,
    margin: { top: 0, bottom: 1, left: 0, right: 0 },
    borderStyle: 'round',
    borderColor: color,
  })
}

/** Pido la decisión. Una consulta fracasada (no superó el Judge) no se puede aprobar. */
async function askHumanDecision(state: PipelineStateType): Promise<HumanDecision> {
  const choices = [
    ...(state.failed ? [] : [{ name: 'Aprobar y ejecutar', value: 'approve' as const }]),
    { name: 'Modificar la SQL a mano', value: 'modify' as const },
    { name: 'Fijar tabla(s) y relanzar', value: 'pin' as const },
    { name: 'Rechazar (no ejecutar)', value: 'reject' as const },
  ]
  const action = await select({ message: '¿Qué hago con esta consulta?', choices })

  if (action === 'modify') {
    const sql = await input({ message: 'Edita la SQL:', default: state.sql?.text ?? '' })
    return { action: 'modify', sql }
  }
  if (action === 'pin') {
    const raw = await input({ message: 'Tablas a fijar (separadas por comas):' })
    const tables = raw.split(',').map((name) => name.trim()).filter(Boolean)
    return { action: 'pin', tables }
  }
  return { action } // approve | reject
}

/** Muestro el resultado de la ejecución (columnas y una vista de las filas). */
function presentResult(result: QueryResult): void {
  const suffix = result.truncated ? chalk.yellow(' (truncado al tope de filas)') : ''
  console.log(chalk.green(`\n✔ ${result.rowCount} fila(s) devueltas${suffix}.`))
  if (result.rows.length > 0) {
    console.table(result.rows.slice(0, 50))
  }
  console.log('')
}

/** Submenú de proveedor: OpenAI (nube) o LM Studio (local). */
function askProvider(): Promise<LlmProvider> {
  return select({
    message: 'Elige el proveedor del modelo',
    choices: [
      { name: 'OpenAI (nube)', value: LlmProvider.OpenAI },
      { name: 'LM Studio (local)', value: LlmProvider.Local },
    ],
  })
}

/** Bucle de conversación: pregunto, paso por el grafo y muestro la respuesta. */
async function runConversation(provider: LlmProvider): Promise<void> {
  if (provider === LlmProvider.Local) {
    await warnIfLocalModelMissing('chat', process.env.LMSTUDIO_MODEL ?? 'local-model')
  }

  const graph = createConversationGraph(provider)
  const threadId = randomUUID() // un hilo por conversación, para el checkpointer
  console.log(chalk.dim('\nEscribe tu pregunta. Pon "salir" para volver al menú.\n'))

  while (true) {
    const question = await input({ message: chalk.green('Tú:') })

    if (question.trim().toLowerCase() === 'salir') {
      return
    }

    try {
      const reply = await askGraph(graph, threadId, question)
      if (reply.trim() === '') {
        console.log(
          chalk.yellow('\n⚠ El modelo no devolvió respuesta (puede pasar con modelos locales tras usar una herramienta). Prueba de nuevo o reformula.\n'),
        )
      } else {
        console.log(`\n${chalk.cyan('Agente:')} ${reply}\n`)
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      console.log(chalk.red('\n⚠ No he podido obtener respuesta del modelo.'))
      console.log(
        chalk.dim('¿Está disponible el proveedor? (LM Studio levantado y con un modelo cargado, o API key de OpenAI válida.)'),
      )
      console.log(chalk.dim(`Detalle: ${detail}\n`))
    }
  }
}

async function main(): Promise<void> {
  showHeader()

  while (true) {
    const action = await askMainAction()
    if (action === 'exit') {
      console.log(chalk.dim('¡Hasta luego!'))
      return
    }

    if (action === 'scan') {
      await runSchemaScan()
      continue
    }

    if (action === 'query') {
      await runSqlPipeline()
      continue
    }

    const provider = await askProvider()
    await runConversation(provider)
  }
}

main().catch((error) => {
  // Si cierro el prompt con Ctrl+C, salgo limpio en vez de mostrar el stack.
  if (error instanceof Error && error.name === 'ExitPromptError') {
    console.log(chalk.dim('\n¡Hasta luego!'))
    process.exit(0)
  }
  console.error(chalk.red('Error inesperado:'), error)
  process.exit(1)
})
