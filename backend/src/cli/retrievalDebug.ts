/**
 * Flujo de CLI: depurar la recuperación (SPEC-13).
 *
 * Pido una pregunta y pinto el circuito GraphRAG: el ranking semántico con scores
 * (marcando el corte top-K), las tablas que entran por expansión de FK con su score,
 * y el contexto final con el motivo de cada tabla. Así se ve si una tabla se recupera
 * por significado o la arrastra el grafo.
 */
import boxen from 'boxen'
import chalk from 'chalk'
import { input } from '@inquirer/prompts'
import { explainSchemaRetrieval } from '../graphsql/application/schemaRetrieval'
import type { RetrievalTrace } from '../graphsql/domain/schema/RetrievalTrace'

export async function runRetrievalDebug(): Promise<void> {
  const question = await input({ message: chalk.green('Pregunta a depurar:') })
  if (question.trim() === '') {
    return
  }
  console.log(chalk.dim('\nRecuperando (ranking semántico + expansión por FK)...\n'))
  try {
    presentTrace(await explainSchemaRetrieval(question))
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    console.log(chalk.red('\n⚠ No pude ejecutar la recuperación.'))
    console.log(chalk.dim('¿Está el esquema vectorizado y disponible el modelo de embeddings? (CLI → "Escanear el esquema")'))
    console.log(chalk.dim(`Detalle: ${detail}\n`))
  }
}

/** Traduzco el motivo de inclusión a una etiqueta legible. */
function reasonLabel(reason: RetrievalTrace['finalContext'][number]['reason']): string {
  switch (reason) {
    case 'semantic':
      return 'semántica'
    case 'expansion':
      return 'expansión FK'
    case 'pinned':
      return 'fijada'
  }
}

/** Pinto la traza del circuito en tres tablas: ranking, expansión y contexto final. */
function presentTrace(trace: RetrievalTrace): void {
  console.log(
    boxen(
      `${chalk.bold(trace.question)}\n\n${chalk.dim(
        `top-K semántico = ${trace.levers.semanticTopK} · máx. contexto = ${trace.levers.maxContextTables}`,
      )}`,
      {
        title: '🔍 Depuración de la recuperación',
        padding: 1,
        margin: { top: 1, bottom: 0, left: 0, right: 0 },
        borderStyle: 'round',
        borderColor: 'magenta',
      },
    ),
  )

  console.log(chalk.bold('\n1) Ranking semántico (coseno) — ✓ = candidata (top-K)'))
  console.table(
    trace.ranking.map((row, index) => ({
      '#': index + 1,
      tabla: row.tableName,
      score: row.score.toFixed(3),
      candidata: row.isCandidate ? '✓' : '',
    })),
  )

  console.log(chalk.bold('\n2) Añadidas por expansión de FK (score semántico, normalmente bajo)'))
  if (trace.expansionAdded.length > 0) {
    console.table(trace.expansionAdded.map((row) => ({ tabla: row.tableName, score: row.score.toFixed(3) })))
  } else {
    console.log(chalk.dim('   (ninguna: el contexto sale solo de las candidatas)'))
  }

  console.log(chalk.bold('\n3) Contexto final (tras el recorte) — motivo de cada tabla'))
  console.table(
    trace.finalContext.map((row) => ({ tabla: row.tableName, score: row.score.toFixed(3), motivo: reasonLabel(row.reason) })),
  )
  console.log('')
}
