/**
 * Punto de entrada del CLI de GraphSQL.
 *
 * Es la capa más externa de la aplicación (composición): muestra una cabecera,
 * un menú, deja elegir el proveedor del modelo y abre una conversación directa
 * con él. Reutiliza el factory y el puerto `IChatModel` de SPEC-00B.
 *
 * Arrancar con: npm start
 */
import { config } from 'dotenv'
config({ path: '../.env' })

import boxen from 'boxen'
import chalk from 'chalk'
import { select, input } from '@inquirer/prompts'
import { ChatModelFactory } from '../graphsql/infrastructure/llm/ChatModelFactory'
import { LlmProvider } from '../graphsql/infrastructure/llm/LlmProvider'
import type { IChatModel } from '../graphsql/domain/ports/IChatModel'

const SYSTEM_PROMPT = 'Eres GraphSQL Agent, un asistente experto en SQL. Responde de forma clara y en español.'

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

/** Menú principal: elijo si quiero conversar o salir. */
function askMainAction(): Promise<'chat' | 'exit'> {
  return select({
    message: '¿Qué quieres hacer?',
    choices: [
      { name: 'Iniciar una conversación', value: 'chat' },
      { name: 'Salir', value: 'exit' },
    ],
  })
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

/** Bucle de conversación: pregunto, envío al modelo y muestro la respuesta. */
async function runConversation(model: IChatModel): Promise<void> {
  console.log(chalk.dim('\nEscribe tu pregunta. Pon "salir" para volver al menú.\n'))

  while (true) {
    const question = await input({ message: chalk.green('Tú:') })

    if (question.trim().toLowerCase() === 'salir') {
      return
    }

    try {
      const reply = await model.chat([
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: question },
      ])
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

    const provider = await askProvider()
    const model = ChatModelFactory.create(provider)
    await runConversation(model)
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
