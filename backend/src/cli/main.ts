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
import { select, input } from '@inquirer/prompts'
import { LlmProvider } from '../graphsql/infrastructure/llm/LlmProvider'
import { createConversationGraph, askGraph } from '../graphsql/graph/agentGraph'
import { loadTargetDatabases, targetDatabaseLabel } from '../graphsql/infrastructure/config/targetDatabases'
import { ingestSchema } from '../graphsql/application/schemaIngestion'

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

/** Escaneo de esquema: elijo la BD objetivo del catálogo y la ingiero en Neo4j. */
async function runSchemaScan(): Promise<void> {
  const targets = loadTargetDatabases()
  const target = await select({
    message: 'Elige la base de datos objetivo a escanear',
    choices: targets.map((t) => ({ name: targetDatabaseLabel(t), value: t })),
  })

  console.log(chalk.dim(`\nEscaneando "${targetDatabaseLabel(target)}" e ingiriendo en Neo4j...\n`))
  try {
    const summary = await ingestSchema(target)
    console.log(
      chalk.green('✔ Esquema ingerido:') +
        ` ${summary.tables} tablas, ${summary.columns} columnas, ${summary.relationships} relaciones.\n`,
    )
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    console.log(chalk.red('\n⚠ No he podido ingerir el esquema.'))
    console.log(chalk.dim('¿Están disponibles la BD objetivo y Neo4j? (docker compose up -d)'))
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
      console.log(`\n${chalk.cyan('Agente:')} ${reply}\n`)
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
