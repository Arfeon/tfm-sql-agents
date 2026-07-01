/**
 * Punto de entrada del CLI de GraphSQL.
 *
 * Es la capa más externa (composición): carga el entorno, muestra la cabecera y
 * enruta el menú principal a cada flujo. Cada flujo vive en su propio módulo
 * (`schemaScan`, `sqlPipeline`, `retrievalDebug`, `conversation`), para que este
 * fichero se quede fino y con una sola responsabilidad: arrancar y enrutar.
 *
 * Arrancar con: npm start
 */
import { config } from 'dotenv'
config({ path: '../.env' })

import chalk from 'chalk'
import { select } from '@inquirer/prompts'
import { showHeader } from './ui'
import { runSchemaScan } from './schemaScan'
import { runSqlPipeline } from './sqlPipeline'
import { runRetrievalDebug } from './retrievalDebug'
import { runConversation } from './conversation'

/** Menú principal: elijo qué hacer. */
function askMainAction(): Promise<'chat' | 'query' | 'scan' | 'debug' | 'exit'> {
  return select({
    message: '¿Qué quieres hacer?',
    choices: [
      { name: 'Consultar en lenguaje natural (con revisión humana)', value: 'query' },
      { name: 'Iniciar una conversación', value: 'chat' },
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
