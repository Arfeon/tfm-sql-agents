/**
 * Factory del modelo LLM: construye solo el adaptador del proveedor elegido,
 * y cada adaptador lee su propia configuración del entorno.
 */
import type { ChatOpenAI } from '@langchain/openai'
import type { IChatModel } from '../../domain/ports/IChatModel'
import { LlmProvider } from './LlmProvider'
import { OpenAIChatModel } from './OpenAIChatModel'
import { LocalChatModel } from './LocalChatModel'

export class ChatModelFactory {
  static create(provider: LlmProvider): IChatModel {
    return ChatModelFactory.buildAdapter(provider)
  }

  static fromEnv(): IChatModel {
    const provider = (process.env.LLM_PROVIDER ?? LlmProvider.OpenAI) as LlmProvider
    return ChatModelFactory.create(provider)
  }

  /** Para los grafos/agentes que necesitan tool-calling: el puerto `IChatModel` solo da texto. */
  static createLangChainModel(provider: LlmProvider): ChatOpenAI {
    return ChatModelFactory.buildAdapter(provider).langChainModel
  }

  private static buildAdapter(provider: LlmProvider): OpenAIChatModel | LocalChatModel {
    switch (provider) {
      case LlmProvider.OpenAI:
        return OpenAIChatModel.fromEnv()
      case LlmProvider.Local:
        return LocalChatModel.fromEnv()
      default:
        throw new Error(
          `Proveedor LLM no soportado: "${provider}". Valores válidos: ${Object.values(LlmProvider).join(', ')}.`,
        )
    }
  }
}
