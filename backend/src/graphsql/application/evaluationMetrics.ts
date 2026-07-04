/**
 * Métricas de la evaluación experimental (SPEC-11), como funciones puras.
 *
 * - `schemaLinkingRecall`: de las tablas que la SQL correcta debe tocar, cuántas
 *   trae la recuperación. Aísla la recuperación de si el LLM acierta la SQL.
 * - `resultsMatch`: si dos resultados de ejecución son equivalentes. Es la
 *   "execution accuracy": comparo el RESULTADO, no el texto de la SQL.
 * - `estimateTokens`: proxy rústico del coste en tokens del DDL del contexto.
 */

/** Una fila de resultado: columnas → valores. */
export type ResultRow = Record<string, unknown>

/** De las tablas `gold`, la fracción que aparece en las recuperadas (0..1). */
export function schemaLinkingRecall(goldTables: string[], retrievedTables: string[]): number {
  // Sin tablas que recuperar, el recall es perfecto por convención.
  if (goldTables.length === 0) {
    return 1
  }
  const retrieved = new Set(retrievedTables)
  const found = goldTables.filter((table) => retrieved.has(table)).length
  return found / goldTables.length
}

/**
 * ¿Dos resultados son equivalentes? Los comparo como MULTICONJUNTO de filas, sin
 * importar el orden de las filas ni el nombre/orden de las columnas: cada fila se
 * reduce a sus valores normalizados y ordenados. Es la comparación lenient habitual
 * en execution accuracy; suficiente para el golden set (agregados y top-N). Nota:
 * al ignorar el nombre de columna puede dar falsos positivos si dos columnas
 * permutan valores; lo asumo como límite conocido de la métrica.
 */
export function resultsMatch(expected: ResultRow[], actual: ResultRow[]): boolean {
  if (expected.length !== actual.length) {
    return false
  }
  const expectedRows = expected.map(normalizeRow).sort()
  const actualRows = actual.map(normalizeRow).sort()
  return expectedRows.every((row, index) => row === actualRows[index])
}

/**
 * ¿El resultado `actual` CONTIENE al de referencia? Es la versión justa de la execution
 * accuracy: como la pregunta en lenguaje natural no fija qué columnas devolver, una SQL
 * correcta que además trae columnas de más (p. ej. el `id` junto al nombre) sigue siendo
 * correcta. Exijo el mismo número de filas y que cada fila de referencia esté contenida
 * (sus valores, como multiconjunto) en una fila distinta de `actual`. No cuenta como
 * acierto un resultado con filas o valores distintos: solo "correcto o más rico".
 */
export function resultsContain(expected: ResultRow[], actual: ResultRow[]): boolean {
  if (expected.length !== actual.length) {
    return false
  }
  const used = new Array(actual.length).fill(false)
  for (const expectedRow of expected) {
    const matchIndex = actual.findIndex((actualRow, index) => !used[index] && rowContains(actualRow, expectedRow))
    if (matchIndex === -1) {
      return false
    }
    used[matchIndex] = true
  }
  return true
}

/** ¿La fila `actual` contiene todos los valores de `expected` (como multiconjunto)? */
function rowContains(actualRow: ResultRow, expectedRow: ResultRow): boolean {
  const pool = Object.values(actualRow).map(normalizeValue)
  for (const value of Object.values(expectedRow).map(normalizeValue)) {
    const index = pool.indexOf(value)
    if (index === -1) {
      return false
    }
    pool.splice(index, 1)
  }
  return true
}

/** Reduzco una fila a un texto canónico de sus valores (ordenados), sin el nombre de columna. */
function normalizeRow(row: ResultRow): string {
  return Object.values(row).map(normalizeValue).sort().join('|')
}

/** Normalizo un valor a texto; los numéricos se comparan por su número (320 == "320"). */
function normalizeValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '∅'
  }
  const asText = String(value).trim()
  const asNumber = Number(asText)
  if (asText !== '' && !Number.isNaN(asNumber)) {
    return String(asNumber)
  }
  return asText
}

/** Estimación rústica de tokens del DDL (~4 caracteres por token). Es un proxy, no exacto. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}
