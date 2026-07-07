/**
 * Gráfico de resultados en consola (SPEC-19), como funciones puras. La detección de
 * si un resultado es graficable es determinista, no cosa del LLM (mismo criterio que
 * el Judge). El render devuelve texto plano sin ANSI: el color es de la capa CLI.
 */
import type { QueryResult } from '../domain/sql/QueryResult'

export interface BarChartPlan {
  labelColumn: string
  valueColumn: string
}

/** Por encima de esto, la tabla se lee mejor que las barras. */
export const MAX_CHART_ROWS = 30

const MAX_BAR_WIDTH = 40

/**
 * `null` si el resultado no tiene forma de "categoría → valor". El valor es la ÚLTIMA
 * columna numérica: en una consulta generada el agregado suele ir al final
 * (`id, nombre, total`) y graficar el `id` no tiene sentido.
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
 * Un valor cero, negativo o nulo se muestra sin barra pero CON su número: un 0 es
 * información, no una fila a esconder (misma lógica que D-13).
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

function barFor(value: number, maxValue: number): string {
  if (value <= 0 || maxValue <= 0) {
    return ''
  }
  // Al menos un bloque para cualquier valor positivo, que no desaparezca del gráfico.
  const width = Math.max(1, Math.round((value / maxValue) * MAX_BAR_WIDTH))
  return '█'.repeat(width)
}

/** pg devuelve los numéricos como texto, de ahí el toNumber. */
function isNumericColumn(rows: Array<Record<string, unknown>>, column: string): boolean {
  const values = rows.map((row) => row[column]).filter((value) => value !== null && value !== undefined)
  if (values.length === 0) {
    return false
  }
  return values.every((value) => toNumber(value) !== null)
}

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

function formatLabel(value: unknown): string {
  return value === null || value === undefined ? '∅' : String(value)
}

function formatValue(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}
