/**
 * Descripciones opcionales de tablas para enriquecer la vectorización: ficheros JSON
 * `[{ tableName, description }]` en `descriptions/`; los `*.example.json` se ignoran.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import { PROJECT_ROOT } from './projectRoot'

/** Carpeta de descripciones, en la raíz del repo (independiente de desde dónde se ejecute). */
export const DESCRIPTIONS_DIR = join(PROJECT_ROOT, 'descriptions')

const descriptionsSchema = z.array(
  z.object({
    tableName: z.string(),
    description: z.string(),
  }),
)

export function parseDescriptions(json: string): Map<string, string> {
  const entries = descriptionsSchema.parse(JSON.parse(json))
  return new Map(entries.map((entry) => [entry.tableName, entry.description]))
}

export function hasDescriptionsFile(dir: string = DESCRIPTIONS_DIR): boolean {
  return findDescriptionFiles(dir).length > 0
}

/** Ruta del fichero de descripciones de una BD (un JSON por BD, p. ej. `descriptions/meridian.json`). */
export function descriptionsFilePathFor(dbName: string, dir: string = DESCRIPTIONS_DIR): string {
  return join(dir, `${dbName}.json`)
}

/**
 * Guarda las descripciones generadas como `[{ tableName, description }]`. Es el mismo
 * formato que lee `loadDescriptions`, así que el escaneo las recoge sin más. Solo escribo
 * las que tienen texto (una descripción vacía no aporta nada al índice).
 */
export function saveDescriptions(entries: { tableName: string; description: string }[], filePath: string): number {
  const nonEmpty = entries.filter((entry) => entry.description.trim().length > 0)
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, `${JSON.stringify(nonEmpty, null, 2)}\n`, 'utf8')
  return nonEmpty.length
}

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
