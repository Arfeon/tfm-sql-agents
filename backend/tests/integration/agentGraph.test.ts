/**
 * Test de integración del primer grafo LangGraph (SPEC-01).
 *
 * Invoca el grafo con una pregunta que debería disparar la tool de estado y
 * comprueba que la conversación completa y responde. Es opt-in (solo
 * `npm run test:integration`) y se salta si faltan las credenciales del
 * proveedor activo, igual que el smoke test del modelo.
 */
import { describe, it, expect } from 'vitest'
import { createConversationGraph, askGraph } from '../../src/graphsql/graph/agentGraph'
import { LlmProvider } from '../../src/graphsql/infrastructure/llm/LlmProvider'

const provider = (process.env.LLM_PROVIDER ?? LlmProvider.OpenAI) as LlmProvider
const hasCredentials =
  provider === LlmProvider.OpenAI ? Boolean(process.env.OPENAI_API_KEY) : Boolean(process.env.LMSTUDIO_BASE_URL)

describe.skipIf(!hasCredentials)(`agentGraph (integración, provider=${provider})`, () => {
  it(
    'askGraph_preguntaEstado_completaYResponde',
    async () => {
      const graph = createConversationGraph(provider)
      const reply = await askGraph(
        graph,
        'test-thread',
        'Usa tus herramientas para comprobar si el sistema está operativo.',
      )

      // Muestro la respuesta para ver que el grafo completó la acción.
      console.log(`\n🤖 Respuesta del grafo (${provider}):\n${reply}\n`)

      expect(reply.length).toBeGreaterThan(0)
    },
    30_000,
  )
})
