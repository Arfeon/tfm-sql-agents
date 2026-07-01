/**
 * Tests del Judge (SPEC-06): la revisión del juez LLM y la combinación de comprobaciones.
 *
 * La comprobación de seguridad (pura) se prueba en sqlSafetyPolicy.test.ts y la de
 * sintaxis en sqlSyntaxCheck.test.ts. Aquí doblo el `IChatModel` y la comprobación
 * de sintaxis y compruebo que: el juez devuelve un veredicto rico, una respuesta
 * ilegible se trata como error de dominio, y `judgeSql` combina bien las
 * comprobaciones (bloquean la de seguridad y la de sintaxis; el juez LLM no bloquea
 * por sí solo; el umbral de confianza se aplica; un fallo del LLM no rompe el flujo).
 */
import { describe, it, expect } from 'vitest'
import {
  parseJudgeVerdict,
  judgeSqlWithLlm,
  judgeSql,
  type SqlJudgingDependencies,
} from '../../src/graphsql/application/sqlJudging'
import { JudgeResponseError } from '../../src/graphsql/domain/sql/JudgeResponseError'
import type { IChatModel } from '../../src/graphsql/domain/ports/IChatModel'
import type { SchemaContext } from '../../src/graphsql/domain/schema/SchemaContext'
import type { SqlStatement } from '../../src/graphsql/domain/sql/SqlStatement'

const CONTEXT: SchemaContext = {
  tables: [],
  tableNames: ['customer'],
  ddl: 'CREATE TABLE customer (\n  customer_id integer NOT NULL\n);',
}
const SAFE_SQL: SqlStatement = { text: 'SELECT customer_id FROM customer', dialect: 'PostgreSQL' }

interface FakeOptions {
  reply?: string
  syntaxValid?: boolean
  syntaxError?: string
  onChat?: () => void
  onSyntax?: () => void
}

/** Doble de dependencias: chat y comprobación de sintaxis configurables y espiables. */
function fakeDeps(options: FakeOptions = {}): SqlJudgingDependencies {
  const model: IChatModel = {
    chat: async () => {
      options.onChat?.()
      return options.reply ?? '{"valid": true}'
    },
  }
  return {
    createChatModel: () => model,
    checkSyntax: async () => {
      options.onSyntax?.()
      return { valid: options.syntaxValid ?? true, error: options.syntaxError }
    },
  }
}

describe('parseJudgeVerdict', () => {
  it('interpreta un veredicto válido con su confianza', () => {
    const verdict = parseJudgeVerdict('{"valid": true, "confidence": 0.9, "errors": []}')
    expect(verdict.valid).toBe(true)
    expect(verdict.confidence).toBe(0.9)
    expect(verdict.errors).toEqual([])
  })

  it('interpreta un veredicto inválido con sus motivos', () => {
    const verdict = parseJudgeVerdict('{"valid": false, "errors": ["columna inexistente"]}')
    expect(verdict.valid).toBe(false)
    expect(verdict.errors).toContain('columna inexistente')
  })

  it('recoge avisos, sugerencias, tablas verificadas y explicación', () => {
    const verdict = parseJudgeVerdict(
      '{"valid": true, "warnings": ["falta LIMIT"], "suggestions": ["añade índice"], "tables_verified": ["customer"], "explanation": "ok"}',
    )
    expect(verdict.warnings).toContain('falta LIMIT')
    expect(verdict.suggestions).toContain('añade índice')
    expect(verdict.tablesVerified).toContain('customer')
    expect(verdict.explanation).toBe('ok')
  })

  it('extrae el JSON aunque venga rodeado de texto', () => {
    expect(parseJudgeVerdict('Claro:\n{"valid": true}\n¡listo!').valid).toBe(true)
  })

  it('da un motivo por defecto si es inválido sin detallar', () => {
    const verdict = parseJudgeVerdict('{"valid": false}')
    expect(verdict.valid).toBe(false)
    expect(verdict.errors.length).toBeGreaterThan(0)
  })

  it.each([
    ['mayor que 1', '{"valid": true, "confidence": 1.5}', 1],
    ['menor que 0', '{"valid": true, "confidence": -0.2}', 0],
  ])('acota la confianza %s al rango [0,1]', (_caso, reply, expected) => {
    expect(parseJudgeVerdict(reply).confidence).toBe(expected)
  })

  it('deja la confianza ausente si no es un número', () => {
    expect(parseJudgeVerdict('{"valid": true, "confidence": "alta"}').confidence).toBeUndefined()
  })

  it.each([['texto sin JSON', 'no lo sé'], ['JSON sin el campo valid', '{"foo": 1}'], ['JSON roto', '{"valid": tru']])(
    'lanza JudgeResponseError ante %s',
    (_caso, reply) => {
      expect(() => parseJudgeVerdict(reply)).toThrow(JudgeResponseError)
    },
  )
})

describe('judgeSqlWithLlm (revisión del juez LLM)', () => {
  it('devuelve el veredicto del juez con su confianza', async () => {
    const verdict = await judgeSqlWithLlm(SAFE_SQL, CONTEXT, 'pregunta', fakeDeps({ reply: '{"valid": true, "confidence": 0.8}' }))
    expect(verdict.valid).toBe(true)
    expect(verdict.confidence).toBe(0.8)
  })

  it('propaga JudgeResponseError si la respuesta no es interpretable', async () => {
    await expect(judgeSqlWithLlm(SAFE_SQL, CONTEXT, 'pregunta', fakeDeps({ reply: 'ni idea' }))).rejects.toThrow(
      JudgeResponseError,
    )
  })
})

describe('judgeSql (combinación de capas)', () => {
  it('si la comprobación de seguridad rechaza, devuelve inválido y NO consulta ni a la BD ni al LLM', async () => {
    let llmCalled = false
    let syntaxCalled = false
    const unsafe: SqlStatement = { text: 'DROP TABLE customer', dialect: 'PostgreSQL' }
    const verdict = await judgeSql(unsafe, CONTEXT, 'pregunta', { useDbCheck: true, useLlmJudge: true }, fakeDeps({
      onChat: () => { llmCalled = true },
      onSyntax: () => { syntaxCalled = true },
    }))
    expect(verdict.valid).toBe(false)
    expect(llmCalled).toBe(false)
    expect(syntaxCalled).toBe(false)
  })

  it('sin comprobaciones opcionales, solo aplica la de seguridad (no consulta al LLM)', async () => {
    let llmCalled = false
    const verdict = await judgeSql(SAFE_SQL, CONTEXT, 'pregunta', {}, fakeDeps({ reply: '{"valid": false}', onChat: () => { llmCalled = true } }))
    expect(verdict.valid).toBe(true)
    expect(llmCalled).toBe(false)
  })

  it('si la BD rechaza la sintaxis, devuelve inválido y NO consulta al LLM', async () => {
    let llmCalled = false
    const verdict = await judgeSql(SAFE_SQL, CONTEXT, 'pregunta', { useDbCheck: true, useLlmJudge: true }, fakeDeps({
      syntaxValid: false,
      syntaxError: 'column "foo" does not exist',
      onChat: () => { llmCalled = true },
    }))
    expect(verdict.valid).toBe(false)
    expect(verdict.errors.join(' ')).toContain('foo')
    expect(llmCalled).toBe(false)
  })

  it('el juez LLM NO bloquea por sí solo: sus errores pasan a avisos y la consulta sigue válida', async () => {
    const verdict = await judgeSql(
      SAFE_SQL,
      CONTEXT,
      'pregunta',
      { useDbCheck: true, useLlmJudge: true },
      fakeDeps({ syntaxValid: true, reply: '{"valid": false, "errors": ["no se puede usar game.game_id con USING"]}' }),
    )
    expect(verdict.valid).toBe(true)
    expect(verdict.errors).toEqual([])
    expect(verdict.warnings.some((warning) => warning.includes('USING'))).toBe(true)
  })

  it('marca inválido si la confianza queda por debajo del mínimo exigido (palanca del operador)', async () => {
    const verdict = await judgeSql(
      SAFE_SQL,
      CONTEXT,
      'pregunta',
      { useLlmJudge: true, minConfidence: 0.7 },
      fakeDeps({ reply: '{"valid": true, "confidence": 0.4}' }),
    )
    expect(verdict.valid).toBe(false)
    expect(verdict.errors.some((error) => error.includes('Confianza'))).toBe(true)
  })

  it('si el LLM responde algo ilegible, no rompe: se queda con las comprobaciones deterministas', async () => {
    const verdict = await judgeSql(SAFE_SQL, CONTEXT, 'pregunta', { useLlmJudge: true }, fakeDeps({ reply: '???' }))
    expect(verdict.valid).toBe(true)
    expect(verdict.warnings.length).toBeGreaterThan(0)
  })

  it('lleva el propósito de las tablas del veredicto del juez hasta el resultado (SPEC-14)', async () => {
    const verdict = await judgeSql(
      SAFE_SQL,
      CONTEXT,
      'pregunta',
      { useLlmJudge: true },
      fakeDeps({ reply: '{"valid": true, "table_purposes": [{"table": "t_042", "purpose": "wishlist", "source": "assumed"}]}' }),
    )
    expect(verdict.tablePurposes?.[0]).toEqual({ table: 't_042', purpose: 'wishlist', source: 'assumed' })
    expect(verdict.warnings.some((warning) => warning.includes('t_042') && warning.includes('SUPOSICIÓN'))).toBe(true)
  })
})

describe('parseJudgeVerdict — propósito de las tablas (SPEC-14)', () => {
  it('una tabla documentada da su propósito sin generar aviso de suposición', () => {
    const verdict = parseJudgeVerdict(
      '{"valid": true, "table_purposes": [{"table": "t_042", "purpose": "lista de deseos", "source": "description"}]}',
    )
    expect(verdict.tablePurposes).toEqual([{ table: 't_042', purpose: 'lista de deseos', source: 'description' }])
    expect(verdict.warnings.some((warning) => warning.includes('SUPOSICIÓN'))).toBe(false)
  })

  it('una tabla de nombre opaco sin descripción (assumed) genera un aviso de suposición', () => {
    const verdict = parseJudgeVerdict(
      '{"valid": true, "table_purposes": [{"table": "t_042", "purpose": "wishlist", "source": "assumed"}]}',
    )
    expect(verdict.tablePurposes?.[0].source).toBe('assumed')
    expect(verdict.warnings.some((warning) => warning.includes('t_042') && warning.includes('SUPOSICIÓN'))).toBe(true)
  })

  it('una tabla de nombre/columnas evidentes no genera aviso', () => {
    const verdict = parseJudgeVerdict(
      '{"valid": true, "table_purposes": [{"table": "customer", "purpose": "clientes", "source": "name"}]}',
    )
    expect(verdict.warnings.some((warning) => warning.includes('SUPOSICIÓN'))).toBe(false)
  })

  it('una fuente desconocida se trata como suposición (conservador)', () => {
    const verdict = parseJudgeVerdict(
      '{"valid": true, "table_purposes": [{"table": "x", "purpose": "y", "source": "inventada"}]}',
    )
    expect(verdict.tablePurposes?.[0].source).toBe('assumed')
  })
})
