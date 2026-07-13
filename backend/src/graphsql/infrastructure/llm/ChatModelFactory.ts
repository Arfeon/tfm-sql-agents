/**
 * Factory del modelo LLM: construye solo el adaptador del proveedor elegido,
 * y cada adaptador lee su propia configuración del entorno.
 */
import type { ChatOpenAI } from '@langchain/openai'
import type { IChatModel } from '../../domain/ports/IChatModel'
import { loadEnv } from '../config/env'
import { LlmProvider } from './LlmProvider'
import type { LlmRole } from './modelSelection'
import { OpenAIChatModel } from './OpenAIChatModel'
import { LocalChatModel } from './LocalChatModel'

export class ChatModelFactory {
  static create(provider: LlmProvider, role?: LlmRole): IChatModel {
    return ChatModelFactory.buildAdapter(provider, role)
  }

  /** El proveedor sale de `LLM_PROVIDER`; el rol elige entre el modelo de razonamiento o el de generación. */
  static fromEnv(role?: LlmRole): IChatModel {
    const provider = (loadEnv().LLM_PROVIDER ?? LlmProvider.OpenAI) as LlmProvider
    return ChatModelFactory.create(provider, role)
  }

  /** Para los grafos/agentes que necesitan tool-calling: el puerto `IChatModel` solo da texto. */
  static createLangChainModel(provider: LlmProvider, role?: LlmRole): ChatOpenAI {
    return ChatModelFactory.buildAdapter(provider, role).langChainModel
  }

  private static buildAdapter(provider: LlmProvider, role?: LlmRole): OpenAIChatModel | LocalChatModel {
    switch (provider) {
      case LlmProvider.OpenAI:
        return OpenAIChatModel.fromEnv(role)
      case LlmProvider.Local:
        return LocalChatModel.fromEnv(role)
      default:
        throw new Error(
          `Proveedor LLM no soportado: "${provider}". Valores válidos: ${Object.values(LlmProvider).join(', ')}.`,
        )
    }
  }
}
