/**
 * Ranking léxico y fusión RRF (schema linking híbrido). El caso que motiva todo esto:
 * "abonado" debe casar con la tabla `abonats` aunque su vector la entierre.
 */
import { describe, it, expect } from 'vitest'
import { tokenize, trigramSimilarity, rankLexically, fuseByReciprocalRank } from '../../src/graphsql/application/retrieval/hybridRanking'

describe('tokenize', () => {
  it('minúsculas, sin acentos, sin palabras vacías ni ruido estructural, sin repes', () => {
    const tokens = tokenize('Dime qué abonado tiene más líneas de fib_troncals')
    // fuera: dime, que, tiene, mas, de (vacías o <3); dentro: los sustantivos.
    expect(tokens).toContain('abonado')
    expect(tokens).toContain('lineas')
    expect(tokens).toContain('fib')
    expect(tokens).toContain('troncals')
    expect(tokens).not.toContain('dime')
    expect(tokens).not.toContain('tiene')
  })

  it('descarta el ruido estructural del search_text (tabla, columnas)', () => {
    expect(tokenize('Tabla: abonats. Columnas: id, codi')).toEqual(['abonats', 'codi'])
  })
})

describe('trigramSimilarity', () => {
  it('idénticas = 1, y "abonat"~"abonats" alto pese a no ser iguales', () => {
    expect(trigramSimilarity('abonats', 'abonats')).toBe(1)
    expect(trigramSimilarity('abonat', 'abonats')).toBeGreaterThan(0.5)
    expect(trigramSimilarity('abonat', 'factures')).toBeLessThan(0.2)
  })
})

describe('rankLexically', () => {
  it('pone la tabla de abonados arriba cuando la pregunta dice "abonado"', () => {
    const tables = [
      { tableName: 'abonats', searchText: 'Tabla: abonats. Columnas: id, codi, rao_social' },
      { tableName: 'm_fib_marques', searchText: 'Tabla: m_fib_marques. Columnas: id, nom' },
      { tableName: 'factures', searchText: 'Tabla: factures. Columnas: id, import' },
    ]
    const ranked = rankLexically('qué abonado tiene más facturas', tables)

    // abonats (por "abonado") y factures (por "facturas") casan; el maestro de marcas no.
    expect(ranked.map((r) => r.tableName)).toContain('abonats')
    expect(ranked.find((r) => r.tableName === 'abonats')!.score).toBeGreaterThan(0)
    expect(ranked.find((r) => r.tableName === 'm_fib_marques')).toBeUndefined()
  })
})

describe('fuseByReciprocalRank', () => {
  it('sube una tabla fuerte en léxico aunque el denso la tenga hundida', () => {
    // Denso: abonats al fondo (como en el índice real, puesto 179). Léxico: abonats arriba.
    const dense = [
      { tableName: 'fib_lin_a', score: 0.64 },
      { tableName: 'fib_lin_b', score: 0.63 },
      { tableName: 'abonats', score: 0.52 },
    ]
    const lexical = [
      { tableName: 'abonats', score: 2.0 },
      { tableName: 'fib_lin_a', score: 0.9 },
    ]

    const fused = fuseByReciprocalRank([dense, lexical])

    // abonats: hundida en denso (pos 3) pero 1ª en léxico → adelanta a fib_lin_b (solo denso).
    const names = fused.map((f) => f.tableName)
    expect(names.indexOf('abonats')).toBeLessThan(names.indexOf('fib_lin_b'))
  })
})
