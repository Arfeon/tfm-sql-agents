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
import { loadTargetDatabases, targetDatabaseLabel, type TargetDatabaseConfig } from '../graphsql/infrastructure/config/targetDatabases'
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
function askMainAction(): Promise<'chat' | 'scan' | 'exit'> {
  return select({
    message: '¿Qué quieres hacer?',
    choices: [
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

  // --- Fase 1: detectar y preguntar ---
  const target = await select({
    message: 'Elige la base de datos objetivo a escanear',
    choices: targets.map((t) => ({ name: targetDatabaseLabel(t), value: t })),
  })
  const descriptions = await askDescriptions()
  const embeddingProvider = await askEmbeddingProvider()
  const embeddings = EmbeddingsFactory.create(embeddingProvider)
  const doVectorize = await askVectorize(embeddingProvider, embeddings)

  // --- Fase 2: el circuito ---
  console.log(chalk.dim(`\nEscaneando "${targetDatabaseLabel(target)}" e ingiriendo en Neo4j...\n`))
  try {
    const summary = await ingestSchema(target, descriptions)
    console.log(
      chalk.green('✔ Esquema ingerido:') +
        ` ${summary.tables} tablas, ${summary.columns} columnas, ${summary.relationships} relaciones.\n`,
    )
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    console.log(chalk.red('\n⚠ No he podido ingerir el esquema.'))
    console.log(chalk.dim('¿Están disponibles la BD objetivo y Neo4j? (docker compose up -d)'))
    console.log(chalk.dim(`Detalle: ${detail}\n`))
    return
  }

  if (!doVectorize) {
    console.log(chalk.dim('Vectorización omitida.\n'))
    return
  }
  await executeVectorization(target, embeddingProvider, embeddings, descriptions)
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

/** Aviso de mismatch + coste/tiempo y confirmación. Devuelve si hay que vectorizar. */
async function askVectorize(provider: EmbeddingProvider, embeddings: IEmbeddings): Promise<boolean> {
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

  return confirm({ message: '¿Vectorizar el esquema?', default: true })
}

/** Ejecuta la vectorización ya confirmada y muestra el resultado. */
async function executeVectorization(
  target: TargetDatabaseConfig,
  provider: EmbeddingProvider,
  embeddings: IEmbeddings,
  descriptions?: Map<string, string>,
): Promise<void> {
  console.log(chalk.dim('Vectorizando el esquema...\n'))
  try {
    const summary = await vectorizeSchema(target, provider, embeddings, descriptions)
    console.log(
      chalk.green('✔ Esquema vectorizado:') +
        ` ${summary.count} tablas (${summary.provider}, modelo ${summary.model}, ${summary.dimensions} dims).\n`,
    )
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    console.log(chalk.red('\n⚠ No he podido vectorizar el esquema.'))
    console.log(chalk.dim('Revisa el proveedor de embeddings (OPENAI_API_KEY o LM Studio) y que pgvector esté disponible.'))
    console.log(chalk.dim(`Detalle: ${detail}\n`))
  }
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
