/**
 * Test de integración del modelo LLM real (smoke test).
 *
 * Dispara una pregunta de verdad contra el proveedor configurado en `.env`
 * (OpenAI o LM Studio) para validar que la conexión funciona de punta a punta.
 *
 * Es opt-in: solo lo corre `npm run test:integration` y se salta si faltan las
 * credenciales del proveedor activo. Así `npm test` queda siempre verde, offline
 * y sin gastar API.
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
