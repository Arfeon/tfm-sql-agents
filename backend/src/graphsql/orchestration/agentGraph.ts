/**
 * Grafo conversacional (SPEC-01): agente + tools con historial por hilo en memoria.
 * Hoy no se expone en el menú del CLI (D-12); se conserva como base reutilizable.
 */
import { StateGraph, MessagesAnnotation, START, MemorySaver } from '@langchain/langgraph'
import { ToolNode, toolsCondition } from '@langchain/langgraph/prebuilt'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { ChatModelFactory } from '../infrastructure/llm/ChatModelFactory'
import { LlmProvider } from '../infrastructure/llm/LlmProvider'
import { loadAgentPrompt } from '../infrastructure/config/agentPrompts'
import { demoTools } from './tools'
import { schemaTools } from './schemaTools'
import { sqlTools } from './sqlTools'

const tools = [...demoTools, ...schemaTools, ...sqlTools]

const SYSTEM_PROMPT = loadAgentPrompt('chat')

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
