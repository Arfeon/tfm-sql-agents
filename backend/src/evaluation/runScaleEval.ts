/**
 * Prueba de escala: la evaluación completa sobre Arcadia (17 tablas) y Nebula (66)
 * en los tres modos de recuperación. Restaura Arcadia en el índice al final.
 * Opt-in (npm run evaluate:scale): requiere Docker, embeddings y LLM.
 */
import { config } from 'dotenv'
config({ path: '../.env' })

import { mkdirSync, writeFileSync } from 'node:fs'
import chalk from 'chalk'
import { loadTargetDatabases, sqlDialectFor, targetDatabaseLabel, type TargetDatabaseConfig } from '../graphsql/infrastructure/config/targetDatabases'
import { hasDescriptionsFile, loadDescriptions } from '../graphsql/infrastructure/config/descriptions'
import { getIndexedModel } from '../graphsql/application/scan/getIndexedModel'
import { EmbeddingsFactory } from '../graphsql/infrastructure/embeddings/EmbeddingsFactory'
import { ingestSchema } from '../graphsql/application/scan/schemaIngestion'
import { vectorizeSchema } from '../graphsql/application/scan/schemaVectorization'
import { loadGoldenSet, goldenSetPathFor } from '../graphsql/application/evaluation/goldenSet'
import { evaluateGoldenSet, makeEvaluationDependencies, RETRIEVAL_MODES, type ModeReport, type RetrievalMode, type EvaluationDependencies } from '../graphsql/application/evaluation/evaluateGoldenSet'

const OUTPUT_DIR = '../docs/evaluacion'

// Argumentos opcionales: --modes none,graphrag (subconjunto de modos), --suffix nuevo-modelo
// (escribe escala-nuevo-modelo.md/-casos.json sin pisar el informe base) y --no-judge (salta el
// juez LLM de equivalencia: la métrica semántica queda igual a la justa y la equivalencia se
// revisa aparte a mano; útil cuando el juez local es lento o poco fiable).
const cliArgs = process.argv.slice(2)
const selectedModes = parseModesArg(cliArgs)
const outputSuffix = parseArgValue(cliArgs, 'suffix')
const skipJudge = cliArgs.includes('--no-judge')

function parseArgValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(`--${name}`)
  return index >= 0 ? args[index + 1] : undefined
}

function parseModesArg(args: string[]): readonly RetrievalMode[] {
  const raw = parseArgValue(args, 'modes')
  if (!raw) {
    return RETRIEVAL_MODES
  }
  const modes = raw.split(',').map((m) => m.trim())
  for (const mode of modes) {
    if (!RETRIEVAL_MODES.includes(mode as RetrievalMode)) {
      throw new Error(`Modo desconocido "${mode}". Válidos: ${RETRIEVAL_MODES.join(', ')}.`)
    }
  }
  return modes as RetrievalMode[]
}

const MODE_LABELS: Record<RetrievalMode, string> = {
  none: 'Sin recuperación',
  vector: 'Solo vectorial',
  graphrag: 'GraphRAG',
}

interface TargetReport {
  name: string
  tableCount: number
  cases: number
  reports: ModeReport[]
}

async function main(): Promise<void> {
  const targets = loadTargetDatabases()
  const arcadia = targets[0]
  const indexed = await getIndexedModel()
  if (!indexed) {
    throw new Error('No hay índice vectorizado de partida. Escanea Arcadia antes de la prueba de escala.')
  }
  const embeddings = EmbeddingsFactory.forIndexedModel(indexed)
  const arcadiaDescriptions = hasDescriptionsFile() ? loadDescriptions() : undefined

  console.log(chalk.bold(`\nPrueba de escala — ${targets.map((t) => t.name).join(' vs ')}\n`))

  const measures: TargetReport[] = []
  try {
    for (const target of targets) {
      if (target.public) {
        console.log(chalk.yellow(`⚠ ${target.name} es una BD pública: el LLM puede haberla visto en su entrenamiento (posible contaminación).`))
      }
      // Descripciones solo para Arcadia: Nebula se mide con esquema puro.
      const descriptions = target.name === arcadia.name ? arcadiaDescriptions : undefined
      console.log(chalk.cyan(`▶ Preparando "${target.name}" (ingesta + vectorización)…`))
      await ingestSchema(target, descriptions)
      await vectorizeSchema(target, indexed.provider, embeddings, descriptions)
      measures.push(await measureTarget(target))
    }
    printComparison(measures)
    writeReport(measures)
  } finally {
    console.log(chalk.dim('\nRestaurando Arcadia (ingesta + vectorización con descripciones)…'))
    await ingestSchema(arcadia, arcadiaDescriptions)
    await vectorizeSchema(arcadia, indexed.provider, embeddings, arcadiaDescriptions)
    console.log(chalk.green('✔ Arcadia restaurada.'))
  }
}

/** Con `--no-judge`, sustituyo el juez LLM por un no-op: la equivalencia se revisa a mano. */
function withOptionalJudge(deps: EvaluationDependencies): EvaluationDependencies {
  if (!skipJudge) {
    return deps
  }
  return {
    ...deps,
    judgeEquivalence: async () => ({ equivalent: false, reason: '(sin juez LLM; revisión manual aparte)' }),
  }
}

async function measureTarget(target: TargetDatabaseConfig): Promise<TargetReport> {
  const dialect = sqlDialectFor(target)
  const cases = loadGoldenSet(goldenSetPathFor(target.name))
  const deps = withOptionalJudge(makeEvaluationDependencies(target))

  const reports: ModeReport[] = []
  for (const mode of selectedModes) {
    console.log(chalk.dim(`    ${target.name} · ${MODE_LABELS[mode]}…`))
    reports.push(
      await evaluateGoldenSet(cases, mode, dialect, deps, (result, index, total) => {
        const mark = result.error ? chalk.red('✗ error') : result.executionMatchFair ? chalk.green('✓ justa') : chalk.yellow('· revisar')
        console.log(chalk.dim(`      [${index + 1}/${total}] ${result.id} ${mark}`))
      }),
    )
  }
  // El modo "sin recuperación" trae el esquema entero, así que su nº de tablas es el del esquema.
  const noneReport = reports.find((r) => r.mode === 'none')
  const tableCount = Math.round(noneReport?.summary.meanContextTables ?? 0)
  return { name: target.name, tableCount, cases: cases.length, reports }
}

function printComparison(measures: TargetReport[]): void {
  console.log(chalk.bold('\nEscala — recall, aciertos y contexto por BD y modo:\n'))
  console.log(chalk.dim('  BD (tablas)        Modo               Recall   Exec.justa   Exec.equiv   Tokens ctx'))
  for (const target of measures) {
    for (const report of target.reports) {
      const bd = `${target.name} (${target.tableCount})`.padEnd(18)
      const mode = MODE_LABELS[report.mode].padEnd(18)
      const recall = pct(report.summary.meanRecall).padStart(6)
      const exec = pct(report.summary.executionAccuracyFair).padStart(10)
      const equiv = pct(report.summary.executionAccuracySemantic).padStart(10)
      const tokens = Math.round(report.summary.meanContextTokens).toString().padStart(12)
      console.log(`  ${bd} ${mode} ${recall} ${exec} ${equiv} ${tokens}`)
    }
    console.log('')
  }
  console.log(
    chalk.dim(
      '  Exec.justa = la SQL generada, ejecutada, contiene el resultado de referencia.\n' +
        '  Exec.equiv = un LLM juez la da por equivalente a la de referencia (complementaria, el juez también falla).\n' +
        '  El contexto de "sin recuperación" crece con el nº de tablas; el del GraphRAG se mantiene acotado.',
    ),
  )
}

function writeReport(measures: TargetReport[]): void {
  mkdirSync(OUTPUT_DIR, { recursive: true })
  const lines: string[] = [
    '# Prueba de escala — GraphSQL',
    '',
    'Evaluación completa (recall + execution accuracy + tamaño de contexto) sobre el golden set de cada BD.',
    '',
    '| BD | Tablas | Casos | Modo | Schema-linking recall | Execution accuracy (justa) | Equivalencia semántica (LLM) | Execution accuracy (estricta) | Tokens de contexto |',
    '|----|--------|-------|------|-----------------------|----------------------------|------------------------------|-------------------------------|--------------------|',
  ]
  for (const target of measures) {
    for (const report of target.reports) {
      lines.push(
        `| ${target.name} | ${target.tableCount} | ${target.cases} | ${MODE_LABELS[report.mode]} | ${pct(report.summary.meanRecall)} | ${pct(report.summary.executionAccuracyFair)} | ${pct(report.summary.executionAccuracySemantic)} | ${pct(report.summary.executionAccuracyStrict)} | ${Math.round(report.summary.meanContextTokens)} |`,
      )
    }
  }
  lines.push(
    '',
    '> Schema-linking recall: fracción de las tablas que usa la SQL de referencia que llegan al',
    '> contexto del generador (1 = el generador tenía todas las tablas necesarias delante).',
    '>',
    '> Execution accuracy (justa): la SQL generada, ejecutada, contiene el resultado de referencia',
    '> (correcta o más rica; la pregunta en NL no fija las columnas de salida). Estricta: resultado',
    '> idéntico, cota inferior que penaliza columnas de más.',
    '>',
    '> El contexto de "sin recuperación" crece con el nº de tablas del esquema; el del GraphRAG se',
    '> mantiene acotado, con recall alto. La execution accuracy es de una sola tirada (la generación',
    '> no es determinista); los datos de Nebula son sintéticos y ligeros (validan la resolución',
    '> pregunta→SQL, no un volumen realista).',
    '>',
    '> Equivalencia semántica (LLM): un segundo LLM juzga si la SQL candidata responde a la MISMA',
    '> pregunta que la de referencia, viendo las dos SQL y una muestra de sus resultados ejecutados',
    '> (con la candidata ejecutable como precondición). Criterio único: un caso cuenta como',
    '> equivalente si pasa la execution accuracy (justa) O el juez lo rescata; el juez solo RECUPERA',
    '> aciertos que la comparación de datos descarta (empates, columnas de más, agregaciones',
    '> equivalentes), nunca descarta lo que la ejecución ya da por bueno, así que la equivalencia es',
    '> siempre ≥ justa. Como se apoya en un LLM, es COMPLEMENTARIA, no sustituye a la objetiva. El detalle',
    '> por caso está en `escala-casos.json`: `recall` y los dos `executionMatch` son estas mismas',
    '> métricas a nivel de caso, y `equivalenceReason` es la justificación textual del juez.',
    '',
  )
  const reportName = outputSuffix ? `escala-${outputSuffix}.md` : 'escala.md'
  const casesName = outputSuffix ? `escala-casos-${outputSuffix}.json` : 'escala-casos.json'
  writeFileSync(`${OUTPUT_DIR}/${reportName}`, lines.join('\n'))
  writeCaseDetails(measures, casesName)
  console.log(chalk.green(`\n✔ Informe guardado en ${OUTPUT_DIR}/${reportName} (+ ${casesName})`))
}

function writeCaseDetails(measures: TargetReport[], fileName: string): void {
  const detail = measures.map((target) => ({
    name: target.name,
    tableCount: target.tableCount,
    modes: target.reports.map((report) => ({
      mode: report.mode,
      cases: report.cases.map((c) => ({
        id: c.id,
        difficulty: c.difficulty,
        recall: c.schemaLinkingRecall,
        executionMatchStrict: c.executionMatchStrict,
        executionMatchFair: c.executionMatchFair,
        executionMatchSemantic: c.executionMatchSemantic,
        equivalenceReason: c.equivalenceReason,
        error: c.error,
        referenceSql: c.referenceSql,
        generatedSql: c.generatedSql,
      })),
    })),
  }))
  writeFileSync(`${OUTPUT_DIR}/${fileName}`, JSON.stringify(detail, null, 2))
}

function pct(fraction: number): string {
  return `${Math.round(fraction * 100)}%`
}

main().catch((error) => {
  console.error(chalk.red('\n⚠ La prueba de escala falló.'))
  console.error(error)
  process.exit(1)
})
