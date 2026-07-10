/**
 * Nombre de modelo por proveedor y rol. Cada rol —razonamiento (elegir tablas) y generación
 * (escribir/evaluar SQL)— tiene su variable de entorno y cae al modelo base si no está puesta,
 * así "pueden ser el mismo" sin configurar nada. Centralizado para que el adaptador y la
 * pantalla de selección de proveedor no diverjan.
 */
import { LlmProvider } from './LlmProvider'

/** Para qué se usa el modelo: pensar tablas (reasoning) o escribir/evaluar SQL (generation). */
export type LlmRole = 'reasoning' | 'generation'

const DEFAULT_LOCAL_MODEL = 'local-model'
const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini'

/** Modelos del proveedor: el base (fallback) y el específico de cada rol si está configurado. */
function modelsFor(provider: LlmProvider, env: NodeJS.ProcessEnv) {
  if (provider === LlmProvider.Local) {
    return {
      base: env.LMSTUDIO_MODEL ?? DEFAULT_LOCAL_MODEL,
      reasoning: env.LMSTUDIO_MODEL_REASONING,
      generation: env.LMSTUDIO_MODEL_GENERATION,
    }
  }
  return {
    base: env.OPENAI_MODEL ?? DEFAULT_OPENAI_MODEL,
    reasoning: env.OPENAI_MODEL_REASONING,
    generation: env.OPENAI_MODEL_GENERATION,
  }
}

/** Sin rol (o rol sin variable propia) devuelve el modelo base: el comportamiento de siempre. */
export function resolveModelName(provider: LlmProvider, role?: LlmRole, env: NodeJS.ProcessEnv = process.env): string {
  const models = modelsFor(provider, env)
  return (role && models[role]) || models.base
}
