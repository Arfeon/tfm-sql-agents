/**
 * Agregado de varias tiradas de la prueba de escala (SPEC-17).
 *
 * La generación no es determinista, así que una sola tirada baila ±8pp. Este script
 * lee las tiradas guardadas en `docs/evaluacion/tiradas/escala-casos-run*.json`
 * (cada una es un `evaluate:scale` completo) y agrega por BD y modo: media y rango
 * (mín–máx) de la execution accuracy justa, la equivalencia semántica y el recall.
 * También mira la ESTABILIDAD por caso: qué preguntas aciertan siempre, cuáles
 * fallan siempre y cuáles bailan entre tiradas — el detalle que una media esconde.
 *
 * No llama a nada externo (ni BD ni LLM): solo lee los JSON y escribe el informe
 * en `docs/evaluacion/escala-tiradas.md`. Uso: npm run evaluate:aggregate
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import chalk from 'chalk'

const RUNS_DIR = join(__dirname, '../../../docs/evaluacion/tiradas')
const OUTPUT_FILE = join(__dirname, '../../../docs/evaluacion/escala-tiradas.md')

const MODE_LABELS: Record<string, string> = {
  none: 'Sin recuperación',
  vector: 'Solo vectorial',
  graphrag: 'GraphRAG',
}

/** Un caso tal y como lo guarda `evaluate:scale` en escala-casos.json. */
interface RunCase {
  id: string
  difficulty: string
  recall: number
  executionMatchFair: boolean
  executionMatchSemantic: boolean
  error?: string
}

interface RunTarget {
  name: string
  tableCount: number
  modes: Array<{ mode: string; cases: RunCase[] }>
}

/** Una tirada completa: el contenido de un escala-casos-runN.json. */
type Run = RunTarget[]

function main(): void {
  const runs = loadRuns()
  if (runs.length < 2) {
    throw new Error(`Necesito al menos 2 tiradas en ${RUNS_DIR} (hay ${runs.length}). Corre evaluate:scale y guarda cada escala-casos.json como escala-casos-runN.json.`)
  }
  console.log(chalk.bold(`\nAgregando ${runs.length} tiradas de la prueba de escala\n`))

  const lines: string[] = [
    '# Prueba de escala — media de varias tiradas',
    '',
    `Media y rango (mín–máx) sobre **${runs.length} tiradas completas** de \`npm run evaluate:scale\``,
    '(la generación no es determinista; una sola tirada baila varios puntos).',
    '',
    '| BD | Modo | Recall (media) | Exec. justa (media) | Exec. justa (rango) | Equiv. LLM (media) | Equiv. LLM (rango) |',
    '|----|------|----------------|---------------------|---------------------|--------------------|--------------------|',
  ]

  console.log(chalk.dim('  BD         Modo               Recall   Justa (rango)      Equiv (rango)'))
  for (const target of targetNames(runs)) {
    for (const mode of ['none', 'vector', 'graphrag']) {
      const perRun = runs.map((run) => summarizeRun(run, target, mode))
      const recall = mean(perRun.map((r) => r.recall))
      const fair = mean(perRun.map((r) => r.fair))
      const fairRange = `${pct(Math.min(...perRun.map((r) => r.fair)))}–${pct(Math.max(...perRun.map((r) => r.fair)))}`
      const semantic = mean(perRun.map((r) => r.semantic))
      const semanticRange = `${pct(Math.min(...perRun.map((r) => r.semantic)))}–${pct(Math.max(...perRun.map((r) => r.semantic)))}`

      lines.push(`| ${target} | ${MODE_LABELS[mode]} | ${pct(recall)} | **${pct(fair)}** | ${fairRange} | ${pct(semantic)} | ${semanticRange} |`)
      console.log(`  ${target.padEnd(10)} ${MODE_LABELS[mode].padEnd(18)} ${pct(recall).padStart(6)} ${pct(fair).padStart(6)} (${fairRange})   ${pct(semantic).padStart(6)} (${semanticRange})`)
    }
    console.log('')
  }

  lines.push('', '## Estabilidad por caso (modo GraphRAG)', '')
  for (const target of targetNames(runs)) {
    const { always, never, unstable } = caseStability(runs, target, 'graphrag')
    lines.push(
      `**${target}** — aciertan siempre: ${always.length ? always.join(', ') : '(ninguno)'} · ` +
        `fallan siempre: ${never.length ? never.join(', ') : '(ninguno)'} · ` +
        `bailan entre tiradas: ${unstable.length ? unstable.join(', ') : '(ninguno)'}`,
      '',
    )
    console.log(chalk.bold(`  ${target} (GraphRAG):`))
    console.log(chalk.green(`    aciertan siempre (${always.length}): ${always.join(', ') || '—'}`))
    console.log(chalk.red(`    fallan siempre  (${never.length}): ${never.join(', ') || '—'}`))
    console.log(chalk.yellow(`    bailan          (${unstable.length}): ${unstable.join(', ') || '—'}`))
  }

  lines.push(
    '> Los casos que "bailan" son el ruido de la no-determinación del LLM: la media es más fiable',
    '> que cualquier tirada suelta. Los que fallan SIEMPRE son los deficits reales del sistema (o de',
    '> la referencia): son los que merecen mirarse a mano. Métrica "justa" = la candidata contiene',
    '> el resultado de referencia; "equiv." = un LLM juez la da por equivalente (complementaria).',
    '',
  )
  writeFileSync(OUTPUT_FILE, lines.join('\n'))
  console.log(chalk.green(`\n✔ Informe agregado en docs/evaluacion/escala-tiradas.md\n`))
}

/** Leo todas las tiradas guardadas (escala-casos-run*.json), ordenadas por nombre. */
function loadRuns(): Run[] {
  const files = readdirSync(RUNS_DIR)
    .filter((name) => name.startsWith('escala-casos-run') && name.endsWith('.json'))
    .sort()
  return files.map((name) => JSON.parse(readFileSync(join(RUNS_DIR, name), 'utf8')) as Run)
}

/** Nombres de BD presentes en las tiradas (en el orden de la primera). */
function targetNames(runs: Run[]): string[] {
  return runs[0].map((target) => target.name)
}

/** Resumen de una tirada para una BD y un modo: fracciones de acierto y recall medio. */
function summarizeRun(run: Run, targetName: string, mode: string): { recall: number; fair: number; semantic: number } {
  const cases = run.find((t) => t.name === targetName)?.modes.find((m) => m.mode === mode)?.cases ?? []
  if (cases.length === 0) {
    return { recall: 0, fair: 0, semantic: 0 }
  }
  return {
    recall: mean(cases.map((c) => c.recall)),
    fair: mean(cases.map((c) => (c.executionMatchFair ? 1 : 0))),
    semantic: mean(cases.map((c) => (c.executionMatchSemantic ? 1 : 0))),
  }
}

/** Clasifico cada caso por su estabilidad entre tiradas (con la métrica justa). */
function caseStability(runs: Run[], targetName: string, mode: string): { always: string[]; never: string[]; unstable: string[] } {
  const hitsByCase = new Map<string, number>()
  for (const run of runs) {
    const cases = run.find((t) => t.name === targetName)?.modes.find((m) => m.mode === mode)?.cases ?? []
    for (const c of cases) {
      hitsByCase.set(c.id, (hitsByCase.get(c.id) ?? 0) + (c.executionMatchFair ? 1 : 0))
    }
  }
  const always: string[] = []
  const never: string[] = []
  const unstable: string[] = []
  for (const [id, hits] of [...hitsByCase.entries()].sort()) {
    if (hits === runs.length) {
      always.push(id)
    } else if (hits === 0) {
      never.push(id)
    } else {
      unstable.push(`${id} (${hits}/${runs.length})`)
    }
  }
  return { always, never, unstable }
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, v) => sum + v, 0) / values.length
}

function pct(fraction: number): string {
  return `${Math.round(fraction * 100)}%`
}

main()
