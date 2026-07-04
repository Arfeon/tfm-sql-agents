/**
 * Gráfico de resultados en consola (SPEC-19), como funciones puras.
 *
 * La detección de si un resultado es graficable NO es cosa del LLM: la forma del
 * resultado ya lo dice (una columna de etiqueta + una numérica, pocas filas), y una
 * función pura es gratis, instantánea y testeable — el mismo criterio que el Judge:
 * determinista donde se puede, LLM solo donde hace falta.
 *
 * El render devuelve texto plano (sin ANSI): el color es cosa de la capa CLI.
 */
import type { QueryResult } from '../domain/sql/QueryResult'

/** Qué columnas usar para el gráfico de barras: la etiqueta y el valor. */
export interface BarChartPlan {
  labelColumn: string
  valueColumn: string
}

/** Máximo de filas graficables: por encima, la tabla se lee mejor que las barras. */
export const MAX_CHART_ROWS = 30

/** Anchura máxima de la barra más larga, en caracteres. */
const MAX_BAR_WIDTH = 40

/**
 * ¿Este resultado tiene forma de "categoría → valor"? Si sí, devuelvo el plan del
 * gráfico; si no, null (y el CLI muestra la tabla directamente).
 *
 * Reglas: entre 2 y MAX_CHART_ROWS filas; la etiqueta es la PRIMERA columna no
 * numérica; el valor, la ÚLTIMA columna numérica (en una consulta generada el
 * agregado suele ir al final: `id, nombre, total` — graficar el `id` no tiene sentido).
 */
export function detectChart(result: QueryResult): BarChartPlan | null {
  if (result.rows.length < 2 || result.rows.length > MAX_CHART_ROWS) {
    return null
  }
  const labelColumn = result.columns.find((column) => !isNumericColumn(result.rows, column))
  const valueColumn = result.columns.filter((column) => isNumericColumn(result.rows, column)).at(-1)
  if (!labelColumn || !valueColumn) {
    return null
  }
  return { labelColumn, valueColumn }
}

/**
 * Dibujo el gráfico de barras horizontales: etiquetas alineadas, barras de bloques
 * proporcionales al valor (la mayor ocupa MAX_BAR_WIDTH) y el número al final.
 * Un valor cero, negativo o nulo se muestra sin barra pero CON su número (un 0 es
 * información, no una fila a esconder — misma lógica que D-13).
 */
export function renderBarChart(result: QueryResult, plan: BarChartPlan): string {
  const labels = result.rows.map((row) => formatLabel(row[plan.labelColumn]))
  const values = result.rows.map((row) => toNumber(row[plan.valueColumn]))
  const labelWidth = Math.max(...labels.map((label) => label.length))
  const maxValue = Math.max(...values.filter((value): value is number => value !== null && value > 0), 0)

  return result.rows
    .map((_, i) => {
      const label = labels[i].padEnd(labelWidth)
      const value = values[i]
      if (value === null) {
        return `${label}  ∅`
      }
      const bar = barFor(value, maxValue)
      return bar === '' ? `${label}  ${formatValue(value)}` : `${label}  ${bar} ${formatValue(value)}`
    })
    .join('\n')
}

/** La barra proporcional de un valor; vacía si no es positivo o no hay máximo. */
function barFor(value: number, maxValue: number): string {
  if (value <= 0 || maxValue <= 0) {
    return ''
  }
  // Al menos un bloque para cualquier valor positivo, que no desaparezca del gráfico.
  const width = Math.max(1, Math.round((value / maxValue) * MAX_BAR_WIDTH))
  return '█'.repeat(width)
}

/** ¿Todos los valores no nulos de la columna son numéricos? (pg devuelve numéricos como texto.) */
function isNumericColumn(rows: Array<Record<string, unknown>>, column: string): boolean {
  const values = rows.map((row) => row[column]).filter((value) => value !== null && value !== undefined)
  if (values.length === 0) {
    return false
  }
  return values.every((value) => toNumber(value) !== null)
}

/** El valor como número, o null si no lo es (o es nulo). */
function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null
  }
  if (typeof value === 'number') {
    return Number.isNaN(value) ? null : value
  }
  const asText = String(value).trim()
  if (asText === '') {
    return null
  }
  const asNumber = Number(asText)
  return Number.isNaN(asNumber) ? null : asNumber
}

/** La etiqueta como texto; un nulo se marca como ∅. */
function formatLabel(value: unknown): string {
  return value === null || value === undefined ? '∅' : String(value)
}

/** El valor numérico legible: entero tal cual, decimal con dos cifras. */
function formatValue(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}
