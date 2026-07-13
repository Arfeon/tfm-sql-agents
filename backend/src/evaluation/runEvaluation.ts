/**
 * Corre el golden set en los tres modos de recuperación y guarda el informe en
 * docs/evaluacion/. Opt-in (npm run evaluate): requiere Docker con el esquema
 * escaneado/vectorizado y el LLM configurado.
 */
import { join } from 'node:path'
import { config } from 'dotenv'
import { PROJECT_ROOT } from '../graphsql/infrastructure/config/projectRoot'
config({ path: join(PROJECT_ROOT, '.env') })

import { mkdirSync, writeFileSync } from 'node:fs'
import chalk from 'chalk'
import { sqlDialectFor, targetDatabaseLabel, type TargetDatabaseConfig } from '../graphsql/infrastructure/config/targetDatabases'
import { loadGoldenSet, goldenSetPathFor } from '../graphsql/application/evaluation/goldenSet'
import { selectEvalTarget } from '../graphsql/infrastructure/config/targetDatabases'
import {
  evaluateGoldenSet,
  makeEvaluationDependencies,
  RETRIEVAL_MODES,
  type ModeReport,
  type RetrievalMode,
} from '../graphsql/application/evaluation/evaluateGoldenSet'

const MODE_LABELS: Record<RetrievalMode, string> = {
  none: 'Sin recuperación',
  vector: 'Solo vectorial',
  graphrag: 'GraphRAG',
}

const OUTPUT_DIR = '../docs/evaluacion'

async function main(): Promise<void> {
  const target = selectEvalTarget() // Arcadia por defecto; EVAL_TARGET elige otra del catálogo.
  const dialect = sqlDialectFor(target)
  const cases = loadGoldenSet(goldenSetPathFor(target.name))
  const deps = makeEvaluationDependencies(target)

  if (target.public) {
    console.log(chalk.yellow(`⚠ ${target.name} es una BD pública: el LLM puede haberla visto en su entrenamiento (posible contaminación de resultados).`))
  }
  console.log(chalk.bold(`\nEvaluación sobre ${targetDatabaseLabel(target)} — ${cases.length} casos, ${RETRIEVAL_MODES.length} modos.\n`))

  const reports: ModeReport[] = []
  for (const mode of RETRIEVAL_MODES) {
    console.log(chalk.cyan(`▶ Modo "${MODE_LABELS[mode]}"...`))
    const report = await evaluateGoldenSet(cases, mode, dialect, deps)
    reports.push(report)
    console.log(chalk.dim(`  recall ${pct(report.summary.meanRecall)} · exec ${pct(report.summary.executionAccuracyFair)} (justa) · ${pct(report.summary.executionAccuracySemantic)} (equiv) · ${report.summary.meanContextTables.toFixed(1)} tablas de contexto\n`))
  }

  printComparison(reports)
  writeReport(reports, target)
}

function printComparison(reports: ModeReport[]): void {
  console.log(chalk.bold('\nComparativa por modo:\n'))
  console.log(chalk.dim('  Modo               Recall   Exec.justa   Exec.equiv   Exec.estricta   Tablas ctx   Tokens ctx'))
  for (const report of reports) {
    const label = MODE_LABELS[report.mode].padEnd(18)
    const recall = pct(report.summary.meanRecall).padStart(6)
    const execFair = pct(report.summary.executionAccuracyFair).padStart(10)
    const execSemantic = pct(report.summary.executionAccuracySemantic).padStart(10)
    const execStrict = pct(report.summary.executionAccuracyStrict).padStart(13)
    const tables = report.summary.meanContextTables.toFixed(1).padStart(11)
    const tokens = Math.round(report.summary.meanContextTokens).toString().padStart(12)
    console.log(`  ${label} ${recall} ${execFair} ${execSemantic} ${execStrict} ${tables} ${tokens}`)
  }
  console.log(
    chalk.dim(
      '\n  Exec.justa = la SQL generada contiene el resultado de referencia (correcta o más rica);\n' +
        '  exec.equiv = un LLM juez la da por equivalente a la de referencia (complementaria, el juez también falla);\n' +
        '  exec.estricta = resultado idéntico (cota inferior; penaliza columnas de más).\n' +
        '  Límites: golden set pequeño (un dominio, un modelo), una tirada (generación no determinista),\n' +
        '  y a esta escala de esquema el argumento lo carga sobre todo el tamaño de contexto (tokens).',
    ),
  )
}

function writeReport(reports: ModeReport[], target: TargetDatabaseConfig): void {
  mkdirSync(OUTPUT_DIR, { recursive: true })

  const json = { target: targetDatabaseLabel(target), modes: reports }
  writeFileSync(`${OUTPUT_DIR}/resultados.json`, JSON.stringify(json, null, 2))

  const rows = reports
    .map(
      (r) =>
        `| ${MODE_LABELS[r.mode]} | ${pct(r.summary.meanRecall)} | ${pct(r.summary.executionAccuracyFair)} | ${pct(r.summary.executionAccuracySemantic)} | ${pct(r.summary.executionAccuracyStrict)} | ${r.summary.meanContextTables.toFixed(1)} | ${Math.round(r.summary.meanContextTokens)} |`,
    )
    .join('\n')
  const markdown = [
    '# Evaluación experimental (ablation) — GraphSQL',
    '',
    `BD objetivo: ${targetDatabaseLabel(target)}. Casos: ${reports[0]?.summary.count ?? 0}.`,
    '',
    '| Modo | Schema-linking recall | Execution accuracy (justa) | Equivalencia semántica (LLM) | Execution accuracy (estricta) | Tablas de contexto | Tokens de contexto |',
    '|------|----------------------|----------------------------|------------------------------|-------------------------------|--------------------|--------------------|',
    rows,
    '',
    '> Schema-linking recall: fracción de las tablas que usa la SQL de referencia que llegan al',
    '> contexto del generador (1 = el generador tenía todas las tablas necesarias delante).',
    '>',
    '> Execution accuracy (justa): la SQL generada, ejecutada, contiene el resultado de referencia',
    '> (correcta o más rica; la pregunta en NL no fija las columnas de salida). Estricta: resultado',
    '> idéntico, cota inferior que penaliza columnas de más.',
    '>',
    '> Equivalencia semántica (LLM): un segundo LLM juzga si la candidata responde a la MISMA',
    '> pregunta que la de referencia, viendo las dos SQL y una muestra de sus resultados ejecutados',
    '> (con la candidata ejecutable como precondición). Criterio único: un caso cuenta como',
    '> equivalente si pasa la execution accuracy (justa) O el juez lo rescata; el juez solo RECUPERA',
    '> aciertos que la comparación de datos descarta (empates, columnas de más, agregaciones',
    '> equivalentes), nunca descarta lo que la ejecución ya da por bueno (la equivalencia es siempre ≥',
    '> justa). El juez también se equivoca: es COMPLEMENTARIA, no sustituye a la objetiva.',
    '>',
    '> Límites: golden set pequeño (un solo dominio, un solo modelo), una única tirada por caso',
    '> (la generación no es determinista). A la escala de Arcadia la baseline "sin recuperación"',
    '> aún cabe en el contexto, así que el argumento lo carga el tamaño de contexto/tokens; la',
    '> brecha de execution accuracy se espera que crezca con esquemas mayores.',
    '',
  ].join('\n')
  writeFileSync(`${OUTPUT_DIR}/resumen.md`, markdown)

  console.log(chalk.green(`\n✔ Informe guardado en ${OUTPUT_DIR}/ (resultados.json + resumen.md)\n`))
}

function pct(fraction: number): string {
  return `${Math.round(fraction * 100)}%`
}

main().catch((error) => {
  console.error(chalk.red('\n⚠ La evaluación falló.'))
  console.error(chalk.dim('¿Están Postgres y Neo4j levantados, el esquema escaneado/vectorizado y el LLM disponible?'))
  console.error(error)
  process.exit(1)
})
