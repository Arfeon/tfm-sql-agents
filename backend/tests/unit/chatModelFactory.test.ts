/**
 * Tests unitarios del factory de modelos LLM.
 *
 * No tocan red: solo compruebo que el factory crea el adaptador correcto según
 * el proveedor y que un proveedor desconocido falla con un error claro.
 */
import { describe, it, expect } from 'vitest'
import { ChatModelFactory } from '../../src/graphsql/infrastructure/llm/ChatModelFactory'
import { LlmProvider } from '../../src/graphsql/infrastructure/llm/LlmProvider'
import { OpenAIChatModel } from '../../src/graphsql/infrastructure/llm/OpenAIChatModel'
import { LocalChatModel } from '../../src/graphsql/infrastructure/llm/LocalChatModel'

describe('ChatModelFactory', () => {
  it('create_providerOpenai_devuelveAdaptadorOpenAI', () => {
    expect(ChatModelFactory.create(LlmProvider.OpenAI)).toBeInstanceOf(OpenAIChatModel)
  })

  it('create_providerLocal_devuelveAdaptadorLocal', () => {
    expect(ChatModelFactory.create(LlmProvider.Local)).toBeInstanceOf(LocalChatModel)
  })

  it('create_providerDesconocido_lanzaError', () => {
    expect(() => ChatModelFactory.create('gemini' as LlmProvider)).toThrow(/no soportado/)
  })

  it('fromEnv_llmProviderLocal_creaAdaptadorLocal', () => {
    const original = process.env.LLM_PROVIDER
    process.env.LLM_PROVIDER = LlmProvider.Local
    try {
      expect(ChatModelFactory.fromEnv()).toBeInstanceOf(LocalChatModel)
    } finally {
      process.env.LLM_PROVIDER = original
    }
  })
})
