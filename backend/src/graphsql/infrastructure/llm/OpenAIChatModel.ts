/**
 * Adaptador del puerto `IChatModel` para la API de OpenAI.
 *
 * Envuelve `ChatOpenAI` de LangChain, que es el cliente que reutilizaré al
 * orquestar con LangGraph. Si `temperature` es `undefined`, no se envía y el
 * modelo usa su valor por defecto (la familia gpt-5 solo acepta ese).
 */
import { ChatOpenAI } from '@langchain/openai'
import { AIMessage, HumanMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages'
import type { ChatMessage, IChatModel } from '../../domain/ports/IChatModel'

export class OpenAIChatModel implements IChatModel {
  private readonly client: ChatOpenAI

  constructor(apiKey: string, model: string, temperature?: number) {
    this.client = new ChatOpenAI({ apiKey, model, temperature })
  }

  /** Creo el adaptador leyendo la configuración de OpenAI del entorno. */
  static fromEnv(): OpenAIChatModel {
    const apiKey = process.env.OPENAI_API_KEY ?? ''
    const model = process.env.OPENAI_MODEL ?? 'gpt-4o-mini'
    const temperature = process.env.LLM_TEMPERATURE ? Number(process.env.LLM_TEMPERATURE) : undefined
    return new OpenAIChatModel(apiKey, model, temperature)
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
