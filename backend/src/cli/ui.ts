/** Utilidades de presentación compartidas por los flujos del CLI. */
import chalk from 'chalk'
import figlet from 'figlet'
import gradient from 'gradient-string'
import ora from 'ora'
import { listLoadedModels } from '../graphsql/infrastructure/llm/lmStudio'
import { loadEnv } from '../graphsql/infrastructure/config/env'

export function showHeader(): void {
  const banner = figlet.textSync('GraphSQL', { font: 'Standard' })
  console.log(gradient(['#22d3ee', '#a855f7']).multiline(banner))
  console.log(chalk.dim('  Tu agente de SQL en lenguaje natural\n'))
}

const EXIT_WORDS = ['salir', 'exit', 'quit', 'volver', 'atras', 'atrás', 'cancelar', 'menu', 'menú']

/** El texto vacío también cuenta como petición de salir. */
export function isExitRequest(text: string): boolean {
  const normalized = text.trim().toLowerCase()
  return normalized === '' || EXIT_WORDS.includes(normalized)
}

/** Si la tarea lanza, relanzo: el mensaje de error lo muestra quien llama. */
export async function withSpinner<T>(text: string, task: () => Promise<T>): Promise<T> {
  const spinner = ora(text).start()
  try {
    const result = await task()
    spinner.succeed()
    return result
  } catch (error) {
    spinner.fail()
    throw error
  }
}

export async function warnIfLocalModelMissing(kind: 'chat' | 'embeddings', modelId: string): Promise<void> {
  const baseUrl = loadEnv().LMSTUDIO_BASE_URL
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
