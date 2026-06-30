/**
 * Tests de la comprobación de seguridad del Judge (SPEC-06): la validación pura.
 *
 * Como no depende de nada externo, la pruebo a fondo con una tabla de casos: uno
 * por palabra peligrosa, uno por patrón de inyección, y consultas legítimas que
 * deben pasar. Sin dobles ni red.
 */
import { describe, it, expect } from 'vitest'
import { checkSqlSafety, DANGEROUS_KEYWORDS } from '../../src/graphsql/domain/sql/SqlSafetyPolicy'

describe('checkSqlSafety — allowlist de solo lectura', () => {
  it('acepta un SELECT simple', () => {
    expect(checkSqlSafety('SELECT 1').valid).toBe(true)
  })

  it('acepta un SELECT con JOINs y un CTE (WITH)', () => {
    const sql = `WITH ventas AS (
      SELECT region_id, SUM(total) AS total FROM "order" GROUP BY region_id
    )
    SELECT c.name, v.total
    FROM customer c
    JOIN ventas v ON v.region_id = c.region_id
    ORDER BY v.total DESC`
    expect(checkSqlSafety(sql).valid).toBe(true)
  })

  it('acepta un SELECT con un único ";" final', () => {
    expect(checkSqlSafety('SELECT 1;').valid).toBe(true)
  })

  it('rechaza una sentencia vacía', () => {
    const verdict = checkSqlSafety('   ')
    expect(verdict.valid).toBe(false)
    expect(verdict.errors.length).toBeGreaterThan(0)
  })

  it.each([
    ['no empieza por SELECT/WITH', 'EXPLAIN SELECT 1'],
    ['empieza por una palabra de escritura', 'UPDATE customer SET name = 1'],
  ])('rechaza cuando %s', (_caso, sql) => {
    expect(checkSqlSafety(sql).valid).toBe(false)
  })

  it('no confunde palabras peligrosas dentro de identificadores (last_update, created_at)', () => {
    const sql = 'SELECT created_at, last_update FROM customer'
    expect(checkSqlSafety(sql).valid).toBe(true)
  })
})

describe('checkSqlSafety — palabras peligrosas (una por keyword)', () => {
  it.each(DANGEROUS_KEYWORDS.map((keyword) => [keyword]))('rechaza una consulta que contiene %s', (keyword) => {
    // La envuelvo en algo que empieza por WITH para aislar el motivo "palabra peligrosa"
    // de "no empieza por SELECT/WITH".
    const verdict = checkSqlSafety(`WITH x AS (SELECT 1) ${keyword} algo`)
    expect(verdict.valid).toBe(false)
    expect(verdict.errors.some((error) => error.includes(keyword))).toBe(true)
  })
})

describe('checkSqlSafety — patrones de inyección', () => {
  it.each([
    ['varias sentencias con ";"', 'SELECT 1; SELECT 2'],
    ['comentario de línea "--"', 'SELECT 1 -- comentario'],
    ['comentario de bloque "/* */"', 'SELECT 1 /* comentario */'],
  ])('rechaza %s', (_caso, sql) => {
    expect(checkSqlSafety(sql).valid).toBe(false)
  })
})
