/**
 * Primer grafo de LangGraph (SPEC-01).
 *
 * Monta un grafo mínimo para validar la orquestación: un nodo de agente (modelo
 * + tools) y un nodo de tools, con un edge condicional que enruta a la tool
 * cuando el modelo la pide y vuelve al agente. El checkpointer en memoria guarda
 * el historial por hilo, así puedo mantener una conversación con estado.
 */
import { StateGraph, MessagesAnnotation, START, MemorySaver } from '@langchain/langgraph'
import { ToolNode, toolsCondition } from '@langchain/langgraph/prebuilt'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { ChatModelFactory } from '../infrastructure/llm/ChatModelFactory'
import { LlmProvider } from '../infrastructure/llm/LlmProvider'
import { demoTools } from './tools'
import { schemaTools } from './schemaTools'
import { sqlTools } from './sqlTools'

const tools = [...demoTools, ...schemaTools, ...sqlTools]

const SYSTEM_PROMPT =
  'Eres GraphSQL Agent, un asistente experto en SQL. Responde de forma clara, en el idioma del usuario. ' +
  'NO conoces el esquema de la base de datos de memoria y NUNCA te inventes nombres de tablas ni de columnas. ' +
  'Si el usuario pregunta qué tablas usar o dónde está cierta información, usa la herramienta de schema-linking. ' +
  'Si el usuario pide la consulta SQL (o cómo obtener ciertos datos), usa la herramienta de generar SQL, que ya recupera las tablas por su cuenta. ' +
  'Esa herramienta ya devuelve el resultado formateado en dos secciones (la consulta SQL y la evaluación del Judge): muéstralo SIEMPRE al usuario TAL CUAL, sin reescribirlo, resumirlo ni mezclarlo con comentarios propios. La evaluación es del Judge, no tuya: no la omitas ni inventes una. ' +
  'Después de usar una herramienta, responde siempre al usuario con su resultado en texto claro; no dejes la respuesta vacía. ' +
  'Para comprobar el estado del sistema o escanear/ingerir el esquema, usa también las herramientas disponibles.'

/** Construyo y compilo el grafo de conversación para el proveedor elegido. */
export function createConversationGraph(provider: LlmProvider) {
  const model = ChatModelFactory.createLangChainModel(provider).bindTools(tools)

  async function callAgent(state: typeof MessagesAnnotation.State) {
    // Antepongo el prompt de sistema sin guardarlo en el estado, para que esté
    // siempre presente pero no se acumule turno a turno.
    const response = await model.invoke([new SystemMessage(SYSTEM_PROMPT), ...state.messages])
    return { messages: [response] }
  }

  return new StateGraph(MessagesAnnotation)
    .addNode('agent', callAgent)
    .addNode('tools', new ToolNode(tools))
    .addEdge(START, 'agent')
    .addConditionalEdges('agent', toolsCondition)
    .addEdge('tools', 'agent')
    .compile({ checkpointer: new MemorySaver() })
}

export type ConversationGraph = ReturnType<typeof createConversationGraph>

/** Envío un mensaje al grafo dentro de un hilo y devuelvo el texto de la respuesta. */
export async function askGraph(graph: ConversationGraph, threadId: string, message: string): Promise<string> {
  const result = await graph.invoke(
    { messages: [new HumanMessage(message)] },
    { configurable: { thread_id: threadId } },
  )
  const lastMessage = result.messages[result.messages.length - 1]
  return lastMessage.text
}
