/**
 * Experimento de confusión: renombra 6 tablas de Nebula (y sus columnas) a nombres
 * opacos y evalúa un mini golden set en 2×3 condiciones (descripciones × modo).
 * Renombra y SIEMPRE revierte al terminar; restaura Arcadia en el índice.
 * Opt-in (npm run evaluate:confusion): requiere Docker, embeddings y LLM.
 */
import { join } from 'node:path'
import { config } from 'dotenv'
import { PROJECT_ROOT } from '../graphsql/infrastructure/config/projectRoot'
config({ path: join(PROJECT_ROOT, '.env') })

import { mkdirSync, writeFileSync } from 'node:fs'
import { Client } from 'pg'
import chalk from 'chalk'
import { loadTargetDatabases, sqlDialectFor, type TargetDatabaseConfig } from '../graphsql/infrastructure/config/targetDatabases'
import { hasDescriptionsFile, loadDescriptions } from '../graphsql/infrastructure/config/descriptions'
import { getIndexedModel } from '../graphsql/application/scan/getIndexedModel'
import { EmbeddingsFactory } from '../graphsql/infrastructure/embeddings/EmbeddingsFactory'
import { ingestSchema } from '../graphsql/application/scan/schemaIngestion'
import { vectorizeSchema } from '../graphsql/application/scan/schemaVectorization'
import { loadGoldenSet } from '../graphsql/application/evaluation/goldenSet'
import { evaluateGoldenSet, makeEvaluationDependencies, RETRIEVAL_MODES, type ModeReport, type RetrievalMode } from '../graphsql/application/evaluation/evaluateGoldenSet'

const GOLDEN_CONFUSION_PATH = '../setup/datasets/nebula/golden_confusion.yaml'
const OUTPUT_DIR = '../docs/evaluacion'

const MODE_LABELS: Record<RetrievalMode, string> = {
  none: 'Sin recuperación',
  vector: 'Solo vectorial',
  graphrag: 'GraphRAG',
}

/**
 * Nombre Y columnas opacas: con solo el nombre de tabla ofuscado las columnas
 * delataban el propósito y el recall aguantaba ~100% sin descripciones.
 */
const RENAMES = [
  {
    original: 'purchase', confusing: 't_ops_01',
    columns: [
      { from: 'purchase_id', to: 'c1' },
      { from: 'customer_id', to: 'c2' },
      { from: 'dlc_id', to: 'c3' },
      { from: 'purchase_date', to: 'c4' },
      { from: 'amount', to: 'c5' },
    ],
    description: 'Compras puntuales de DLC. c2 = cliente (customer), c3 = DLC comprado, c4 = fecha de compra, c5 = importe pagado.',
  },
  {
    original: 'refund', confusing: 't_ops_02',
    columns: [
      { from: 'refund_id', to: 'c1' },
      { from: 'invoice_id', to: 'c2' },
      { from: 'amount', to: 'c3' },
      { from: 'reason', to: 'c4' },
      { from: 'refunded_at', to: 'c5' },
    ],
    description: 'Devoluciones (reembolsos) de facturas. c2 = factura (invoice), c3 = importe devuelto, c4 = motivo, c5 = fecha de la devolución.',
  },
  {
    original: 'gift_card', confusing: 't_ops_03',
    columns: [
      { from: 'gift_card_id', to: 'c1' },
      { from: 'purchaser_id', to: 'c2' },
      { from: 'balance', to: 'c3' },
      { from: 'issued_at', to: 'c4' },
    ],
    description: 'Tarjetas regalo emitidas. c2 = cliente que la compró, c3 = saldo pendiente, c4 = fecha de emisión.',
  },
  {
    original: 'rating', confusing: 't_ops_04',
    columns: [
      { from: 'rating_id', to: 'c1' },
      { from: 'customer_id', to: 'c2' },
      { from: 'game_id', to: 'c3' },
      { from: 'score', to: 'c4' },
      { from: 'rated_at', to: 'c5' },
    ],
    description: 'Valoraciones de juegos por clientes. c2 = cliente, c3 = juego valorado, c4 = puntuación (score), c5 = fecha.',
  },
  {
    original: 'message', confusing: 't_ops_05',
    columns: [
      { from: 'message_id', to: 'c1' },
      { from: 'chat_room_id', to: 'c2' },
      { from: 'sender_id', to: 'c3' },
      { from: 'body', to: 'c4' },
      { from: 'sent_at', to: 'c5' },
    ],
    description: 'Mensajes de chat entre clientes. c2 = sala de chat, c3 = cliente remitente, c4 = texto del mensaje, c5 = fecha de envío.',
  },
  {
    original: 'save_game', confusing: 't_ops_06',
    columns: [
      { from: 'save_id', to: 'c1' },
      { from: 'customer_id', to: 'c2' },
      { from: 'game_id', to: 'c3' },
      { from: 'slot', to: 'c4' },
      { from: 'updated_at', to: 'c5' },
    ],
    description: 'Partidas guardadas (saves) de los clientes. c2 = cliente, c3 = juego, c4 = ranura (slot), c5 = fecha de actualización.',
  },
]

interface Condition {
  descriptions: boolean
  report: ModeReport
}

async function main(): Promise<void> {
  const targets = loadTargetDatabases()
  const arcadia = targets[0]
  const nebula = targets.find((t) => t.name === 'nebula')
  if (!nebula) {
    throw new Error('El experimento necesita "nebula" en el catálogo (TARGET_DB_2_* en el .env).')
  }
  const indexed = await getIndexedModel()
  if (!indexed) {
    throw new Error('No hay índice vectorizado de partida. Escanea Arcadia antes del experimento.')
  }
  const embeddings = EmbeddingsFactory.forIndexedModel(indexed)
  const arcadiaDescriptions = hasDescriptionsFile() ? loadDescriptions() : undefined
  const cases = loadGoldenSet(GOLDEN_CONFUSION_PATH)
  const dialect = sqlDialectFor(nebula)
  const confusionDescriptions = new Map(RENAMES.map((r) => [r.confusing, r.description]))

  console.log(chalk.bold(`\nExperimento de confusión — ${RENAMES.length} tablas ofuscadas, ${cases.length} preguntas, 2×3 condiciones\n`))

  await applyRenames(nebula)
  const conditions: Condition[] = []
  try {
    for (const withDescriptions of [true, false]) {
      const label = withDescriptions ? 'CON descripciones' : 'SIN descripciones'
      console.log(chalk.cyan(`▶ Condición ${label}: ingesta + vectorización de nebula…`))
      const descriptions = withDescriptions ? confusionDescriptions : undefined
      await ingestSchema(nebula, descriptions)
      await vectorizeSchema(nebula, indexed.provider, embeddings, descriptions)

      const deps = makeEvaluationDependencies(nebula, { includeDescriptions: withDescriptions })
      for (const mode of RETRIEVAL_MODES) {
        console.log(chalk.dim(`    ${label} · ${MODE_LABELS[mode]}…`))
        conditions.push({ descriptions: withDescriptions, report: await evaluateGoldenSet(cases, mode, dialect, deps) })
      }
    }
    printComparison(conditions)
    writeReport(conditions)
  } finally {
    console.log(chalk.dim('\nRevirtiendo los renombres y restaurando Arcadia…'))
    await revertRenames(nebula)
    await ingestSchema(arcadia, arcadiaDescriptions)
    await vectorizeSchema(arcadia, indexed.provider, embeddings, arcadiaDescriptions)
    console.log(chalk.green('✔ Nebula con sus nombres originales y Arcadia restaurada en el índice.'))
  }
}

/** Conexión de escritura solo para los ALTER; la evaluación sigue siendo de solo lectura. */
function writeClientFor(target: TargetDatabaseConfig): Client {
  return new Client({ host: target.host, port: target.port, database: target.name, user: target.user, password: target.password })
}

/** Tolerante a fallos a medias para poder relanzar: lo ya renombrado se salta. */
async function applyRenames(target: TargetDatabaseConfig): Promise<void> {
  const client = writeClientFor(target)
  await client.connect()
  try {
    for (const { original, confusing, columns } of RENAMES) {
      const state = await tableState(client, original, confusing)
      if (state === 'missing') {
        throw new Error(`Ni "${original}" ni "${confusing}" existen en ${target.name}: no sé en qué estado está la BD.`)
      }
      if (state === 'original') {
        await client.query(`ALTER TABLE ${original} RENAME TO ${confusing}`)
      }
      for (const { from, to } of columns) {
        if (await columnExists(client, confusing, from)) {
          await client.query(`ALTER TABLE ${confusing} RENAME COLUMN ${from} TO ${to}`)
        }
      }
      console.log(chalk.dim(`  ${original} → ${confusing} (${columns.map((c) => c.to).join(', ')})`))
    }
  } finally {
    await client.end()
  }
}

/** Tolerante a fallos a medias: revierte solo lo que esté renombrado. */
async function revertRenames(target: TargetDatabaseConfig): Promise<void> {
  const client = writeClientFor(target)
  await client.connect()
  try {
    for (const { original, confusing, columns } of RENAMES) {
      const state = await tableState(client, original, confusing)
      const currentName = state === 'renamed' ? confusing : original
      for (const { from, to } of columns) {
        if (await columnExists(client, currentName, to)) {
          await client.query(`ALTER TABLE ${currentName} RENAME COLUMN ${to} TO ${from}`)
        }
      }
      if (state === 'renamed') {
        await client.query(`ALTER TABLE ${confusing} RENAME TO ${original}`)
      }
    }
  } finally {
    await client.end()
  }
}

async function columnExists(client: Client, table: string, column: string): Promise<boolean> {
  const result = await client.query(
    `SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
    [table, column],
  )
  return result.rows.length > 0
}

async function tableState(client: Client, original: string, confusing: string): Promise<'original' | 'renamed' | 'missing'> {
  const result = await client.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1)`,
    [[original, confusing]],
  )
  const names = result.rows.map((row) => row.table_name)
  if (names.includes(confusing)) {
    return 'renamed'
  }
  return names.includes(original) ? 'original' : 'missing'
}

function printComparison(conditions: Condition[]): void {
  console.log(chalk.bold('\nConfusión — descripciones × modo (sobre las preguntas de tablas ofuscadas):\n'))
  console.log(chalk.dim('  Descripciones   Modo               Recall   Exec.justa   Exec.equiv'))
  for (const c of conditions) {
    const desc = (c.descriptions ? 'con' : 'sin').padEnd(14)
    const mode = MODE_LABELS[c.report.mode].padEnd(18)
    const recall = pct(c.report.summary.meanRecall).padStart(6)
    const fair = pct(c.report.summary.executionAccuracyFair).padStart(10)
    const equiv = pct(c.report.summary.executionAccuracySemantic).padStart(10)
    console.log(`  ${desc} ${mode} ${recall} ${fair} ${equiv}`)
  }

  console.log(chalk.bold('\nDetalle por caso (¿se recuperó la tabla ofuscada?):\n'))
  for (const c of conditions) {
    const label = `${c.descriptions ? 'con' : 'sin'} · ${MODE_LABELS[c.report.mode]}`
    const detail = c.report.cases
      .map((caso) => {
        const opaque = caso.retrievedTables.find((t) => t.startsWith('t_ops_'))
        return `${caso.id}:${opaque ? chalk.green('sí') : chalk.red('no')}${caso.executionMatchFair ? chalk.green('✓') : chalk.red('✗')}`
      })
      .join('  ')
    console.log(`  ${label.padEnd(26)} ${detail}`)
  }
  console.log(chalk.dim('\n  Por caso: "sí/no" = la tabla ofuscada apareció en el contexto; ✓/✗ = execution accuracy justa.'))
}

function writeReport(conditions: Condition[]): void {
  mkdirSync(OUTPUT_DIR, { recursive: true })
  const lines: string[] = [
    '# Experimento de confusión — tablas Y columnas opacas (SPEC-21, fase dura)',
    '',
    `Seis tablas de Nebula renombradas al mismo patrón opaco (${RENAMES.map((r) => r.confusing).join(', ')})`,
    'y sus COLUMNAS renombradas a c1..c5 (mismo patrón en todas, como un ERP legacy): sin descripciones',
    'no habla nada — ni el nombre ni las columnas; quedan los tipos y las claves foráneas (estructura).',
    'En la fase 1 (solo nombre de tabla opaco) el recall aguantó ~100% porque las columnas delataban el',
    'propósito; esta fase cierra esa vía. Preguntas que solo se responden con estas tablas, evaluadas',
    'con y sin descripciones (la descripción mapea las columnas, como documentaría un data steward).',
    '',
    '| Descripciones | Modo | Schema-linking recall | Execution accuracy (justa) | Equivalencia (LLM) |',
    '|---------------|------|-----------------------|----------------------------|--------------------|',
  ]
  for (const c of conditions) {
    lines.push(
      `| ${c.descriptions ? 'con' : 'sin'} | ${MODE_LABELS[c.report.mode]} | ${pct(c.report.summary.meanRecall)} | ${pct(c.report.summary.executionAccuracyFair)} | ${pct(c.report.summary.executionAccuracySemantic)} |`,
    )
  }
  lines.push('', '## Detalle por caso (¿apareció la tabla ofuscada en el contexto? / ¿acertó?)', '')
  lines.push('| Condición | ' + conditions[0].report.cases.map((c) => c.id).join(' | ') + ' |')
  lines.push('|-----------|' + conditions[0].report.cases.map(() => '----').join('|') + '|')
  for (const c of conditions) {
    const label = `${c.descriptions ? 'con' : 'sin'} · ${MODE_LABELS[c.report.mode]}`
    const cells = c.report.cases.map((caso) => {
      const opaque = caso.retrievedTables.some((t) => t.startsWith('t_ops_'))
      return `${opaque ? 'sí' : 'no'} / ${caso.executionMatchFair ? '✓' : '✗'}`
    })
    lines.push(`| ${label} | ${cells.join(' | ')} |`)
  }
  lines.push(
    '',
    '> Contexto: el benchmark normal es amable con la baseline (nombres autoexplicativos, sesgo #5 de',
    '> arquitectura §10). Aquí se mide qué pasa cuando el nombre no ayuda: cuánto pierden los modos sin',
    '> descripciones, cuánto rescatan las descripciones, y si el grafo salva las multi-hop (C-05, C-06)',
    '> por la clave foránea, como hizo con t_042. En "sin recuperación" el esquema entero viaja igual;',
    '> lo que cambia es si el DDL lleva el comentario de descripción.',
    '',
  )
  writeFileSync(`${OUTPUT_DIR}/confusion.md`, lines.join('\n'))
  console.log(chalk.green(`\n✔ Informe guardado en ${OUTPUT_DIR}/confusion.md`))
}

function pct(fraction: number): string {
  return `${Math.round(fraction * 100)}%`
}

main().catch((error) => {
  console.error(chalk.red('\n⚠ El experimento de confusión falló.'))
  console.error(error)
  process.exit(1)
})
