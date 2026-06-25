/**
 * Puerto del modelo de lenguaje.
 *
 * Defino aquí la única abstracción que conocerán los agentes para hablar con un
 * LLM. No saben si por debajo hay OpenAI, un modelo local de LM Studio o
 * cualquier otro proveedor: solo envían una conversación y reciben texto.
 * Igual que con `ITargetDatabase`, esto me permite sustituir el proveedor en
 * tests con un doble, sin tocar a los agentes (inversión de dependencias).
 */

export type ChatRole = 'system' | 'user' | 'assistant'

export interface ChatMessage {
  role: ChatRole
  content: string
}

export interface IChatModel {
  /**
   * Envío una conversación (mensajes de sistema/usuario/asistente) y devuelvo
   * el texto de la respuesta del modelo.
   */
  chat(messages: ChatMessage[]): Promise<string>
}
