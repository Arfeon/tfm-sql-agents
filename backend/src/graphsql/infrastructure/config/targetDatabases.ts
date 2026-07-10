/**
 * Catálogo de BDs objetivo, declaradas en el `.env` con claves numeradas
 * (`TARGET_DB_1_*`, `TARGET_DB_2_*`, …) porque un `.env` no admite arrays.
 */

export type TargetDbType = 'postgresql' | 'mssql'

export interface TargetDatabaseConfig {
  type: TargetDbType
  name: string
  host: string
  port: number
  user: string
  password: string
  schema: string
  /** BD pública/conocida: la evaluación avisa de posible contaminación del LLM. */
  public?: boolean
}

export function targetDatabaseLabel(target: TargetDatabaseConfig): string {
  return `${target.type} / ${target.name}`
}

const DIALECT_LABELS: Record<TargetDbType, string> = {
  postgresql: 'PostgreSQL',
  mssql: 'SQL Server',
}

/** Valores por defecto que dependen del motor (los demás son comunes). */
const DEFAULT_PORT: Record<TargetDbType, number> = { postgresql: 5432, mssql: 1433 }
const DEFAULT_SCHEMA: Record<TargetDbType, string> = { postgresql: 'public', mssql: 'dbo' }
export function sqlDialectFor(target: TargetDatabaseConfig): string {
  return DIALECT_LABELS[target.type] ?? target.type
}

export function loadTargetDatabases(env: NodeJS.ProcessEnv = process.env): TargetDatabaseConfig[] {
  const numbered = loadNumberedTargets(env)
  if (numbered.length > 0) {
    return numbered
  }
  // Compatibilidad con la forma antigua sin índice (TARGET_DB_NAME).
  return [readTarget(env, '')]
}

function hasTargetAt(env: NodeJS.ProcessEnv, index: number): boolean {
  return env[`TARGET_DB_${index}_NAME`] !== undefined
}

function loadNumberedTargets(env: NodeJS.ProcessEnv): TargetDatabaseConfig[] {
  const targets: TargetDatabaseConfig[] = []
  for (let index = 1; hasTargetAt(env, index); index++) {
    targets.push(readTarget(env, `${index}_`))
  }
  return targets
}

function readTarget(env: NodeJS.ProcessEnv, prefix: string): TargetDatabaseConfig {
  const value = (suffix: string): string | undefined => env[`TARGET_DB_${prefix}${suffix}`]
  const type = parseTargetDbType(value('TYPE'), `TARGET_DB_${prefix}TYPE`)
  return {
    type,
    name: value('NAME') ?? 'arcadia',
    host: value('HOST') ?? 'localhost',
    port: parseInt(value('PORT') ?? String(DEFAULT_PORT[type]), 10),
    user: value('USER') ?? 'postgres',
    password: value('PASSWORD') ?? 'postgres',
    schema: value('SCHEMA') ?? DEFAULT_SCHEMA[type],
    public: value('PUBLIC') === 'true',
  }
}

/** Un tipo desconocido falla aquí, no aguas abajo con los defaults de PostgreSQL (puerto, schema). */
function parseTargetDbType(raw: string | undefined, envKey: string): TargetDbType {
  const type = raw ?? 'postgresql'
  if (!(type in DEFAULT_PORT)) {
    throw new Error(`${envKey}="${raw}" no es un tipo de BD soportado. Valores válidos: ${Object.keys(DEFAULT_PORT).join(', ')}.`)
  }
  return type as TargetDbType
}

/** La BD a evaluar: `EVAL_TARGET` por nombre, o la primera del catálogo si no está. */
export function selectEvalTarget(env: NodeJS.ProcessEnv = process.env): TargetDatabaseConfig {
  const targets = loadTargetDatabases(env)
  const name = env.EVAL_TARGET
  if (!name) {
    return targets[0]
  }
  const found = targets.find((target) => target.name === name)
  if (!found) {
    throw new Error(`EVAL_TARGET="${name}" no está en el catálogo (${targets.map((t) => t.name).join(', ')}).`)
  }
  return found
}
