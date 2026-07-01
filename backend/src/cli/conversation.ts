/**
 * Flujo de CLI: conversación directa con el modelo a través del grafo (SPEC-01).
 *
 * Elijo proveedor, abro un hilo y voy preguntando; el grafo puede completar acciones
 * con sus tools. "salir" vuelve al menú.
 */
import { randomUUID } from 'node:crypto'
import chalk from 'chalk'
import { select, input } from '@inquirer/prompts'
import { LlmProvider } from '../graphsql/infrastructure/llm/LlmProvider'
import { createConversationGraph, askGraph } from '../graphsql/graph/agentGraph'
import { warnIfLocalModelMissing } from './ui'

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

/** Bucle de conversación: elijo proveedor, pregunto, paso por el grafo y muestro la respuesta. */
export async function runConversation(): Promise<void> {
  const provider = await askProvider()
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
