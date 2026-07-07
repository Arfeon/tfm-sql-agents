/**
 * Adaptador de `IChatModel` para un modelo local de LM Studio: mismo `ChatOpenAI`
 * (API OpenAI-compatible) con la `baseURL` local. La `apiKey` es de relleno (no se valida).
 */
import { ChatOpenAI } from '@langchain/openai'
import { AIMessage, HumanMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages'
import type { ChatMessage, IChatModel } from '../../domain/ports/IChatModel'

export class LocalChatModel implements IChatModel {
  private readonly client: ChatOpenAI

  constructor(baseUrl: string, apiKey: string, model: string, temperature?: number) {
    // Pocos reintentos para fallar rápido si LM Studio no está levantado,
    // en vez de esperar el backoff largo por defecto de LangChain.
    this.client = new ChatOpenAI({ apiKey, model, temperature, maxRetries: 1, configuration: { baseURL: baseUrl } })
  }

  static fromEnv(): LocalChatModel {
    const baseUrl = process.env.LMSTUDIO_BASE_URL ?? 'http://localhost:1234/v1'
    const apiKey = process.env.LMSTUDIO_API_KEY ?? 'lm-studio'
    const model = process.env.LMSTUDIO_MODEL ?? 'local-model'
    const temperature = process.env.LLM_TEMPERATURE ? Number(process.env.LLM_TEMPERATURE) : undefined
    return new LocalChatModel(baseUrl, apiKey, model, temperature)
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
