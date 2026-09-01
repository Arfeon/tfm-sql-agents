/**
 * Adaptador de `IChatModel` para un gateway LLM corporativo (LiteLLM y compatibles):
 * el mismo `ChatOpenAI` que uso con OpenAI, pero apuntando a la `baseURL` interna y con
 * la clave que emite el propio gateway. El modelo es el *alias* publicado por el gateway,
 * no el nombre del modelo de debajo, así que quién lo sirve —OpenAI o un modelo propio—
 * es una decisión suya, no mía.
 */
import { ChatOpenAI } from '@langchain/openai'
import { AIMessage, HumanMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages'
import type { ChatMessage, IChatModel } from '../../domain/ports/IChatModel'
import { loadEnv } from '../config/env'
import { LlmProvider } from './LlmProvider'
import { resolveModelName, type LlmRole } from './modelSelection'

export class GatewayChatModel implements IChatModel {
  private readonly client: ChatOpenAI

  constructor(baseUrl: string, apiKey: string, model: string, temperature?: number) {
    // Pocos reintentos para fallar rápido si el gateway no responde,
    // en vez de esperar el backoff largo por defecto de LangChain.
    this.client = new ChatOpenAI({ apiKey, model, temperature, maxRetries: 1, configuration: { baseURL: baseUrl } })
  }

  static fromEnv(role?: LlmRole): GatewayChatModel {
    const vars = loadEnv()
    const model = resolveModelName(LlmProvider.Gateway, role)
    return new GatewayChatModel(vars.GATEWAY_BASE_URL, vars.GATEWAY_API_KEY, model, vars.LLM_TEMPERATURE)
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
