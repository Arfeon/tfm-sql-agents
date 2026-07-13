/**
 * Formato del detalle por caso (`escala-casos*.json`) que escribe la prueba de escala
 * (runScaleEval). Estos ficheros se copian y renombran a mano entre tiradas, así que se
 * validan con zod al leerlos: uno mal formado o de otra versión daría estadísticas
 * silenciosamente falsas. Los campos opcionales faltan en tiradas antiguas
 * (anteriores a la auditoría 2026-07-09).
 */
import { readFileSync } from 'node:fs'
import { z } from 'zod'

const scaleRunCase = z.object({
  id: z.string(),
  difficulty: z.string(),
  recall: z.number(),
  executionMatchStrict: z.boolean().optional(),
  executionMatchFair: z.boolean(),
  executionMatchSemantic: z.boolean(),
  equivalenceReason: z.string().optional(),
  error: z.string().optional(),
  referenceSql: z.string().optional(),
  generatedSql: z.string(),
})

/** Una tirada completa: un elemento por BD objetivo, con sus casos por modo de recuperación. */
const scaleRunSchema = z.array(
  z.object({
    name: z.string(),
    tableCount: z.number(),
    modes: z.array(
      z.object({
        mode: z.string(),
        cases: z.array(scaleRunCase),
      }),
    ),
  }),
)

export type ScaleRunCase = z.infer<typeof scaleRunCase>
export type ScaleRun = z.infer<typeof scaleRunSchema>

/** Lee y valida un `escala-casos*.json`; si no cuadra, el error dice qué fichero y qué campo. */
export function loadScaleRun(path: string): ScaleRun {
  const parsed = scaleRunSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')))
  if (!parsed.success) {
    throw new Error(`El fichero ${path} no tiene el formato de escala-casos:\n${z.prettifyError(parsed.error)}`)
  }
  return parsed.data
}
