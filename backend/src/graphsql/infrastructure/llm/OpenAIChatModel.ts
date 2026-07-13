/**
 * Adaptador de `IChatModel` para la API de OpenAI, sobre `ChatOpenAI` de LangChain.
 * Si `temperature` es `undefined` no se envía (la familia gpt-5 solo acepta el valor por defecto).
 */
import { ChatOpenAI } from '@langchain/openai'
import { AIMessage, HumanMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages'
import type { ChatMessage, IChatModel } from '../../domain/ports/IChatModel'
import { loadEnv } from '../config/env'
import { LlmProvider } from './LlmProvider'
import { resolveModelName, type LlmRole } from './modelSelection'

export class OpenAIChatModel implements IChatModel {
  private readonly client: ChatOpenAI

  constructor(apiKey: string, model: string, temperature?: number) {
    // Pocos reintentos para fallar rápido si el proveedor no responde,
    // en vez de esperar el backoff largo por defecto de LangChain.
    this.client = new ChatOpenAI({ apiKey, model, temperature, maxRetries: 1 })
  }

  static fromEnv(role?: LlmRole): OpenAIChatModel {
    const vars = loadEnv()
    const model = resolveModelName(LlmProvider.OpenAI, role)
    return new OpenAIChatModel(vars.OPENAI_API_KEY, model, vars.LLM_TEMPERATURE)
  }

  async chat(messages: ChatMessage[]): Promise<string> {
    const response = await this.client.invoke(this.toLangChainMessages(messages))
    return response.text
  }

  /** Expongo el modelo LangChain para los grafos/agentes que necesitan tool-calling. */
  get langChainModel(): ChatOpenAI {
    return this.client
  }

  private toLangChainMessages(messages: ChatMessage[]): BaseMessage[] {
    return messages.map((message) => {
      if (message.role === 'system') return new SystemMessage(message.content)
      if (message.role === 'user') return new HumanMessage(message.content)
      return new AIMessage(message.content)
    })
  }
}
