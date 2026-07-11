/**
 * Tests de los helpers puros de la selección de proveedor (la parte no interactiva).
 * El `select` de @inquirer no se prueba aquí; sí la resolución del defecto y el nombre
 * del modelo, que son lo que decide qué ve y qué se fija por defecto.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { resolveDefaultProvider, modelNameFor, providerLabel } from '../../src/cli/startup/providerSelection'
import { LlmProvider } from '../../src/graphsql/infrastructure/llm/LlmProvider'

const savedEnv = { ...process.env }
// Limpio también las variables de rol: si el .env local define un modelo de razonamiento
// aparte, `modelNameFor` mostraría "razonamiento X · SQL Y" y el test dependería de mi máquina.
beforeEach(() => {
  delete process.env.OPENAI_MODEL_REASONING
  delete process.env.OPENAI_MODEL_GENERATION
  delete process.env.LMSTUDIO_MODEL_REASONING
  delete process.env.LMSTUDIO_MODEL_GENERATION
})
afterEach(() => {
  process.env = { ...savedEnv }
})

describe('resolveDefaultProvider', () => {
  it('usa el valor del .env cuando es válido', () => {
    expect(resolveDefaultProvider('local')).toBe(LlmProvider.Local)
    expect(resolveDefaultProvider('openai')).toBe(LlmProvider.OpenAI)
  })
  it('cae en OpenAI si el valor falta o es inválido', () => {
    expect(resolveDefaultProvider(undefined)).toBe(LlmProvider.OpenAI)
    expect(resolveDefaultProvider('gemini')).toBe(LlmProvider.OpenAI)
  })
})

describe('modelNameFor', () => {
  it('lee el modelo de cada proveedor de su variable de entorno', () => {
    process.env.OPENAI_MODEL = 'gpt-5-mini'
    process.env.LMSTUDIO_MODEL = 'qwen2.5-coder-14b-instruct'
    expect(modelNameFor(LlmProvider.OpenAI)).toBe('gpt-5-mini')
    expect(modelNameFor(LlmProvider.Local)).toBe('qwen2.5-coder-14b-instruct')
  })
  it('tiene un valor por defecto si la variable no está', () => {
    delete process.env.OPENAI_MODEL
    delete process.env.LMSTUDIO_MODEL
    expect(modelNameFor(LlmProvider.OpenAI)).toBe('gpt-4o-mini')
    expect(modelNameFor(LlmProvider.Local)).toBe('local-model')
  })
})

describe('providerLabel', () => {
  it('da una etiqueta legible por proveedor', () => {
    expect(providerLabel(LlmProvider.Local)).toMatch(/Local/)
    expect(providerLabel(LlmProvider.OpenAI)).toMatch(/OpenAI/)
  })
})
