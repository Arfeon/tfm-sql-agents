/**
 * Flujo de CLI: depurar la recuperación. Pinta el circuito GraphRAG (ranking
 * semántico, expansión por FK y contexto final con el motivo de cada tabla).
 */
import boxen from 'boxen'
import chalk from 'chalk'
import { highlight } from 'cli-highlight'
import { input } from '@inquirer/prompts'
import { explainSchemaRetrieval, LIVE_RETRIEVAL_OPTIONS } from '../../graphsql/application/retrieval/schemaRetrieval'
import { isExitRequest, withSpinner } from '../ui'
import type { RetrievalTrace, ExpandedTable } from '../../graphsql/domain/schema/RetrievalTrace'

export async function runRetrievalDebug(): Promise<void> {
  const question = await input({ message: chalk.green('Pregunta a depurar (o "salir" para volver):') })
  if (isExitRequest(question)) {
    return
  }
  try {
    // Depuro el circuito TAL COMO lo usa el pipeline en vivo: mismas palancas, mismo objeto.
    const trace = await withSpinner('Recuperando (híbrido + expansión + selección con LLM)…', () =>
      explainSchemaRetrieval(question, undefined, LIVE_RETRIEVAL_OPTIONS),
    )
    presentTrace(trace)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    console.log(chalk.red('\n⚠ No pude ejecutar la recuperación.'))
    console.log(chalk.dim('¿Está el esquema vectorizado y disponible el modelo de embeddings? (CLI → "Escanear el esquema")'))
    console.log(chalk.dim(`Detalle: ${detail}\n`))
  }
}

const REASON_LABELS: Record<RetrievalTrace['finalContext'][number]['reason'], string> = {
  semantic: 'semántica',
  expansion: 'expansión FK',
  connector: 'conector (puente)',
  'fk-target': 'destino FK (dimensión)',
  selector: 'elegida por el LLM',
  pinned: 'fijada',
}

/** Resumen de las palancas activas para la cabecera. */
function formatLevers(levers: RetrievalTrace['levers']): string {
  const ranking = levers.lexical ? 'híbrido (denso+léxico)' : 'denso'
  const expansion = levers.expansionMode === 'paths' ? `paths (≤${levers.maxPathLength} saltos)` : 'neighbors'
  return [
    `top-K = ${levers.semanticTopK}`,
    `máx. contexto = ${levers.maxContextTables}`,
    `ranking = ${ranking}`,
    `expansión = ${expansion}`,
    `selector LLM = ${levers.useSelector ? 'sí' : 'no'}`,
  ].join(' · ')
}

/** Sección de tablas con score, o un mensaje en gris si está vacía. */
function printScoredSection(title: string, rows: ExpandedTable[], emptyMessage: string): void {
  console.log(chalk.bold(title))
  if (rows.length === 0) {
    console.log(chalk.dim(`   ${emptyMessage}`))
    return
  }
  console.table(rows.map((row) => ({ tabla: row.tableName, score: row.score.toFixed(3) })))
}

function printHeader(trace: RetrievalTrace): void {
  console.log(
    boxen(`${chalk.bold(trace.question)}\n\n${chalk.dim(formatLevers(trace.levers))}`, {
      title: '🔍 Depuración de la recuperación',
      padding: 1,
      margin: { top: 1, bottom: 0, left: 0, right: 0 },
      borderStyle: 'round',
      borderColor: 'magenta',
    }),
  )
}

function printRanking(trace: RetrievalTrace): void {
  const title = trace.levers.lexical
    ? '\n1) Ranking híbrido (score = RRF de denso+léxico, por eso los valores son pequeños) — ✓ = candidata (top-K)'
    : '\n1) Ranking semántico (coseno) — ✓ = candidata (top-K)'
  console.log(chalk.bold(title))
  console.table(
    trace.ranking.map((row, index) => ({
      '#': index + 1,
      tabla: row.tableName,
      score: row.score.toFixed(3),
      candidata: row.isCandidate ? '✓' : '',
    })),
  )
}

function printSelection(trace: RetrievalTrace): void {
  if (!trace.selection) {
    return
  }
  const { poolSize, chosen } = trace.selection
  console.log(chalk.bold(`\n2d) Selección con LLM (de un pool de ${poolSize} candidatas, eligió ${chosen.length})`))
  console.log(chalk.dim(`   ${chosen.join(', ') || '(ninguna: eligió nada válido o el LLM falló → recorte por score)'}`))
}

function printFinalContext(trace: RetrievalTrace): void {
  const selectorChose = (trace.selection?.chosen.length ?? 0) > 0
  const title = selectorChose
    ? '\n3) Contexto final (selección del LLM + JOIN completados por grafo) — motivo de cada tabla'
    : '\n3) Contexto final (tras el recorte) — motivo de cada tabla'
  console.log(chalk.bold(title))
  console.table(
    trace.finalContext.map((row) => ({ tabla: row.tableName, score: row.score.toFixed(3), motivo: REASON_LABELS[row.reason] })),
  )
}

function presentTrace(trace: RetrievalTrace): void {
  printHeader(trace)
  printRanking(trace)
  printScoredSection('\n2) Añadidas por expansión de FK (score semántico, normalmente bajo)', trace.expansionAdded, '(ninguna: el contexto sale solo de las candidatas)')
  if (trace.levers.expansionMode === 'paths') {
    printScoredSection('\n2b) Conectores por camino de FK (puentes de JOIN entre anclas — compiten por el presupuesto con prioridad)', trace.connectorsAdded, '(ninguno: las anclas ya estaban conectadas a un salto)')
    printScoredSection('\n2c) Destinos de FK de las anclas (dimensiones del JOIN — compiten por el presupuesto con prioridad)', trace.fkTargetsAdded, '(ninguno: las anclas no referencian por FK tablas fuera del contexto)')
  }
  printSelection(trace)
  printFinalContext(trace)

  // El DDL exacto que ve el generador: una columna que aparezca en la SQL pero no aquí, la inventó.
  console.log(chalk.bold('\n4) DDL que recibe el generador (esto y solo esto ve el modelo)'))
  console.log(trace.context.ddl ? highlight(trace.context.ddl, { language: 'sql', ignoreIllegals: true }) : chalk.dim('   (vacío)'))
  console.log('')
}
