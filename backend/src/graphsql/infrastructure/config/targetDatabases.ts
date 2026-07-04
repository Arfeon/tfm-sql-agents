/**
 * Configuración de las bases de datos objetivo (las que consulta el cliente).
 *
 * Como un `.env` no admite arrays, declaro varias BDs con claves numeradas:
 * `TARGET_DB_1_TYPE`, `TARGET_DB_1_NAME`, …, `TARGET_DB_2_TYPE`, … El loader
 * recorre los índices y devuelve el catálogo (lista) para que el CLI muestre las
 * opciones. Si no hay claves numeradas, leo la forma antigua sin número.
 */

export type TargetDbType = 'postgresql'

export interface TargetDatabaseConfig {
  type: TargetDbType
  name: string
  host: string
  port: number
  user: string
  password: string
  schema: string
  /**
   * Marca una BD como pública/conocida. Si es `true`, la evaluación avisa de que el
   * LLM puede haberla visto en su entrenamiento (posible contaminación de resultados).
   */
  public?: boolean
}

/** Etiqueta legible para mostrar en el CLI, p. ej. "postgresql / arcadia". */
export function targetDatabaseLabel(target: TargetDatabaseConfig): string {
  return `${target.type} / ${target.name}`
}

/** Nombre del dialecto SQL del motor, para inyectarlo en el prompt del SQL Agent. */
const DIALECT_LABELS: Record<TargetDbType, string> = {
  postgresql: 'PostgreSQL',
}
export function sqlDialectFor(target: TargetDatabaseConfig): string {
  return DIALECT_LABELS[target.type] ?? target.type
}

/** Catálogo de BDs objetivo declaradas en el `.env`. */
export function loadTargetDatabases(env: NodeJS.ProcessEnv = process.env): TargetDatabaseConfig[] {
  const numbered = loadNumberedTargets(env)
  if (numbered.length > 0) {
    return numbered
  }
  // Compatibilidad: si no hay claves numeradas, leo la BD objetivo única sin índice.
  return [readTarget(env, '')]
}

/** ¿Hay una BD objetivo declarada en el índice dado? (existe su clave `_NAME`). */
function hasTargetAt(env: NodeJS.ProcessEnv, index: number): boolean {
  return env[`TARGET_DB_${index}_NAME`] !== undefined
}

/** Recorre TARGET_DB_1_*, TARGET_DB_2_*, … hasta el primer índice sin `NAME`. */
function loadNumberedTargets(env: NodeJS.ProcessEnv): TargetDatabaseConfig[] {
  const targets: TargetDatabaseConfig[] = []
  for (let index = 1; hasTargetAt(env, index); index++) {
    targets.push(readTarget(env, `${index}_`))
  }
  return targets
}

/** Lee una BD objetivo con un prefijo dado (p. ej. "1_" o "" para la forma antigua). */
function readTarget(env: NodeJS.ProcessEnv, prefix: string): TargetDatabaseConfig {
  const value = (suffix: string): string | undefined => env[`TARGET_DB_${prefix}${suffix}`]
  return {
    type: (value('TYPE') ?? 'postgresql') as TargetDbType,
    name: value('NAME') ?? 'arcadia',
    host: value('HOST') ?? 'localhost',
    port: parseInt(value('PORT') ?? '5432', 10),
    user: value('USER') ?? 'postgres',
    password: value('PASSWORD') ?? 'postgres',
    schema: value('SCHEMA') ?? 'public',
    public: value('PUBLIC') === 'true',
  }
}

/**
 * La BD objetivo a evaluar: la que indique `EVAL_TARGET` (por nombre) o, si no está,
 * la primera del catálogo (Arcadia). Así la evaluación por defecto no cambia.
 */
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
