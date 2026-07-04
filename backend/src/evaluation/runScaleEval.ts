/**
 * Prueba de escala (SPEC-17): ¿cómo cambian recuperación y aciertos al crecer el
 * esquema? Comparo Arcadia (17 tablas) con Nebula (66 tablas) corriendo la evaluación
 * COMPLETA (recall + tamaño de contexto + execution accuracy) en los tres modos de
 * recuperación (sin recuperación / solo vectorial / GraphRAG).
 *
 * Neo4j y pgvector son de un solo inquilín, así que para medir cada BD ingiero y
 * vectorizo su esquema (sustituyendo el índice compartido). Al terminar RESTAURO
 * Arcadia (con sus descripciones) en `try/finally`, para no dejar el índice degradado.
 *
 * Opt-in (`npm run evaluate:scale`): requiere Docker (Postgres+Neo4j con ambas BDs
 * pobladas), el proveedor de embeddings y el LLM. Es la capa más externa: orquesto y
 * presento; la lógica vive en `evaluateGoldenSet`.
 */
import { config } from 'dotenv'
config({ path: '../.env' })

import { mkdirSync, writeFileSync } from 'node:fs'
import chalk from 'chalk'
import { loadTargetDatabases, sqlDialectFor, targetDatabaseLabel, type TargetDatabaseConfig } from '../graphsql/infrastructure/config/targetDatabases'
import { hasDescriptionsFile, loadDescriptions } from '../graphsql/infrastructure/config/descriptions'
import { getIndexedModel } from '../graphsql/application/getIndexedModel'
import { EmbeddingsFactory } from '../graphsql/infrastructure/embeddings/EmbeddingsFactory'
import { ingestSchema } from '../graphsql/application/schemaIngestion'
import { vectorizeSchema } from '../graphsql/application/schemaVectorization'
import { loadGoldenSet, goldenSetPathFor } from '../graphsql/application/goldenSet'
import { evaluateGoldenSet, makeEvaluationDependencies, RETRIEVAL_MODES, type ModeReport, type RetrievalMode } from '../graphsql/application/evaluateGoldenSet'

const OUTPUT_DIR = '../docs/evaluacion'

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
      // Descripciones solo para Arcadia (Nebula se mide con esquema puro).
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

/** Evaluación completa (recall + contexto + execution accuracy) por modo sobre una BD. */
async function measureTarget(target: TargetDatabaseConfig): Promise<TargetReport> {
  const dialect = sqlDialectFor(target)
  const cases = loadGoldenSet(goldenSetPathFor(target.name))
  const deps = makeEvaluationDependencies(target)

  const reports: ModeReport[] = []
  for (const mode of RETRIEVAL_MODES) {
    console.log(chalk.dim(`    ${target.name} · ${MODE_LABELS[mode]}…`))
    reports.push(await evaluateGoldenSet(cases, mode, dialect, deps))
  }
  // El modo "sin recuperación" trae el esquema entero: su nº de tablas es el del esquema.
  const noneReport = reports.find((r) => r.mode === 'none')
  const tableCount = Math.round(noneReport?.summary.meanContextTables ?? 0)
  return { name: target.name, tableCount, cases: cases.length, reports }
}

/** Tabla comparativa: por BD y modo, recall, execution accuracy y tamaño de contexto. */
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

/** Guardo la comparación de escala en Markdown para la memoria/slides. */
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
    '> El contexto de "sin recuperación" crece con el nº de tablas del esquema; el del GraphRAG se',
    '> mantiene acotado, con recall alto. La execution accuracy es de una sola tirada (la generación',
    '> no es determinista); los datos de Nebula son sintéticos y ligeros (validan la resolución',
    '> pregunta→SQL, no un volumen realista).',
    '>',
    '> Equivalencia semántica (LLM): un segundo LLM juzga si la SQL candidata responde a la MISMA',
    '> pregunta que la de referencia (con la candidata ejecutable como precondición). Recupera aciertos',
    '> que la comparación de resultados descarta (empates, columnas de más, agregaciones equivalentes);',
    '> como se apoya en un LLM, es COMPLEMENTARIA a la execution accuracy, no la sustituye. El detalle',
    '> por caso (SQL generada y motivo del juez) está en `escala-casos.json`.',
    '',
  )
  writeFileSync(`${OUTPUT_DIR}/escala.md`, lines.join('\n'))
  writeCaseDetails(measures)
  console.log(chalk.green(`\n✔ Informe guardado en ${OUTPUT_DIR}/escala.md (+ escala-casos.json)`))
}

/** Guardo el detalle por caso (SQL generada, aciertos y motivo del juez) para poder inspeccionarlo. */
function writeCaseDetails(measures: TargetReport[]): void {
  const detail = measures.map((target) => ({
    name: target.name,
    tableCount: target.tableCount,
    modes: target.reports.map((report) => ({
      mode: report.mode,
      cases: report.cases.map((c) => ({
        id: c.id,
        difficulty: c.difficulty,
        recall: c.schemaLinkingRecall,
        executionMatchFair: c.executionMatchFair,
        executionMatchSemantic: c.executionMatchSemantic,
        equivalenceReason: c.equivalenceReason,
        error: c.error,
        generatedSql: c.generatedSql,
      })),
    })),
  }))
  writeFileSync(`${OUTPUT_DIR}/escala-casos.json`, JSON.stringify(detail, null, 2))
}

function pct(fraction: number): string {
  return `${Math.round(fraction * 100)}%`
}

main().catch((error) => {
  console.error(chalk.red('\n⚠ La prueba de escala falló.'))
  console.error(error)
  process.exit(1)
})
