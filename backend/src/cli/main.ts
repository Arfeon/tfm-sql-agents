/** Punto de entrada del CLI: carga el entorno y enruta el menú a cada flujo. Arrancar con: npm start */
import { config } from 'dotenv'
config({ path: '../.env' })

import chalk from 'chalk'
import { select } from '@inquirer/prompts'
import { showHeader } from './ui'
import { buildMainMenuChoices, checkVectorIndexExists, type MainAction } from './mainMenu'
import { ensureInfrastructureReady } from './startup/infraPreflight'
import { selectLlmProvider } from './startup/providerSelection'
import { runSchemaScan } from './flows/schemaScan'
import { runSqlPipeline } from './flows/sqlPipeline'
import { runRetrievalDebug } from './flows/retrievalDebug'
import { runConversation } from './flows/conversation'

/**
 * El chat queda oculto del menú a propósito: el pipeline cubre el caso de uso real.
 * Conservo el grafo conversacional y sus tools como base para un futuro servidor MCP;
 * reactivarlo es volver a añadir aquí su opción de menú.
 */
async function askMainAction(): Promise<MainAction> {
  const hasIndex = await checkVectorIndexExists()
  if (hasIndex === false) {
    console.log(chalk.yellow('⚠ El esquema de la BD objetivo aún no está escaneado ni vectorizado.'))
    console.log(chalk.dim('  Sin el índice no puedo recuperar tablas ni generar SQL: empieza por «Escanear el esquema».\n'))
  }
  return select({
    message: '¿Qué quieres hacer?',
    choices: buildMainMenuChoices(hasIndex),
  })
}

async function main(): Promise<void> {
  showHeader()
  // Primero la infraestructura: si Docker o los contenedores no están listos,
  // el preflight guía al usuario para levantarlos (o salimos limpiamente).
  const infraReady = await ensureInfrastructureReady()
  if (!infraReady) {
    console.log(chalk.dim('¡Hasta luego!'))
    return
  }
  // Antes de nada, elijo con qué LLM trabajo esta sesión, para no arrancar sin saber
  // qué modelo se está usando (el .env es solo el valor por defecto).
  await selectLlmProvider()

  while (true) {
    const action = await askMainAction()
    switch (action) {
      case 'exit':
        console.log(chalk.dim('¡Hasta luego!'))
        return
      case 'scan':
        await runSchemaScan()
        break
      case 'query':
        await runSqlPipeline()
        break
      case 'debug':
        await runRetrievalDebug()
        break
      case 'chat':
        await runConversation()
        break
    }
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
