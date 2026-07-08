/**
 * Tests unitarios del juez de equivalencia semántica (SPEC-11, D-11).
 *
 * Doblo el `IChatModel` para no tocar red: compruebo que interpreto bien el veredicto,
 * que una respuesta ilegible cae a "no equivalente" (conservador, no infla aciertos) y
 * que le paso al modelo la pregunta y las dos consultas.
 */
import { describe, it, expect } from 'vitest'
import {
  judgeQueryEquivalence,
  parseEquivalenceVerdict,
  formatResultForJudge,
  type SqlEquivalenceDependencies,
} from '../../src/graphsql/application/sqlEquivalence'
import type { ChatMessage } from '../../src/graphsql/domain/ports/IChatModel'

function modelReturning(reply: string, capture?: (messages: ChatMessage[]) => void): SqlEquivalenceDependencies {
  return {
    createChatModel: () => ({
      chat: async (messages: ChatMessage[]) => {
        capture?.(messages)
        return reply
      },
    }),
  }
}

describe('parseEquivalenceVerdict', () => {
  it('interpreta un veredicto de equivalencia con su motivo', () => {
    const verdict = parseEquivalenceVerdict('{"equivalent": true, "reason": "misma agregación, solo cambia el orden"}')
    expect(verdict.equivalent).toBe(true)
    expect(verdict.reason).toMatch(/orden/)
  })

  it('interpreta un veredicto negativo', () => {
    const verdict = parseEquivalenceVerdict('Analizando… {"equivalent": false, "reason": "filtra por otra columna"}')
    expect(verdict.equivalent).toBe(false)
    expect(verdict.reason).toMatch(/otra columna/)
  })

  it('trata una respuesta ilegible como NO equivalente (conservador)', () => {
    expect(parseEquivalenceVerdict('no tengo ni idea').equivalent).toBe(false)
    expect(parseEquivalenceVerdict('{"equivalent": "quizás"}').equivalent).toBe(false)
    expect(parseEquivalenceVerdict('{ roto').equivalent).toBe(false)
  })
})

describe('judgeQueryEquivalence', () => {
  it('devuelve el veredicto del modelo', async () => {
    const verdict = await judgeQueryEquivalence(
      '¿cuántos juegos?',
      'SELECT COUNT(*) FROM game',
      'SELECT COUNT(*) AS total FROM game',
      'PostgreSQL',
      undefined,
      modelReturning('{"equivalent": true, "reason": "misma cuenta"}'),
    )
    expect(verdict.equivalent).toBe(true)
  })

  it('le pasa al modelo la pregunta y ambas consultas', async () => {
    let seen: ChatMessage[] = []
    await judgeQueryEquivalence(
      'clientes por región',
      'SELECT r.name, COUNT(*) FROM customer c JOIN region r USING (region_id) GROUP BY r.name',
      'SELECT region_id, COUNT(*) FROM customer GROUP BY region_id',
      'PostgreSQL',
      undefined,
      modelReturning('{"equivalent": false, "reason": "una agrupa por nombre y la otra por id"}', (m) => (seen = m)),
    )
    const userContent = seen.find((m) => m.role === 'user')?.content ?? ''
    expect(userContent).toMatch(/clientes por región/)
    expect(userContent).toMatch(/REFERENCIA/)
    expect(userContent).toMatch(/CANDIDATA/)
    expect(userContent).toMatch(/region_id/)
  })

  it('le pasa al modelo los resultados ejecutados cuando se los doy', async () => {
    let seen: ChatMessage[] = []
    await judgeQueryEquivalence(
      '¿cuántos juegos?',
      'SELECT COUNT(*) FROM game',
      'SELECT COUNT(*) AS total FROM game',
      'PostgreSQL',
      { reference: [{ count: 42 }], candidate: [{ total: 42 }] },
      modelReturning('{"equivalent": true, "reason": "mismo resultado"}', (m) => (seen = m)),
    )
    const userContent = seen.find((m) => m.role === 'user')?.content ?? ''
    expect(userContent).toMatch(/Resultado ejecutado de la REFERENCIA/)
    expect(userContent).toMatch(/Resultado ejecutado de la CANDIDATA/)
    expect(userContent).toMatch(/42/)
  })
})

describe('formatResultForJudge', () => {
  it('muestra el conteo total y recorta a las filas de muestra', () => {
    const rows = Array.from({ length: 25 }, (_, i) => ({ id: i }))
    const formatted = formatResultForJudge('CANDIDATA', rows)
    expect(formatted).toMatch(/primeras 20 de 25 filas/)
    expect(formatted).not.toMatch(/"id":24/)
  })

  it('con pocas filas indica el total sin recortar', () => {
    const formatted = formatResultForJudge('REFERENCIA', [{ id: 1 }])
    expect(formatted).toMatch(/1 filas in total|1 filas en total/)
    expect(formatted).toMatch(/"id":1/)
  })
})
