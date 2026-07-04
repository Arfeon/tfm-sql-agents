/**
 * Golden set de evaluación (SPEC-11): las preguntas con su SQL de referencia.
 *
 * Cada BD objetivo tiene su `golden_set.yaml` (Arcadia y Nebula, registro
 * nombre→fichero): preguntas en español, esquema en inglés. Cada caso trae las
 * tablas que la SQL correcta debe tocar (para el schema-linking recall) y una SQL
 * de referencia (para comparar el resultado). Las referencias "por/cada categoría"
 * siguen la interpretación inclusiva de D-13 (LEFT JOIN, las categorías vacías salen).
 *
 * Parseo con `yaml` y valido la forma mínima; el resto de la evaluación recibe los
 * casos ya cargados, así que se puede probar con casos en memoria sin leer el fichero.
 */
import { readFileSync } from 'node:fs'
import { parse } from 'yaml'

export type GoldenDifficulty = 'easy' | 'medium' | 'hard'

export interface GoldenCase {
  id: string
  question: string
  difficulty: GoldenDifficulty
  /** Tablas que la SQL correcta debe tocar (schema-linking recall). */
  tables: string[]
  /** SQL de referencia (PostgreSQL, solo lectura); se compara el RESULTADO, no el texto. */
  sql: string
}

/** Ruta al golden set de Arcadia, relativa a la raíz del repo (donde arranca el runner). */
export const GOLDEN_SET_PATH = '../setup/datasets/arcadia/golden_set.yaml'

/** Qué golden set le corresponde a cada BD objetivo (por nombre). */
const GOLDEN_SET_BY_TARGET: Record<string, string> = {
  arcadia: GOLDEN_SET_PATH,
  nebula: '../setup/datasets/nebula/golden_set.yaml',
}

/** La ruta del golden set de una BD objetivo, o error si no hay uno registrado. */
export function goldenSetPathFor(targetName: string): string {
  const path = GOLDEN_SET_BY_TARGET[targetName]
  if (!path) {
    throw new Error(
      `No hay golden set para la BD "${targetName}". Registradas: ${Object.keys(GOLDEN_SET_BY_TARGET).join(', ')}.`,
    )
  }
  return path
}

/** Leo y valido el golden set desde un fichero YAML. */
export function loadGoldenSet(path: string = GOLDEN_SET_PATH): GoldenCase[] {
  const raw = parse(readFileSync(path, 'utf8'))
  return parseGoldenCases(raw)
}

/** Valido que el YAML parseado sea una lista de casos con la forma esperada. */
export function parseGoldenCases(raw: unknown): GoldenCase[] {
  if (!Array.isArray(raw)) {
    throw new Error('El golden set debe ser una lista de casos.')
  }
  return raw.map(toGoldenCase)
}

function toGoldenCase(item: unknown, index: number): GoldenCase {
  const fields = item as Record<string, unknown>
  const id = typeof fields.id === 'string' ? fields.id : `#${index + 1}`
  if (typeof fields.question !== 'string' || typeof fields.sql !== 'string' || !Array.isArray(fields.tables)) {
    throw new Error(`Caso ${id} del golden set incompleto: faltan question, sql o tables.`)
  }
  return {
    id,
    question: fields.question,
    difficulty: normalizeDifficulty(fields.difficulty),
    tables: fields.tables.map(String),
    sql: fields.sql,
  }
}

/** Una dificultad desconocida la trato como "hard" (conservador). */
function normalizeDifficulty(value: unknown): GoldenDifficulty {
  if (value === 'easy' || value === 'medium' || value === 'hard') {
    return value
  }
  return 'hard'
}
