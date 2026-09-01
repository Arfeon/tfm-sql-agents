/**
 * Resolución del modelo por proveedor y rol: dos modelos (razonamiento / generación) con
 * caída al modelo base cuando el rol no tiene variable propia ("pueden ser el mismo").
 */
import { describe, it, expect } from 'vitest'
import { resolveModelName } from '../../src/graphsql/infrastructure/llm/modelSelection'
import { LlmProvider } from '../../src/graphsql/infrastructure/llm/LlmProvider'

describe('resolveModelName', () => {
  it('usa la variable del rol cuando está puesta (local: 9b razona, 14b escribe SQL)', () => {
    const env = { LMSTUDIO_MODEL: 'qwen2.5-coder-14b', LMSTUDIO_MODEL_REASONING: 'qwen2.5-9b' } as NodeJS.ProcessEnv
    expect(resolveModelName(LlmProvider.Local, 'reasoning', env)).toBe('qwen2.5-9b')
    // generación no tiene variable propia → cae al base (el 14b).
    expect(resolveModelName(LlmProvider.Local, 'generation', env)).toBe('qwen2.5-coder-14b')
  })

  it('cae al modelo base cuando el rol no tiene variable ("pueden ser el mismo")', () => {
    const env = { OPENAI_MODEL: 'gpt-5-mini' } as NodeJS.ProcessEnv
    expect(resolveModelName(LlmProvider.OpenAI, 'reasoning', env)).toBe('gpt-5-mini')
    expect(resolveModelName(LlmProvider.OpenAI, 'generation', env)).toBe('gpt-5-mini')
    expect(resolveModelName(LlmProvider.OpenAI, undefined, env)).toBe('gpt-5-mini')
  })

  it('permite dos modelos remotos distintos por rol', () => {
    const env = { OPENAI_MODEL_REASONING: 'gpt-5', OPENAI_MODEL_GENERATION: 'gpt-4o-mini' } as NodeJS.ProcessEnv
    expect(resolveModelName(LlmProvider.OpenAI, 'reasoning', env)).toBe('gpt-5')
    expect(resolveModelName(LlmProvider.OpenAI, 'generation', env)).toBe('gpt-4o-mini')
  })

  it('tiene valores por defecto por proveedor si no hay nada configurado', () => {
    const env = {} as NodeJS.ProcessEnv
    expect(resolveModelName(LlmProvider.Local, 'reasoning', env)).toBe('local-model')
    expect(resolveModelName(LlmProvider.OpenAI, 'generation', env)).toBe('gpt-4o-mini')
    expect(resolveModelName(LlmProvider.Gateway, 'generation', env)).toBe('gateway-model')
  })

  it('el gateway tiene sus propias variables, sin mezclarse con las de local', () => {
    const env = {
      GATEWAY_MODEL: 'qwen2.5-coder-32b',
      GATEWAY_MODEL_REASONING: 'gpt-5',
      LMSTUDIO_MODEL: 'qwen2.5-coder-14b',
    } as NodeJS.ProcessEnv
    expect(resolveModelName(LlmProvider.Gateway, 'reasoning', env)).toBe('gpt-5')
    expect(resolveModelName(LlmProvider.Gateway, 'generation', env)).toBe('qwen2.5-coder-32b')
    expect(resolveModelName(LlmProvider.Local, 'generation', env)).toBe('qwen2.5-coder-14b')
  })
})
