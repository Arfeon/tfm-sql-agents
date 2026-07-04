/**
 * Tests unitarios del gráfico de resultados en consola (SPEC-19).
 *
 * Son funciones puras (detección + render): sin BD, sin LLM, sin terminal. Compruebo
 * qué formas de resultado son graficables (etiqueta + valor numérico, 2..30 filas),
 * que la detección tolera los numéricos que llegan como texto (así los da `pg`), y
 * que el render dibuja barras proporcionales tratando bien ceros, negativos y nulos.
 */
import { describe, it, expect } from 'vitest'
import { detectChart, renderBarChart, MAX_CHART_ROWS } from '../../src/graphsql/application/resultCharting'
import type { QueryResult } from '../../src/graphsql/domain/sql/QueryResult'

function resultOf(columns: string[], rows: Array<Record<string, unknown>>): QueryResult {
  return { columns, rows, rowCount: rows.length, truncated: false }
}

const REGIONS = resultOf(
  ['region', 'customers'],
  [
    { region: 'Europe', customers: 823 },
    { region: 'LATAM', customers: 818 },
    { region: 'Asia Pacific', customers: 809 },
  ],
)

describe('detectChart', () => {
  it('detecta la forma "categoría → valor" (etiqueta de texto + columna numérica)', () => {
    expect(detectChart(REGIONS)).toEqual({ labelColumn: 'region', valueColumn: 'customers' })
  })

  it('acepta los numéricos que llegan como texto (como los devuelve pg)', () => {
    const result = resultOf(
      ['plan', 'total'],
      [
        { plan: 'Basic', total: '1053' },
        { plan: 'Standard', total: '804.5' },
      ],
    )
    expect(detectChart(result)).toEqual({ labelColumn: 'plan', valueColumn: 'total' })
  })

  it('la etiqueta es la primera columna de texto y el valor la ÚLTIMA numérica (el agregado va al final)', () => {
    // Forma típica de una consulta generada: id, nombre, agregado. El `id` es numérico
    // pero graficarlo no tiene sentido; el agregado (la métrica) suele ir el último.
    const result = resultOf(
      ['game_id', 'title', 'total_minutes'],
      [
        { game_id: 7, title: 'A', total_minutes: 900 },
        { game_id: 3, title: 'B', total_minutes: 450 },
      ],
    )
    expect(detectChart(result)).toEqual({ labelColumn: 'title', valueColumn: 'total_minutes' })
  })

  it('no grafica una sola fila (un agregado escalar se lee mejor como número)', () => {
    expect(detectChart(resultOf(['total'], [{ total: 42 }]))).toBeNull()
  })

  it('no grafica un resultado sin columna numérica', () => {
    const result = resultOf(
      ['name', 'status'],
      [
        { name: 'A', status: 'active' },
        { name: 'B', status: 'inactive' },
      ],
    )
    expect(detectChart(result)).toBeNull()
  })

  it('no grafica un resultado sin columna de etiqueta (todo numérico)', () => {
    const result = resultOf(
      ['x', 'y'],
      [
        { x: 1, y: 2 },
        { x: 3, y: 4 },
      ],
    )
    expect(detectChart(result)).toBeNull()
  })

  it(`no grafica más de ${MAX_CHART_ROWS} filas (ilegible en terminal)`, () => {
    const rows = Array.from({ length: MAX_CHART_ROWS + 1 }, (_, i) => ({ name: `fila ${i}`, total: i }))
    expect(detectChart(resultOf(['name', 'total'], rows))).toBeNull()
  })

  it('tolera nulos sueltos en la columna de valor', () => {
    const result = resultOf(
      ['genre', 'avg_score'],
      [
        { genre: 'RPG', avg_score: 4.2 },
        { genre: 'Puzzle', avg_score: null },
      ],
    )
    expect(detectChart(result)).toEqual({ labelColumn: 'genre', valueColumn: 'avg_score' })
  })
})

describe('renderBarChart', () => {
  const plan = { labelColumn: 'region', valueColumn: 'customers' }

  it('dibuja una barra por fila, proporcional al valor, con la etiqueta y el número', () => {
    const chart = renderBarChart(REGIONS, plan)
    const lines = chart.split('\n')
    expect(lines).toHaveLength(3)
    expect(lines[0]).toContain('Europe')
    expect(lines[0]).toContain('823')
    // El máximo (823) tiene la barra más larga; 809 algo más corta pero no vacía.
    const bars = lines.map((line) => (line.match(/█+/)?.[0] ?? '').length)
    expect(bars[0]).toBeGreaterThan(0)
    expect(bars[0]).toBeGreaterThanOrEqual(bars[1])
    expect(bars[1]).toBeGreaterThanOrEqual(bars[2])
    expect(bars[2]).toBeGreaterThan(0)
  })

  it('alinea las etiquetas a la anchura de la más larga', () => {
    const chart = renderBarChart(REGIONS, plan)
    const lines = chart.split('\n')
    // Todas las barras empiezan en la misma columna.
    const barStarts = lines.map((line) => line.indexOf('█'))
    expect(new Set(barStarts).size).toBe(1)
  })

  it('un valor cero o negativo se muestra con su número y sin barra (un 0 es información)', () => {
    const result = resultOf(
      ['region', 'revenue'],
      [
        { region: 'Europe', revenue: 100 },
        { region: 'Oceania', revenue: 0 },
        { region: 'Testland', revenue: -5 },
      ],
    )
    const lines = renderBarChart(result, { labelColumn: 'region', valueColumn: 'revenue' }).split('\n')
    expect(lines[1]).toContain('0')
    expect(lines[1]).not.toContain('█')
    expect(lines[2]).toContain('-5')
    expect(lines[2]).not.toContain('█')
  })

  it('un valor nulo se marca con ∅ y sin barra', () => {
    const result = resultOf(
      ['genre', 'avg'],
      [
        { genre: 'RPG', avg: 4.2 },
        { genre: 'Puzzle', avg: null },
      ],
    )
    const lines = renderBarChart(result, { labelColumn: 'genre', valueColumn: 'avg' }).split('\n')
    expect(lines[1]).toContain('∅')
    expect(lines[1]).not.toContain('█')
  })

  it('los numéricos que llegan como texto se grafican igual', () => {
    const result = resultOf(
      ['plan', 'total'],
      [
        { plan: 'Basic', total: '1053' },
        { plan: 'Standard', total: '526.5' },
      ],
    )
    const lines = renderBarChart(result, { labelColumn: 'plan', valueColumn: 'total' }).split('\n')
    const bars = lines.map((line) => (line.match(/█+/)?.[0] ?? '').length)
    // 526.5 es la mitad de 1053: su barra mide ~la mitad.
    expect(bars[1]).toBeGreaterThan(0)
    expect(bars[1]).toBeLessThan(bars[0])
    expect(Math.abs(bars[1] - bars[0] / 2)).toBeLessThanOrEqual(1)
  })
})
