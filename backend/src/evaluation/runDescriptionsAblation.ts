/**
 * Ablation de descripciones: 2×2 (vectorial/GraphRAG × con/sin descripciones).
 * Re-vectoriza el índice a mitad y SIEMPRE lo restaura con descripciones al final.
 * Opt-in (npm run evaluate:descriptions): requiere Docker, embeddings y LLM.
 */
import { config } from 'dotenv'
config({ path: '../.env' })

import { mkdirSync, writeFileSync } from 'node:fs'
import chalk from 'chalk'
import { loadTargetDatabases, sqlDialectFor, targetDatabaseLabel, type TargetDatabaseConfig } from '../graphsql/infrastructure/config/targetDatabases'
import { hasDescriptionsFile, loadDescriptions } from '../graphsql/infrastructure/config/descriptions'
import { getIndexedModel } from '../graphsql/application/scan/getIndexedModel'
import { EmbeddingsFactory } from '../graphsql/infrastructure/embeddings/EmbeddingsFactory'
import { vectorizeSchema } from '../graphsql/application/scan/schemaVectorization'
import { loadGoldenSet } from '../graphsql/application/evaluation/goldenSet'
import { evaluateGoldenSet, makeEvaluationDependencies, type ModeReport } from '../graphsql/application/evaluation/evaluateGoldenSet'

const OUTPUT_DIR = '../docs/evaluacion'
/** Caso de nombre opaco que solo se localiza por su descripción (t_042, la lista de deseos). */
const OPAQUE_CASE_ID = 'G-25'

interface Condition {
  mode: 'vector' | 'graphrag'
  descriptions: boolean
  report: ModeReport
}

async function main(): Promise<void> {
  const target = loadTargetDatabases()[0]
  const dialect = sqlDialectFor(target)
  const cases = loadGoldenSet()

  const indexed = await getIndexedModel()
  if (!indexed) {
    throw new Error('No hay índice vectorizado. Escanea y vectoriza el esquema antes de este ablation.')
  }
  if (!hasDescriptionsFile()) {
    throw new Error('Este ablation necesita el fichero de descripciones (descriptions/). No se encontró.')
  }
  const descriptions = loadDescriptions()
  const embeddings = EmbeddingsFactory.forIndexedModel(indexed)

  console.log(chalk.bold(`\nAblation de descripciones sobre ${targetDatabaseLabel(target)} — ${cases.length} casos.\n`))

  const conditions: Condition[] = []
  console.log(chalk.dim('Vectorizando CON descripciones...'))
  await vectorizeSchema(target, indexed.provider, embeddings, descriptions)
  try {
    const withDeps = makeEvaluationDependencies(target, { includeDescriptions: true })
    conditions.push({ mode: 'vector', descriptions: true, report: await evaluateGoldenSet(cases, 'vector', dialect, withDeps) })
    conditions.push({ mode: 'graphrag', descriptions: true, report: await evaluateGoldenSet(cases, 'graphrag', dialect, withDeps) })

    console.log(chalk.dim('Vectorizando SIN descripciones...'))
    await vectorizeSchema(target, indexed.provider, embeddings, undefined)
    const withoutDeps = makeEvaluationDependencies(target, { includeDescriptions: false })
    conditions.push({ mode: 'vector', descriptions: false, report: await evaluateGoldenSet(cases, 'vector', dialect, withoutDeps) })
    conditions.push({ mode: 'graphrag', descriptions: false, report: await evaluateGoldenSet(cases, 'graphrag', dialect, withoutDeps) })

    printComparison(conditions)
    writeReport(conditions, target)
  } finally {
    console.log(chalk.dim('\nRestaurando el índice CON descripciones...'))
    await vectorizeSchema(target, indexed.provider, embeddings, descriptions)
    console.log(chalk.green('✔ Índice restaurado.'))
  }
}

function printComparison(conditions: Condition[]): void {
  console.log(chalk.bold('\nDescripciones — comparativa 2×2:\n'))
  console.log(chalk.dim('  Modo       Descripciones   Recall   Exec.justa'))
  for (const c of conditions) {
    const label = c.mode.padEnd(10)
    const desc = (c.descriptions ? 'con' : 'sin').padEnd(13)
    const recall = pct(c.report.summary.meanRecall).padStart(6)
    const exec = pct(c.report.summary.executionAccuracyFair).padStart(10)
    console.log(`  ${label} ${desc} ${recall} ${exec}`)
  }

  console.log(chalk.bold(`\nFoco ${OPAQUE_CASE_ID} (t_042, tabla de nombre opaco):\n`))
  for (const c of conditions) {
    const g25 = c.report.cases.find((x) => x.id === OPAQUE_CASE_ID)
    if (!g25) continue
    const found = g25.retrievedTables.includes('t_042')
    console.log(
      `  ${c.mode.padEnd(10)} ${(c.descriptions ? 'con' : 'sin').padEnd(4)} → t_042 recuperada: ${found ? chalk.green('sí') : chalk.red('no')} · recall ${pct(g25.schemaLinkingRecall)} · resultado ${g25.executionMatchFair ? chalk.green('correcto') : chalk.red('no')}`,
    )
  }
}

function writeReport(conditions: Condition[], target: TargetDatabaseConfig): void {
  mkdirSync(OUTPUT_DIR, { recursive: true })
  const rows = conditions
    .map((c) => `| ${c.mode} | ${c.descriptions ? 'con' : 'sin'} | ${pct(c.report.summary.meanRecall)} | ${pct(c.report.summary.executionAccuracyFair)} |`)
    .join('\n')
  const g25Rows = conditions
    .map((c) => {
      const g25 = c.report.cases.find((x) => x.id === OPAQUE_CASE_ID)
      if (!g25) {
        return `| ${c.mode} | ${c.descriptions ? 'con' : 'sin'} | (caso ${OPAQUE_CASE_ID} no encontrado) | — | — |`
      }
      const found = g25.retrievedTables.includes('t_042') ? 'sí' : 'no'
      return `| ${c.mode} | ${c.descriptions ? 'con' : 'sin'} | ${found} | ${pct(g25.schemaLinkingRecall)} | ${g25.executionMatchFair ? 'sí' : 'no'} |`
    })
    .join('\n')
  const markdown = [
    '# Ablation de descripciones — GraphSQL',
    '',
    `BD objetivo: ${targetDatabaseLabel(target)}. Casos: ${conditions[0]?.report.summary.count ?? 0}.`,
    '',
    '## Comparativa 2×2 (modo × descripciones)',
    '',
    '| Modo | Descripciones | Schema-linking recall | Execution accuracy (justa) |',
    '|------|---------------|-----------------------|----------------------------|',
    rows,
    '',
    `## Foco ${OPAQUE_CASE_ID}: t_042 (tabla de nombre opaco = lista de deseos)`,
    '',
    '| Modo | Descripciones | ¿t_042 recuperada? | Recall | ¿resultado correcto? |',
    '|------|---------------|--------------------|--------|----------------------|',
    g25Rows,
    '',
    '> Sin descripciones, el índice se vectoriza solo con nombre + columnas y el DDL no lleva',
    '> el comentario de propósito. La tabla `t_042` no delata por su nombre que guarda listas',
    '> de deseos, así que es el caso donde las descripciones deberían marcar la diferencia.',
    '',
  ].join('\n')
  writeFileSync(`${OUTPUT_DIR}/descripciones.md`, markdown)
  console.log(chalk.green(`\n✔ Informe guardado en ${OUTPUT_DIR}/descripciones.md`))
}

function pct(fraction: number): string {
  return `${Math.round(fraction * 100)}%`
}

main().catch((error) => {
  console.error(chalk.red('\n⚠ El ablation de descripciones falló.'))
  console.error(error)
  process.exit(1)
})
