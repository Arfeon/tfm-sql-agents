/**
 * Prompts de sistema de los agentes, externalizados a ficheros Markdown en `agents/`
 * para poder ajustarlos sin tocar código. Cada agente tiene su fichero (sql-generator.md,
 * judge.md, equivalence-judge.md, chat.md); los placeholders `{{nombre}}` se sustituyen
 * al cargar (hoy solo `{{dialect}}`).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PROJECT_ROOT } from './projectRoot'

/** Carpeta de prompts, en la raíz del repo (independiente de desde dónde se ejecute). */
export const AGENTS_DIR = join(PROJECT_ROOT, 'agents')

export type AgentPromptName = 'sql-generator' | 'equivalence-judge' | 'judge' | 'chat' | 'schema-selector'

export function loadAgentPrompt(
  name: AgentPromptName,
  variables: Record<string, string> = {},
  dir: string = AGENTS_DIR,
): string {
  const path = join(dir, `${name}.md`)
  let template: string
  try {
    template = readFileSync(path, 'utf8')
  } catch {
    throw new Error(`No encuentro el prompt del agente "${name}" en ${path}. La carpeta agents/ forma parte del repo; restáurala o revisa desde dónde ejecutas.`)
  }
  return fillPlaceholders(template.trim(), variables)
}

/** Un placeholder sin valor se deja tal cual, para que se vea en la salida y se detecte. */
export function fillPlaceholders(template: string, variables: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (placeholder, key: string) => variables[key] ?? placeholder)
}
