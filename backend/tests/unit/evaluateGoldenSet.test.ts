/**
 * Tests unitarios de la evaluación (SPEC-11).
 *
 * Doblo recuperar/generar/ejecutar y compruebo la orquestación: recall calculado
 * sobre el contexto, execution accuracy comparando resultados, una SQL insegura que
 * no se ejecuta, un fallo de ejecución que no rompe la evaluación, y los agregados.
 */
import { describe, it, expect, vi } from 'vitest'
import { evaluateGoldenSet, makeEvaluationDependencies, type EvaluationDependencies } from '../../src/graphsql/application/evaluation/evaluateGoldenSet'
import type { GoldenCase } from '../../src/graphsql/application/evaluation/goldenSet'
import type { SchemaContext } from '../../src/graphsql/domain/schema/SchemaContext'
import { TargetDatabaseFactory } from '../../src/graphsql/infrastructure/targetdb/TargetDatabaseFactory'
import type { TargetDatabaseConfig } from '../../src/graphsql/infrastructure/config/targetDatabases'

function contextFor(tableNames: string[]): SchemaContext {
  return { tables: tableNames.map((name) => ({ name, schema: null, columns: [], primaryKeys: [], foreignKeys: [] })), tableNames, ddl: tableNames.join(', ') }
}

const CASES: GoldenCase[] = [
  { id: 'G-01', question: '¿cuántos juegos?', difficulty: 'easy', tables: ['game'], sql: 'SELECT COUNT(*) FROM game' },
  { id: 'G-04', question: 'clientes por región', difficulty: 'medium', tables: ['customer', 'region'], sql: 'SELECT r.name, COUNT(*) FROM customer c JOIN region r USING (region_id) GROUP BY r.name' },
]

describe('evaluateGoldenSet', () => {
  it('calcula recall, tamaño de contexto y execution accuracy cuando el resultado coincide', async () => {
    const deps: EvaluationDependencies = {
      retrieve: async (_question, _mode) => contextFor(['game', 'customer', 'region']),
      generate: async (_question, _context, dialect) => ({ text: 'SELECT ...', dialect }),
      // La referencia y la candidata devuelven lo mismo → execution match.
      runQuery: async () => [{ total: 42 }],
      judgeEquivalence: async () => ({ equivalent: true, reason: 'misma consulta' }),
    }

    const report = await evaluateGoldenSet(CASES, 'graphrag', 'PostgreSQL', deps)

    expect(report.mode).toBe('graphrag')
    // G-01 (game) y G-04 (customer, region) están todas en el contexto → recall 1 en ambos.
    expect(report.summary.meanRecall).toBe(1)
    expect(report.summary.executionAccuracyStrict).toBe(1)
    expect(report.summary.executionAccuracyFair).toBe(1)
    expect(report.summary.executionAccuracySemantic).toBe(1)
    expect(report.cases[0].contextTableCount).toBe(3)
    expect(report.cases.every((c) => c.safe)).toBe(true)
  })

  it('cuenta como acierto semántico lo que el juez LLM da por equivalente aunque el resultado difiera', async () => {
    const deps: EvaluationDependencies = {
      retrieve: async () => contextFor(['game']),
      generate: async (_q, _c, dialect) => ({ text: 'SELECT title FROM game ORDER BY title LIMIT 5', dialect }),
      // Resultados distintos (empate en el top-5) → ni estricta ni justa…
      runQuery: async (sqlText) => (sqlText.includes('LIMIT') ? [{ title: 'A' }] : [{ title: 'B' }]),
      // …pero el juez las da por equivalentes: cuenta como acierto semántico.
      judgeEquivalence: async () => ({ equivalent: true, reason: 'mismo top-5 con desempate arbitrario' }),
    }

    const report = await evaluateGoldenSet([CASES[0]], 'graphrag', 'PostgreSQL', deps)

    expect(report.cases[0].executionMatchStrict).toBe(false)
    expect(report.cases[0].executionMatchFair).toBe(false)
    expect(report.cases[0].executionMatchSemantic).toBe(true)
    expect(report.cases[0].equivalenceReason).toMatch(/desempate/)
  })

  it('el juez no puede DESCARTAR lo que la métrica objetiva ya da por bueno (solo rescata)', async () => {
    // Regresión: el juez LLM a veces alucina una divergencia inexistente. Si la ejecución
    // dice que el resultado contiene la referencia (fair=true), el caso pasa la equivalencia
    // aunque el juez diga que no. Así la escala es monótona: justa ⊆ equivalente.
    const deps: EvaluationDependencies = {
      retrieve: async () => contextFor(['game']),
      generate: async (_q, _c, dialect) => ({ text: 'SELECT game_id, title FROM game', dialect }),
      // Referencia y candidata dan exactamente lo mismo (misma fila) → fair=true.
      runQuery: async () => [{ title: 'A' }],
      // El juez se equivoca y la marca como NO equivalente.
      judgeEquivalence: async () => ({ equivalent: false, reason: 'alucina una diferencia que no existe' }),
    }

    const report = await evaluateGoldenSet([CASES[0]], 'graphrag', 'PostgreSQL', deps)

    expect(report.cases[0].executionMatchFair).toBe(true)
    expect(report.cases[0].executionMatchSemantic).toBe(false) // veredicto crudo del juez, se conserva
    expect(report.summary.executionAccuracyFair).toBe(1)
    expect(report.summary.executionAccuracySemantic).toBe(1) // pero la métrica no baja de la justa
  })

  it('una candidata correcta con una columna de más cuenta como acierto justo pero no estricto', async () => {
    const deps: EvaluationDependencies = {
      retrieve: async () => contextFor(['game']),
      generate: async (_q, _c, dialect) => ({ text: 'SELECT game_id, title FROM game', dialect }),
      // La referencia devuelve solo el título; la candidata añade el id: correcta pero más rica.
      runQuery: async (sqlText) =>
        sqlText.includes('game_id') ? [{ game_id: 1, title: 'A' }, { game_id: 2, title: 'B' }] : [{ title: 'A' }, { title: 'B' }],
      judgeEquivalence: async () => ({ equivalent: true, reason: 'la candidata solo añade el id' }),
    }

    const report = await evaluateGoldenSet([CASES[0]], 'graphrag', 'PostgreSQL', deps)

    expect(report.cases[0].executionMatchStrict).toBe(false)
    expect(report.cases[0].executionMatchFair).toBe(true)
  })

  it('recall parcial cuando la recuperación no trae todas las tablas gold', async () => {
    const deps: EvaluationDependencies = {
      retrieve: async () => contextFor(['customer']), // falta 'region' y 'game'
      generate: async (_q, _c, dialect) => ({ text: 'SELECT 1', dialect }),
      runQuery: async () => [],
      judgeEquivalence: async () => ({ equivalent: true, reason: '' }),
    }

    const report = await evaluateGoldenSet(CASES, 'vector', 'PostgreSQL', deps)

    // G-01 pide [game] → 0; G-04 pide [customer, region] → 0.5. Media = 0.25.
    expect(report.cases[0].schemaLinkingRecall).toBe(0)
    expect(report.cases[1].schemaLinkingRecall).toBe(0.5)
    expect(report.summary.meanRecall).toBeCloseTo(0.25)
  })

  it('una SQL insegura no se ejecuta ni se juzga su equivalencia y cuenta como fallo', async () => {
    let runQueryCalls = 0
    let judgeCalls = 0
    const deps: EvaluationDependencies = {
      retrieve: async () => contextFor(['game']),
      generate: async (_q, _c, dialect) => ({ text: 'DROP TABLE game', dialect }),
      runQuery: async () => {
        runQueryCalls++
        return []
      },
      judgeEquivalence: async () => {
        judgeCalls++
        return { equivalent: true, reason: '' }
      },
    }

    const report = await evaluateGoldenSet([CASES[0]], 'graphrag', 'PostgreSQL', deps)

    expect(report.cases[0].safe).toBe(false)
    expect(report.cases[0].executionMatchFair).toBe(false)
    expect(report.cases[0].executionMatchSemantic).toBe(false)
    expect(report.cases[0].error).toMatch(/seguridad/)
    expect(runQueryCalls).toBe(0) // no se ejecutó nada contra la BD
    expect(judgeCalls).toBe(0) // ni se molestó al juez de equivalencia
  })

  it('un error de ejecución no rompe la evaluación (queda registrado)', async () => {
    const deps: EvaluationDependencies = {
      retrieve: async () => contextFor(['game']),
      generate: async (_q, _c, dialect) => ({ text: 'SELECT foo FROM game', dialect }),
      runQuery: async () => {
        throw new Error('column "foo" does not exist')
      },
      judgeEquivalence: async () => ({ equivalent: true, reason: '' }),
    }

    const report = await evaluateGoldenSet([CASES[0]], 'graphrag', 'PostgreSQL', deps)

    expect(report.cases[0].executionMatchFair).toBe(false)
    expect(report.cases[0].error).toMatch(/foo/)
  })

  it('ejecuta las consultas contra la BD objetivo dada, no contra la de por defecto', async () => {
    // Regresión: al evaluar Nebula, runQuery conectaba a Arcadia (connectDefault) y las
    // consultas a tablas propias de Nebula fallaban con "relation does not exist". La
    // dependencia real debe conectar al `target` que se está evaluando.
    const nebula: TargetDatabaseConfig = {
      type: 'postgresql', name: 'nebula', host: 'h', port: 5432, user: 'u', password: 'p', schema: 'public',
    }
    const spy = vi.spyOn(TargetDatabaseFactory, 'connect').mockRejectedValue(new Error('conexión interceptada'))
    try {
      const deps = makeEvaluationDependencies(nebula)
      await expect(deps.runQuery('SELECT 1')).rejects.toThrow('conexión interceptada')
      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ name: 'nebula' }), expect.anything())
    } finally {
      spy.mockRestore()
    }
  })

  it('agrega por dificultad', async () => {
    const deps: EvaluationDependencies = {
      retrieve: async () => contextFor(['game', 'customer', 'region']),
      generate: async (_q, _c, dialect) => ({ text: 'SELECT 1', dialect }),
      runQuery: async () => [{ x: 1 }],
      judgeEquivalence: async () => ({ equivalent: true, reason: '' }),
    }

    const report = await evaluateGoldenSet(CASES, 'graphrag', 'PostgreSQL', deps)

    expect(report.byDifficulty.easy.count).toBe(1)
    expect(report.byDifficulty.medium.count).toBe(1)
    expect(report.byDifficulty.hard.count).toBe(0)
  })
})
