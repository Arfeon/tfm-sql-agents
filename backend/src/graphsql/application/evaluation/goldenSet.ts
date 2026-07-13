/**
 * Golden set de evaluación (SPEC-11): preguntas con su SQL de referencia, un YAML por
 * BD objetivo. Las referencias "por/cada categoría" siguen la interpretación inclusiva
 * de D-13 (LEFT JOIN, las categorías vacías salen).
 */
import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { z } from 'zod'

/** Una dificultad desconocida o ausente se trata como "hard" (conservador). */
const goldenCaseSchema = z.object({
  id: z.string().optional(),
  question: z.string(),
  difficulty: z.enum(['easy', 'medium', 'hard']).catch('hard'),
  /** Tablas que la SQL correcta debe tocar (schema-linking recall). */
  tables: z.array(z.string()),
  /** SQL de referencia; se compara el RESULTADO, no el texto. */
  sql: z.string(),
})

export type GoldenDifficulty = z.infer<typeof goldenCaseSchema>['difficulty']

/** Un caso ya validado, con el `id` siempre presente (si falta en el YAML, se numera). */
export type GoldenCase = z.infer<typeof goldenCaseSchema> & { id: string }

/** Rutas relativas a la raíz del repo (donde arranca el runner). */
export const GOLDEN_SET_PATH = '../setup/datasets/arcadia/golden_set.yaml'

const GOLDEN_SET_BY_TARGET: Record<string, string> = {
  arcadia: GOLDEN_SET_PATH,
  nebula: '../setup/datasets/nebula/golden_set.yaml',
}

export function goldenSetPathFor(targetName: string): string {
  const path = GOLDEN_SET_BY_TARGET[targetName]
  if (!path) {
    throw new Error(
      `No hay golden set para la BD "${targetName}". Registradas: ${Object.keys(GOLDEN_SET_BY_TARGET).join(', ')}.`,
    )
  }
  return path
}

export function loadGoldenSet(path: string = GOLDEN_SET_PATH): GoldenCase[] {
  const raw = parse(readFileSync(path, 'utf8'))
  return parseGoldenCases(raw)
}

export function parseGoldenCases(raw: unknown): GoldenCase[] {
  if (!Array.isArray(raw)) {
    throw new Error('El golden set debe ser una lista de casos.')
  }
  return raw.map(toGoldenCase)
}

function toGoldenCase(item: unknown, index: number): GoldenCase {
  const fallbackId = `#${index + 1}`
  const parsed = goldenCaseSchema.safeParse(item)
  if (!parsed.success) {
    const id = z.object({ id: z.string() }).safeParse(item).data?.id ?? fallbackId
    throw new Error(`Caso ${id} del golden set incompleto o mal formado:\n${z.prettifyError(parsed.error)}`)
  }
  return { ...parsed.data, id: parsed.data.id ?? fallbackId }
}
