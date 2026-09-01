/**
 * Selección del proveedor LLM al arrancar el CLI: el `.env` es solo el DEFECTO, no una
 * decisión oculta, y muestro el modelo de cada opción. Fijo `process.env.LLM_PROVIDER` de la
 * sesión, de donde `ChatModelFactory.fromEnv()` lo lee, así la elección se propaga sola.
 */
import chalk from 'chalk'
import { select } from '@inquirer/prompts'
import { LlmProvider } from '../../graphsql/infrastructure/llm/LlmProvider'
import { resolveModelName } from '../../graphsql/infrastructure/llm/modelSelection'

/**
 * Los modelos que usaría cada proveedor, para enseñarlos antes de elegir. Uso dos: el de
 * razonamiento (elegir tablas) y el de generación (escribir/evaluar SQL). Si coinciden,
 * muestro uno solo.
 */
export function modelNameFor(provider: LlmProvider): string {
  const reasoning = resolveModelName(provider, 'reasoning')
  const generation = resolveModelName(provider, 'generation')
  return reasoning === generation ? reasoning : `razonamiento ${reasoning} · SQL ${generation}`
}

/** Etiqueta legible del proveedor para los mensajes. */
export function providerLabel(provider: LlmProvider): string {
  if (provider === LlmProvider.Local) return 'Local (LM Studio)'
  if (provider === LlmProvider.Gateway) return 'Gateway corporativo'
  return 'OpenAI (nube)'
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
      { name: `Gateway corporativo — ${modelNameFor(LlmProvider.Gateway)}`, value: LlmProvider.Gateway },
    ],
  })

  process.env.LLM_PROVIDER = provider
  console.log(chalk.green(`✔ Proveedor de esta sesión: ${providerLabel(provider)} · modelo ${modelNameFor(provider)}\n`))
  return provider
}
