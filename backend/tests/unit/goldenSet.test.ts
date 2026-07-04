/**
 * Tests unitarios del cargador del golden set (SPEC-11).
 *
 * Pruebo el parseo/validación sobre YAML en memoria (sin leer el fichero real).
 */
import { describe, it, expect } from 'vitest'
import { parse } from 'yaml'
import { parseGoldenCases } from '../../src/graphsql/application/goldenSet'

const YAML_OK = `
- id: G-01
  question: "¿Cuántos juegos hay?"
  difficulty: easy
  tables: [game]
  sql: |
    SELECT COUNT(*) FROM game;
- id: G-25
  question: "¿Qué clientes tienen más juegos en su lista de deseos?"
  difficulty: medium
  tables: [t_042, customer]
  sql: |
    SELECT c.username FROM t_042 w JOIN customer c ON c.customer_id = w.customer_id;
`

describe('parseGoldenCases', () => {
  it('carga los casos con sus tablas gold y su SQL de referencia', () => {
    const cases = parseGoldenCases(parse(YAML_OK))
    expect(cases).toHaveLength(2)
    expect(cases[0]).toMatchObject({ id: 'G-01', difficulty: 'easy', tables: ['game'] })
    expect(cases[0].sql).toContain('SELECT COUNT(*) FROM game')
    expect(cases[1].tables).toEqual(['t_042', 'customer'])
  })

  it('una dificultad desconocida se trata como hard', () => {
    const cases = parseGoldenCases(parse('- id: G-99\n  question: "x"\n  difficulty: imposible\n  tables: [game]\n  sql: "SELECT 1"'))
    expect(cases[0].difficulty).toBe('hard')
  })

  it('lanza si el YAML no es una lista', () => {
    expect(() => parseGoldenCases({ nope: true })).toThrow(/lista de casos/)
  })

  it('lanza si a un caso le faltan campos', () => {
    expect(() => parseGoldenCases(parse('- id: G-01\n  question: "x"'))).toThrow(/incompleto/)
  })
})
