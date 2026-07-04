/**
 * Utilidades de presentación compartidas por los flujos del CLI.
 *
 * La cabecera de bienvenida, el spinner para los pasos largos y el preflight de LM
 * Studio (avisar si el modelo no está cargado) los usan varios flujos, así que viven
 * aquí para no repetirlos.
 */
import chalk from 'chalk'
import figlet from 'figlet'
import gradient from 'gradient-string'
import ora from 'ora'
import { listLoadedModels } from '../graphsql/infrastructure/llm/lmStudio'

/** Muestro la cabecera de bienvenida: el nombre en grande con un degradado de color. */
export function showHeader(): void {
  const banner = figlet.textSync('GraphSQL', { font: 'Standard' })
  console.log(gradient(['#22d3ee', '#a855f7']).multiline(banner))
  console.log(chalk.dim('  Tu agente de SQL en lenguaje natural\n'))
}

/** Palabras que significan "no quiero seguir, vuelve al menú" (no son una consulta). */
const EXIT_WORDS = ['salir', 'exit', 'quit', 'volver', 'atras', 'atrás', 'cancelar', 'menu', 'menú']

/** ¿El texto es una petición de salir (vacío o una palabra de salida)? */
export function isExitRequest(text: string): boolean {
  const normalized = text.trim().toLowerCase()
  return normalized === '' || EXIT_WORDS.includes(normalized)
}

/**
 * Ejecuto una tarea larga (recuperación, generación, LLM…) mostrando un spinner con su
 * texto, y lo marco como hecho o fallido al terminar. Si la tarea lanza, relanzo para
 * que quien llama muestre su mensaje de error; el spinner ya queda marcado como fallido.
 */
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

/** Preflight: en local, aviso si el modelo (chat o embeddings) no está cargado en LM Studio. */
export async function warnIfLocalModelMissing(kind: 'chat' | 'embeddings', modelId: string): Promise<void> {
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
