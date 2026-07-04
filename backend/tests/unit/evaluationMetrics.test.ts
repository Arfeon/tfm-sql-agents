/**
 * Tests unitarios de las métricas de evaluación (SPEC-11).
 *
 * Son funciones puras: schema-linking recall, comparación de resultados de ejecución
 * (multiconjunto, sin importar orden de filas ni nombre/orden de columnas) y la
 * estimación rústica de tokens. No tocan BD ni LLM.
 */
import { describe, it, expect } from 'vitest'
import { schemaLinkingRecall, resultsMatch, resultsContain, estimateTokens } from '../../src/graphsql/application/evaluationMetrics'

describe('schemaLinkingRecall', () => {
  it('recupera todas las tablas gold → 1', () => {
    expect(schemaLinkingRecall(['customer', 'region'], ['region', 'customer', 'game'])).toBe(1)
  })
  it('recupera la mitad → 0.5', () => {
    expect(schemaLinkingRecall(['customer', 'region'], ['customer', 'game'])).toBe(0.5)
  })
  it('no recupera ninguna → 0', () => {
    expect(schemaLinkingRecall(['customer', 'region'], ['game'])).toBe(0)
  })
  it('sin tablas gold → 1 por convención (no hay nada que recuperar)', () => {
    expect(schemaLinkingRecall([], ['game'])).toBe(1)
  })
})

describe('resultsMatch', () => {
  const rowsA = [{ region: 'Norte', customers: 10 }, { region: 'Sur', customers: 5 }]

  it('resultados idénticos coinciden', () => {
    expect(resultsMatch(rowsA, [{ region: 'Norte', customers: 10 }, { region: 'Sur', customers: 5 }])).toBe(true)
  })
  it('mismas filas en distinto orden coinciden (multiconjunto)', () => {
    expect(resultsMatch(rowsA, [{ region: 'Sur', customers: 5 }, { region: 'Norte', customers: 10 }])).toBe(true)
  })
  it('mismos valores con nombres de columna distintos coinciden (execution accuracy lenient)', () => {
    const candidate = [{ r: 'Norte', n: 10 }, { r: 'Sur', n: 5 }]
    expect(resultsMatch(rowsA, candidate)).toBe(true)
  })
  it('un valor numérico como texto o como número es equivalente', () => {
    expect(resultsMatch([{ total: 320 }], [{ total: '320' }])).toBe(true)
  })
  it('valores distintos no coinciden', () => {
    expect(resultsMatch(rowsA, [{ region: 'Norte', customers: 10 }, { region: 'Sur', customers: 6 }])).toBe(false)
  })
  it('distinto número de filas no coincide', () => {
    expect(resultsMatch(rowsA, [{ region: 'Norte', customers: 10 }])).toBe(false)
  })
  it('dos resultados vacíos coinciden', () => {
    expect(resultsMatch([], [])).toBe(true)
  })
})

describe('resultsContain (execution accuracy justa: referencia ⊆ candidata)', () => {
  const reference = [{ region: 'Norte', customers: 10 }, { region: 'Sur', customers: 5 }]

  it('resultados idénticos: contiene', () => {
    expect(resultsContain(reference, [{ region: 'Norte', customers: 10 }, { region: 'Sur', customers: 5 }])).toBe(true)
  })
  it('la candidata trae una columna de más (id) pero los mismos valores: contiene', () => {
    const candidate = [{ region_id: 1, region: 'Norte', customers: 10 }, { region_id: 2, region: 'Sur', customers: 5 }]
    expect(resultsContain(reference, candidate)).toBe(true)
  })
  it('mismas filas en distinto orden: contiene', () => {
    const candidate = [{ id: 2, region: 'Sur', customers: 5 }, { id: 1, region: 'Norte', customers: 10 }]
    expect(resultsContain(reference, candidate)).toBe(true)
  })
  it('la candidata devuelve otras filas (mismo recuento por empate): NO contiene', () => {
    const candidate = [{ region: 'Este', customers: 10 }, { region: 'Oeste', customers: 5 }]
    expect(resultsContain(reference, candidate)).toBe(false)
  })
  it('a la candidata le falta un valor de referencia: NO contiene', () => {
    const candidate = [{ region: 'Norte' }, { region: 'Sur' }]
    expect(resultsContain(reference, candidate)).toBe(false)
  })
  it('distinto número de filas: NO contiene', () => {
    expect(resultsContain(reference, [{ region: 'Norte', customers: 10 }])).toBe(false)
  })
})

describe('estimateTokens', () => {
  it('cadena vacía → 0 tokens', () => {
    expect(estimateTokens('')).toBe(0)
  })
  it('crece con la longitud del texto', () => {
    expect(estimateTokens('CREATE TABLE game (...)')).toBeGreaterThan(estimateTokens('game'))
  })
})
