/**
 * Flujo de CLI: consulta NL→SQL con revisión humana (SPEC-08).
 *
 * Lanza el pipeline (recuperación → SQL → Judge), que se PARA en la revisión antes
 * de ejecutar nada. Presento la consulta y el veredicto del Judge en cajas, recojo
 * mi decisión y reanudo el grafo por su `thread_id` hasta que apruebo (y se ejecuta),
 * rechazo, o el bucle de fijar/modificar me devuelve a la revisión.
 */
import { randomUUID } from 'node:crypto'
import boxen from 'boxen'
import chalk from 'chalk'
import { select, input } from '@inquirer/prompts'
import { loadTargetDatabases, sqlDialectFor } from '../graphsql/infrastructure/config/targetDatabases'
import { createSqlPipelineGraph, HUMAN_REVIEW_NODE, type PipelineStateType } from '../graphsql/graph/pipelineGraph'
import { CheckpointerFactory } from '../graphsql/infrastructure/checkpoint/CheckpointerFactory'
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
    console.log(chalk.dim('\nRecuperando tablas, generando la SQL y validándola con el Judge...\n'))
    await graph.invoke({ question, dialect, mustInclude: [] }, config)

    // Bucle de revisión: mientras el grafo siga parado antes de la revisión.
    while (true) {
      const snapshot = await graph.getState(config)
      if (!snapshot.next.includes(HUMAN_REVIEW_NODE)) {
        break
      }
      presentReview(snapshot.values)
      const decision = await askHumanDecision(snapshot.values)
      await graph.updateState(config, { decision })
      await graph.invoke(null, config)
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
  const sqlBody = `${chalk.cyan(state.sql?.text ?? '(sin consulta)')}\n\n${chalk.dim(`Tablas usadas: ${tables.join(', ') || '(ninguna)'}`)}`
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
    { name: 'Modificar la SQL a mano', value: 'modify' as const },
    { name: 'Fijar tabla(s) y relanzar', value: 'pin' as const },
    { name: 'Rechazar (no ejecutar)', value: 'reject' as const },
  ]
  const action = await select({ message: '¿Qué hago con esta consulta?', choices })

  if (action === 'modify') {
    const sql = await input({ message: 'Edita la SQL:', default: state.sql?.text ?? '' })
    return { action: 'modify', sql }
  }
  if (action === 'pin') {
    const raw = await input({ message: 'Tablas a fijar (separadas por comas):' })
    const tables = raw.split(',').map((name) => name.trim()).filter(Boolean)
    return { action: 'pin', tables }
  }
  return { action } // approve | reject
}

/** Muestro el resultado de la ejecución (columnas y una vista de las filas). */
function presentResult(result: QueryResult): void {
  const suffix = result.truncated ? chalk.yellow(' (truncado al tope de filas)') : ''
  console.log(chalk.green(`\n✔ ${result.rowCount} fila(s) devueltas${suffix}.`))
  if (result.rows.length > 0) {
    console.table(result.rows.slice(0, 50))
  }
  console.log('')
}
