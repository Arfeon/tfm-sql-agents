/**
 * Métricas de la evaluación experimental (SPEC-11), como funciones puras.
 * La execution accuracy compara el RESULTADO de ejecutar, no el texto de la SQL.
 */

export type ResultRow = Record<string, unknown>

export function schemaLinkingRecall(goldTables: string[], retrievedTables: string[]): number {
  // Sin tablas gold, recall = 1 por convención.
  if (goldTables.length === 0) {
    return 1
  }
  const retrieved = new Set(retrievedTables)
  const found = goldTables.filter((table) => retrieved.has(table)).length
  return found / goldTables.length
}

/**
 * Comparo como multiconjunto de filas, ignorando orden de filas y nombre/orden de
 * columnas. Límite conocido: puede dar falsos positivos si dos columnas permutan valores.
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
 * Versión justa: la pregunta en lenguaje natural no fija qué columnas devolver, así que
 * acepto columnas de más pero nunca filas o valores distintos ("correcto o más rico").
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

function normalizeRow(row: ResultRow): string {
  return Object.values(row).map(normalizeValue).sort().join('|')
}

/** Los numéricos se comparan por su número (320 == "320"). */
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

/**
 * Criterio único de equivalencia: la métrica objetiva manda. El juez LLM SOLO puede
 * RESCATAR un caso que la comparación de datos descarta por un artefacto (redondeo,
 * columna de más), nunca DESCARTAR uno que la ejecución ya da por bueno. Así la escala
 * queda monótona (estricta ⊆ justa ⊆ equivalente) y el juez, que a veces alucina una
 * divergencia inexistente, no puede bajar la métrica por debajo de la evidencia real.
 */
export function isSemanticPass(matchFair: boolean, judgeEquivalent: boolean): boolean {
  return matchFair || judgeEquivalent
}

/** Proxy rústico: ~4 caracteres por token. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}
