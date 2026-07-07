/** Punto de entrada del CLI: carga el entorno y enruta el menú a cada flujo. Arrancar con: npm start */
import { config } from 'dotenv'
config({ path: '../.env' })

import chalk from 'chalk'
import { select } from '@inquirer/prompts'
import { showHeader } from './ui'
import { runSchemaScan } from './schemaScan'
import { runSqlPipeline } from './sqlPipeline'
import { runRetrievalDebug } from './retrievalDebug'
import { runConversation } from './conversation'

/**
 * El chat queda oculto del menú a propósito: el pipeline cubre el caso de uso real.
 * Conservo el grafo conversacional y sus tools como base para un futuro servidor MCP;
 * reactivarlo es volver a añadir aquí su opción de menú.
 */
function askMainAction(): Promise<'chat' | 'query' | 'scan' | 'debug' | 'exit'> {
  return select({
    message: '¿Qué quieres hacer?',
    choices: [
      { name: 'Consultar en lenguaje natural (con revisión humana)', value: 'query' },
      { name: 'Escanear el esquema de la BD objetivo', value: 'scan' },
      { name: 'Depurar recuperación (ver el circuito)', value: 'debug' },
      { name: 'Salir', value: 'exit' },
    ],
  })
}

async function main(): Promise<void> {
  showHeader()

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
