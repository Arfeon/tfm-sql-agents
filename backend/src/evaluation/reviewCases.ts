/**
 * Revisión objetiva de equivalencia SIN juez LLM: para cada caso que no pasa la métrica justa,
 * ejecuto ambas SQL y comparo filas (con tolerancia de redondeo); si aun así divergen, imprimo
 * una muestra de las dos para juzgar a mano. Manda la ejecución real, no un LLM.
 * Uso: npm run evaluate:review [ruta-al-casos.json]  (por defecto, escala-casos-coder14b.json)
 */
import { config } from 'dotenv'
config({ path: '../.env' })

import { readFileSync } from 'node:fs'
import { loadTargetDatabases, sqlDialectFor, type TargetDatabaseConfig } from '../graphsql/infrastructure/config/targetDatabases'
import { TargetDatabaseFactory } from '../graphsql/infrastructure/targetdb/TargetDatabaseFactory'
import { executeQuery } from '../graphsql/application/queryExecution'

const CASES_FILE = process.argv[2] ?? '../docs/evaluacion/escala-casos-coder14b.json'

type Row = Record<string, unknown>

/** Redondeo a 2 decimales para los numéricos; el resto, texto tal cual. */
function norm(value: unknown): string {
  if (value === null || value === undefined) return '∅'
  const text = String(value).trim()
  const num = Number(text)
  if (text !== '' && !Number.isNaN(num)) return String(Math.round(num * 100) / 100)
  return text
}

/** Cada valor de la fila de referencia aparece en la candidata (permite columnas de más). */
function rowContains(candidate: string[], reference: string[]): boolean {
  const pool = [...candidate]
  for (const value of reference) {
    const i = pool.indexOf(value)
    if (i < 0) return false
    pool.splice(i, 1)
  }
  return true
}

/** La referencia (multiconjunto de filas) está contenida en la candidata, tras redondear. */
function containsAll(reference: Row[], candidate: Row[]): boolean {
  if (reference.length !== candidate.length) return false
  const cand = candidate.map((r) => Object.values(r).map(norm))
  const used = new Array(cand.length).fill(false)
  for (const refRow of reference.map((r) => Object.values(r).map(norm))) {
    const idx = cand.findIndex((c, i) => !used[i] && rowContains(c, refRow))
    if (idx < 0) return false
    used[idx] = true
  }
  return true
}

function sample(rows: Row[], n = 3): string {
  const head = rows.slice(0, n).map((r) => JSON.stringify(r))
  return `${rows.length} filas${rows.length ? `: ${head.join(' | ')}${rows.length > n ? ' …' : ''}` : ''}`
}

/** Solo los valores numéricos de cada fila (redondeados), ordenados: las "medidas". */
function numericMultiset(rows: Row[]): string {
  const nums: number[] = []
  for (const row of rows) {
    for (const value of Object.values(row)) {
      const text = String(value).trim()
      const num = Number(text)
      if (text !== '' && !Number.isNaN(num)) nums.push(Math.round(num * 100) / 100)
    }
  }
  return nums.sort((a, b) => a - b).join(',')
}

/** ¿Coinciden las medidas numéricas de ambos resultados? (distingue "relabel" de "datos distintos") */
function numbersMatch(reference: Row[], candidate: Row[]): boolean {
  return numericMultiset(reference) === numericMultiset(candidate)
}

async function runOn(target: TargetDatabaseConfig, sqlText: string): Promise<Row[]> {
  const dialect = sqlDialectFor(target)
  const result = await executeQuery({ text: sqlText, dialect }, {}, { connectDatabase: (o) => TargetDatabaseFactory.connect(target, o) })
  return result.rows
}

async function main(): Promise<void> {
  const detail = JSON.parse(readFileSync(CASES_FILE, 'utf8')) as Array<{
    name: string
    modes: Array<{ mode: string; cases: Array<{ id: string; executionMatchFair: boolean; error?: string; referenceSql: string; generatedSql: string }> }>
  }>
  const targets = loadTargetDatabases()

  for (const db of detail) {
    const target = targets.find((t) => t.name === db.name)
    if (!target) continue
    for (const modeReport of db.modes) {
      const failing = modeReport.cases.filter((c) => !c.executionMatchFair)
      if (failing.length === 0) continue
      console.log(`\n===== ${db.name} · ${modeReport.mode} — ${failing.length} casos que NO pasan la justa =====`)
      for (const c of failing) {
        if (c.error) {
          console.log(`  ${c.id}: ERROR de ejecución → ${c.error.slice(0, 90)}`)
          continue
        }
        try {
          const [ref, cand] = await Promise.all([runOn(target, c.referenceSql), runOn(target, c.generatedSql)])
          if (containsAll(ref, cand)) {
            console.log(`  ${c.id}: EQUIVALENTE (redondeo/columna de más) — ref ${ref.length} filas ⊆ cand ${cand.length}`)
          } else {
            const countMatch = ref.length === cand.length
            const numsMatch = numbersMatch(ref, cand)
            const tag = numsMatch && countMatch ? 'MISMAS MEDIDAS (solo cambian etiquetas/columnas)' : numsMatch ? 'medidas iguales pero ≠ nº filas' : 'MEDIDAS DISTINTAS (datos diferentes)'
            console.log(`  ${c.id}: DIFERENCIA — ${tag} [ref ${ref.length}f / cand ${cand.length}f]`)
            console.log(`      ref : ${sample(ref)}`)
            console.log(`      cand: ${sample(cand)}`)
          }
        } catch (error) {
          console.log(`  ${c.id}: no pude ejecutar una de las dos → ${error instanceof Error ? error.message.slice(0, 90) : String(error)}`)
        }
      }
    }
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error)
    process.exit(1)
  },
)
