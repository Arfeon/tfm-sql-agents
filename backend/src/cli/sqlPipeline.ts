/**
 * Flujo de CLI: consulta NL→SQL con revisión humana (SPEC-08) y supervisor (SPEC-10).
 *
 * Lanza el pipeline (recuperación → SQL ↔ Judge, con reintento automático → revisión),
 * que se PARA en la revisión antes de ejecutar nada. Presento la consulta y el veredicto
 * del Judge en cajas, recojo mi decisión y reanudo el grafo por su `thread_id` hasta que
 * apruebo (y se ejecuta), rechazo, o el bucle de afinar/modificar me devuelve a la revisión.
 */
import { randomUUID } from 'node:crypto'
import boxen from 'boxen'
import chalk from 'chalk'
import Table from 'cli-table3'
import { highlight } from 'cli-highlight'
import { select, input } from '@inquirer/prompts'
import { loadTargetDatabases, sqlDialectFor } from '../graphsql/infrastructure/config/targetDatabases'
import { createSqlPipelineGraph, HUMAN_REVIEW_NODE, MAX_JUDGE_ATTEMPTS, type PipelineStateType } from '../graphsql/graph/pipelineGraph'
import { CheckpointerFactory } from '../graphsql/infrastructure/checkpoint/CheckpointerFactory'
import { withSpinner } from './ui'
import type { JudgeVerdict, PurposeSource } from '../graphsql/domain/sql/JudgeVerdict'
import type { HumanDecision } from '../graphsql/domain/sql/HumanDecision'
import type { QueryResult } from '../graphsql/domain/sql/QueryResult'

export async function runSqlPipeline(): Promise<void> {
  const target = loadTargetDatabases()[0]
  const dialect = sqlDialectFor(target)
  const question = await input({ message: chalk.green('Tu pregunta:') })
  if (question.trim() === '') {
    return
  }

  let checkpointer
  try {
    checkpointer = await CheckpointerFactory.fromEnv()
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    console.log(chalk.red('\n⚠ No pude preparar el checkpointer (PostgreSQL / graphsql_memory).'))
    console.log(chalk.dim('¿Está Postgres levantado? (docker compose up -d)'))
    console.log(chalk.dim(`Detalle: ${detail}\n`))
    return
  }

  const graph = createSqlPipelineGraph(checkpointer)
  const config = { configurable: { thread_id: randomUUID() } }

  try {
    await withSpinner('Recuperando tablas, generando la SQL y validándola con el Judge…', () =>
      graph.invoke({ question, dialect, mustInclude: [] }, config),
    )

    // Bucle de revisión: mientras el grafo siga parado antes de la revisión.
    while (true) {
      const snapshot = await graph.getState(config)
      if (!snapshot.next.includes(HUMAN_REVIEW_NODE)) {
        break
      }
      presentReview(snapshot.values)
      const decision = await askHumanDecision(snapshot.values)
      await graph.updateState(config, { decision })
      await withSpinner(spinnerLabelFor(decision), () => graph.invoke(null, config))
    }

    const finalState = (await graph.getState(config)).values
    if (finalState.result) {
      presentResult(finalState.result)
    } else {
      console.log(chalk.dim('\nNo se ejecutó ninguna consulta.\n'))
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    console.log(chalk.red('\n⚠ El pipeline no pudo completarse.'))
    console.log(chalk.dim('¿Está el esquema vectorizado y disponibles la BD objetivo y el LLM?'))
    console.log(chalk.dim(`Detalle: ${detail}\n`))
  } finally {
    await checkpointer.end()
  }
}

/** Presento la consulta y la evaluación del Judge en dos cajas separadas. */
function presentReview(state: PipelineStateType): void {
  const tables = state.schemaContext?.tableNames ?? []
  const queryText = state.sql ? highlight(state.sql.text, { language: 'sql', ignoreIllegals: true }) : chalk.dim('(sin consulta)')
  const tablesLine = chalk.dim(`Tablas usadas: ${tables.join(', ') || '(ninguna)'}`)
  const bodyLines = [queryText, '', tablesLine]
  // Solo muestro los intentos si hubo reintento automático (SPEC-10): con 1 no aporta nada.
  if (state.attempts > 1) {
    bodyLines.push('', chalk.dim(`Intentos del SQL Agent: ${state.attempts}/${MAX_JUDGE_ATTEMPTS} (el Judge no dio por buenos los anteriores)`))
  }
  const sqlBody = bodyLines.join('\n')
  console.log(
    boxen(sqlBody, {
      title: state.failed ? '❌ Consulta SQL (no superó el Judge)' : '📝 Consulta SQL propuesta',
      padding: 1,
      margin: { top: 1, bottom: 0, left: 0, right: 0 },
      borderStyle: 'round',
      borderColor: state.failed ? 'red' : 'cyan',
    }),
  )
  if (state.verdict) {
    console.log(renderJudgeBox(state.verdict))
  }
  if (state.ignoredPinned.length > 0) {
    console.log(chalk.yellow(`⚠ Ignoré tablas fijadas que no existen en el esquema: ${state.ignoredPinned.join(', ')}`))
  }
}

/** Etiqueta legible de la fuente del propósito de una tabla (SPEC-14). */
function purposeSourceLabel(source: PurposeSource): string {
  switch (source) {
    case 'description':
      return 'según descripción'
    case 'name':
      return 'por el nombre'
    case 'columns':
      return 'por las columnas'
    case 'assumed':
      return 'supuesto'
  }
}

/** La evaluación del Judge en su propia caja, con color según el veredicto. */
function renderJudgeBox(verdict: JudgeVerdict): string {
  const color = verdict.valid ? 'green' : 'red'
  const confidence = verdict.confidence !== undefined ? ` · confianza ${Math.round(verdict.confidence * 100)}%` : ''
  const lines = [chalk[color].bold(`${verdict.valid ? '✅ Válida' : '❌ No válida'}${confidence}`)]
  if (verdict.explanation) {
    lines.push('', chalk.dim(verdict.explanation))
  }
  // Propósito de las tablas cuyo significado el Judge conoce (documentado/evidente);
  // las "supuestas" no van aquí: aparecen como aviso en la sección de cautelas (SPEC-14).
  const knownPurposes = (verdict.tablePurposes ?? []).filter((purpose) => purpose.source !== 'assumed')
  if (knownPurposes.length > 0) {
    lines.push(
      '',
      chalk.cyan('Propósito de las tablas usadas:'),
      ...knownPurposes.map((purpose) => chalk.dim(`  • ${purpose.table} → "${purpose.purpose}" (${purposeSourceLabel(purpose.source)})`)),
    )
  }
  if (verdict.errors.length > 0) {
    lines.push('', chalk.red.bold('Problemas (impiden ejecutarla):'), ...verdict.errors.map((error) => chalk.red(`  • ${error}`)))
  }
  if (verdict.warnings.length > 0) {
    lines.push('', chalk.yellow('Qué le resta confianza / cautelas:'), ...verdict.warnings.map((warning) => chalk.dim(`  • ${warning}`)))
  }
  if (verdict.suggestions.length > 0) {
    lines.push('', chalk.cyan('Sugerencias (opcionales):'), ...verdict.suggestions.map((suggestion) => chalk.dim(`  • ${suggestion}`)))
  }
  return boxen(lines.join('\n'), {
    title: 'Evaluación del Judge',
    padding: 1,
    margin: { top: 0, bottom: 1, left: 0, right: 0 },
    borderStyle: 'round',
    borderColor: color,
  })
}

/** Pido la decisión. Una consulta fracasada (no superó el Judge) no se puede aprobar. */
async function askHumanDecision(state: PipelineStateType): Promise<HumanDecision> {
  const choices = [
    ...(state.failed ? [] : [{ name: 'Aprobar y ejecutar', value: 'approve' as const }]),
    { name: 'Afinar (dar indicaciones y/o forzar tablas)', value: 'refine' as const },
    { name: 'Modificar la SQL a mano', value: 'modify' as const },
    { name: 'Rechazar (no ejecutar)', value: 'reject' as const },
  ]
  const action = await select({ message: '¿Qué hago con esta consulta?', choices })

  if (action === 'modify') {
    const sql = await input({ message: 'Edita la SQL:', default: state.sql?.text ?? '' })
    return { action: 'modify', sql }
  }
  if (action === 'refine') {
    return askRefine(state)
  }
  return { action } // approve | reject
}

/** Texto del spinner mientras el grafo procesa mi decisión. */
function spinnerLabelFor(decision: HumanDecision): string {
  switch (decision.action) {
    case 'approve':
      return 'Ejecutando la consulta…'
    case 'modify':
      return 'Validando la consulta editada con el Judge…'
    case 'refine':
      return 'Rehaciendo la consulta con tu ajuste…'
    default: // reject
      return 'Cerrando…'
  }
}

/**
 * Recojo el afinado (SPEC-15) con dos sub-preguntas guiadas: la indicación en
 * lenguaje natural (la principal) y, opcional, tablas a forzar. Exijo al menos una;
 * si las dos van vacías, vuelvo a las opciones de la revisión sin relanzar.
 */
async function askRefine(state: PipelineStateType): Promise<HumanDecision> {
  const guidance = (
    await input({ message: '¿Qué quieres ajustar? (p. ej. «añade la popularidad por wishlist» · Enter para omitir)' })
  ).trim()
  const rawTables = await input({ message: '¿Forzar alguna tabla? (separadas por comas · Enter para omitir)' })
  const tables = rawTables.split(',').map((name) => name.trim()).filter(Boolean)

  if (guidance === '' && tables.length === 0) {
    console.log(chalk.dim('Afinar necesita una indicación o al menos una tabla; vuelvo a las opciones.'))
    return askHumanDecision(state)
  }
  return {
    action: 'refine',
    guidance: guidance === '' ? undefined : guidance,
    tables: tables.length === 0 ? undefined : tables,
  }
}

/** Muestro el resultado de la ejecución en una tabla con columnas alineadas. */
function presentResult(result: QueryResult): void {
  const suffix = result.truncated ? chalk.yellow(' (truncado al tope de filas)') : ''
  console.log(chalk.green(`\n✔ ${result.rowCount} fila(s) devueltas${suffix}.`))
  if (result.rows.length > 0) {
    const table = new Table({ head: result.columns, style: { head: ['cyan'] } })
    for (const row of result.rows.slice(0, 50)) {
      table.push(result.columns.map((name) => formatCell(row[name])))
    }
    console.log(table.toString())
  }
  console.log('')
}

/** Un valor de celda como texto; el nulo lo marco en gris para que se distinga del vacío. */
function formatCell(value: unknown): string {
  return value === null || value === undefined ? chalk.dim('∅') : String(value)
}
