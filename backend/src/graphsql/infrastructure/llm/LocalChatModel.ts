/**
 * Adaptador del puerto `IChatModel` para un modelo local servido por LM Studio.
 *
 * LM Studio expone una API compatible con OpenAI, así que reutilizo el mismo
 * `ChatOpenAI` apuntando su `baseURL` al servidor local. La `apiKey` es un valor
 * de relleno (LM Studio no la valida). Lo mantengo como clase separada de
 * `OpenAIChatModel` para que el factory deje explícito el patrón.
 */
import { ChatOpenAI } from '@langchain/openai'
import { AIMessage, HumanMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages'
import type { ChatMessage, IChatModel } from '../../domain/ports/IChatModel'

export class LocalChatModel implements IChatModel {
  private readonly client: ChatOpenAI

  constructor(baseUrl: string, apiKey: string, model: string, temperature?: number) {
    this.client = new ChatOpenAI({ apiKey, model, temperature, configuration: { baseURL: baseUrl } })
  }

  /** Creo el adaptador leyendo la configuración de LM Studio del entorno. */
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

  private toLangChainMessages(messages: ChatMessage[]): BaseMessage[] {
    return messages.map((message) => {
      if (message.role === 'system') return new SystemMessage(message.content)
      if (message.role === 'user') return new HumanMessage(message.content)
      return new AIMessage(message.content)
    })
  }
}
