/**
 * Factory del modelo LLM.
 *
 * Elijo el proveedor (ver `LlmProvider`) y creo solo ese adaptador; cada uno lee
 * su propia configuración del entorno. Así no construyo modelos que no voy a
 * usar. Los agentes piden un `IChatModel` y no saben qué hay por debajo.
 */
import type { IChatModel } from '../../domain/ports/IChatModel'
import { LlmProvider } from './LlmProvider'
import { OpenAIChatModel } from './OpenAIChatModel'
import { LocalChatModel } from './LocalChatModel'

export class ChatModelFactory {
  /** Creo el adaptador del proveedor indicado. */
  static create(provider: LlmProvider): IChatModel {
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

  /** Creo el adaptador del proveedor configurado en `LLM_PROVIDER`. */
  static fromEnv(): IChatModel {
    const provider = (process.env.LLM_PROVIDER ?? LlmProvider.OpenAI) as LlmProvider
    return ChatModelFactory.create(provider)
  }
}
