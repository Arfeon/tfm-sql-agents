/**
 * Selección del proveedor LLM al arrancar el CLI. Antes el proveedor solo salía de
 * LLM_PROVIDER en el .env, así que era fácil arrancar sin saber con qué modelo estabas
 * trabajando (y por defecto caía en OpenAI en silencio). Ahora lo elijo explícitamente
 * al inicio: el .env es el valor por DEFECTO, no una decisión oculta, y muestro el modelo
 * concreto de cada opción. Fijo `process.env.LLM_PROVIDER` de la sesión, que es de donde
 * `ChatModelFactory.fromEnv()` lo lee en cada llamada, así que la elección se propaga sin
 * tener que hilarla por todos los casos de uso.
 */
import chalk from 'chalk'
import { select } from '@inquirer/prompts'
import { LlmProvider } from '../graphsql/infrastructure/llm/LlmProvider'

/** El modelo concreto que usaría cada proveedor, para enseñarlo antes de elegir. */
export function modelNameFor(provider: LlmProvider): string {
  if (provider === LlmProvider.Local) {
    return process.env.LMSTUDIO_MODEL ?? 'local-model'
  }
  return process.env.OPENAI_MODEL ?? 'gpt-4o-mini'
}

/** Etiqueta legible del proveedor para los mensajes. */
export function providerLabel(provider: LlmProvider): string {
  return provider === LlmProvider.Local ? 'Local (LM Studio)' : 'OpenAI (nube)'
}

/** El proveedor por defecto sale del .env; si trae un valor inválido, caigo en OpenAI. */
export function resolveDefaultProvider(envValue: string | undefined): LlmProvider {
  const candidate = envValue as LlmProvider
  return Object.values(LlmProvider).includes(candidate) ? candidate : LlmProvider.OpenAI
}

/**
 * Pregunto el proveedor al arrancar y fijo el de la sesión. Devuelvo la elección por si
 * quien llama quiere mostrarla o usarla; el efecto real es `process.env.LLM_PROVIDER`.
 */
export async function selectLlmProvider(): Promise<LlmProvider> {
  const provider = await select({
    message: '¿Con qué proveedor de LLM quieres trabajar en esta sesión?',
    default: resolveDefaultProvider(process.env.LLM_PROVIDER),
    choices: [
      { name: `OpenAI (nube) — ${modelNameFor(LlmProvider.OpenAI)}`, value: LlmProvider.OpenAI },
      { name: `Local / LM Studio — ${modelNameFor(LlmProvider.Local)}`, value: LlmProvider.Local },
    ],
  })

  process.env.LLM_PROVIDER = provider
  console.log(chalk.green(`✔ Proveedor de esta sesión: ${providerLabel(provider)} · modelo ${modelNameFor(provider)}\n`))
  return provider
}
