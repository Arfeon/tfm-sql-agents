/**
 * Puerto del modelo de lenguaje: los agentes envían una conversación y reciben
 * texto, sin saber qué proveedor hay por debajo.
 */

export type ChatRole = 'system' | 'user' | 'assistant'

export interface ChatMessage {
  role: ChatRole
  content: string
}

export interface IChatModel {
  chat(messages: ChatMessage[]): Promise<string>
}
