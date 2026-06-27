/**
 * Descripciones opcionales de tablas para enriquecer la vectorización.
 *
 * El usuario deja en la carpeta `descriptions/` un fichero JSON con un array de
 * objetos `{ tableName, description }`. El fichero `*.example.json` es solo una
 * guía del formato y la detección lo ignora.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'

/** Carpeta de descripciones, relativa al directorio de ejecución (backend/). */
export const DESCRIPTIONS_DIR = '../descriptions'

const descriptionsSchema = z.array(
  z.object({
    tableName: z.string(),
    description: z.string(),
  }),
)

/** Parsea el contenido JSON a un mapa `tabla → descripción`. */
export function parseDescriptions(json: string): Map<string, string> {
  const entries = descriptionsSchema.parse(JSON.parse(json))
  return new Map(entries.map((entry) => [entry.tableName, entry.description]))
}

/** ¿Hay algún fichero de descripciones (ignorando el de ejemplo)? */
export function hasDescriptionsFile(dir: string = DESCRIPTIONS_DIR): boolean {
  return findDescriptionFiles(dir).length > 0
}

/** Carga y combina todos los ficheros de descripciones de la carpeta. */
export function loadDescriptions(dir: string = DESCRIPTIONS_DIR): Map<string, string> {
  const merged = new Map<string, string>()
  for (const file of findDescriptionFiles(dir)) {
    for (const [tableName, description] of parseDescriptions(readFileSync(file, 'utf8'))) {
      merged.set(tableName, description)
    }
  }
  return merged
}

function findDescriptionFiles(dir: string): string[] {
  if (!existsSync(dir)) {
    return []
  }
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json') && !name.endsWith('.example.json'))
    .map((name) => join(dir, name))
}
