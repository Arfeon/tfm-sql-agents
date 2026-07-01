/**
 * Utilidades de presentación compartidas por los flujos del CLI.
 *
 * La cabecera de bienvenida y el preflight de LM Studio (avisar si el modelo no
 * está cargado) los usan varios flujos, así que viven aquí para no repetirlos.
 */
import boxen from 'boxen'
import chalk from 'chalk'
import { listLoadedModels } from '../graphsql/infrastructure/llm/lmStudio'

/** Muestro la cabecera de bienvenida dentro de un recuadro con color. */
export function showHeader(): void {
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
