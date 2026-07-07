/**
 * Smoke test del LLM real. Opt-in (test:integration); se salta si faltan las
 * credenciales, así `npm test` queda siempre offline y verde.
 */
import { describe, it, expect } from 'vitest'
import { ChatModelFactory } from '../../src/graphsql/infrastructure/llm/ChatModelFactory'
import { LlmProvider } from '../../src/graphsql/infrastructure/llm/LlmProvider'

const provider = (process.env.LLM_PROVIDER ?? LlmProvider.OpenAI) as LlmProvider
const hasCredentials =
  provider === LlmProvider.OpenAI ? Boolean(process.env.OPENAI_API_KEY) : Boolean(process.env.LMSTUDIO_BASE_URL)

describe.skipIf(!hasCredentials)(`IChatModel (integración, provider=${provider})`, () => {
  it(
    'chat_saludoSimple_respondeTexto',
    async () => {
      const model = ChatModelFactory.fromEnv()
      const reply = await model.chat([
        { role: 'system', content: 'Eres mi agente de SQL. Responde de forma breve y en español.' },
        { role: 'user', content: 'Hola, dime hola.' },
      ])

      // Muestro la respuesta real del LLM por consola para poder verla al ejecutar el test.
      console.log(`\n🤖 Respuesta del LLM (${provider}):\n${reply}\n`)

      expect(reply.length).toBeGreaterThan(0)
      expect(reply.toLowerCase()).toContain('hola')
    },
    30_000,
  )
})
