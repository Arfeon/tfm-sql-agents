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
  const pool = Object.values(actualRow)
  const used = new Array(pool.length).fill(false)
  for (const expectedValue of Object.values(expectedRow)) {
    const index = pool.findIndex((actualValue, i) => !used[i] && valuesEquivalent(expectedValue, actualValue))
    if (index === -1) {
      return false
    }
    used[index] = true
  }
  return true
}

/**
 * Igualdad de valores para la métrica justa. Además de la igualdad normalizada,
 * dos números casan si coinciden al redondear ambos a la precisión más gruesa de
 * los dos: una referencia con ROUND(x, 1) = 124.0 y una candidata sin redondear
 * 124.0037… son la misma respuesta (la métrica estricta sigue exigiendo igualdad).
 */
function valuesEquivalent(a: unknown, b: unknown): boolean {
  const aText = normalizeValue(a)
  const bText = normalizeValue(b)
  if (aText === bText) {
    return true
  }
  const aNumber = Number(aText)
  const bNumber = Number(bText)
  if (aText === '' || bText === '' || aText === '∅' || bText === '∅' || Number.isNaN(aNumber) || Number.isNaN(bNumber)) {
    return false
  }
  const decimals = Math.min(decimalsOf(a), decimalsOf(b))
  return aNumber.toFixed(decimals) === bNumber.toFixed(decimals)
}

/** Decimales declarados por el valor tal cual llegó ('124.0' → 1, '124' o 124.0 → 0). */
function decimalsOf(value: unknown): number {
  const text = String(value).trim()
  const match = /^-?\d+\.(\d+)$/.exec(text)
  return match ? match[1].length : 0
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
