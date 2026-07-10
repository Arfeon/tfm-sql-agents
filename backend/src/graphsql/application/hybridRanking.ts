/**
 * Ranking léxico y fusión híbrida para el schema linking. El denso entierra el pivote de la
 * pregunta cuando la frase la domina otro tema; el léxico casa las PALABRAS con el
 * nombre/columnas de cada tabla, y la fusión RRF combina ambos sin calibrar pesos.
 */
import type { TableMatch } from '../domain/ports/IEmbeddingsStore'

// Palabras vacías (es/ca) + ruido estructural del search_text ("Tabla:", "Columnas:"…),
// que aparece en TODAS las filas y crearía coincidencias universales.
const STOPWORDS = new Set([
  'dime', 'dame', 'muestra', 'quiero', 'necesito', 'cual', 'cuales', 'quin', 'quina', 'quines',
  'quants', 'quantes', 'cuantos', 'cuantas', 'cuanto', 'cuanta', 'tiene', 'tienen', 'tener', 'te',
  'mas', 'mes', 'con', 'amb', 'sin', 'los', 'las', 'els', 'les', 'del', 'dels', 'per', 'por',
  'para', 'como', 'que', 'una', 'uno', 'unes', 'uns', 'sus', 'seu', 'seus', 'sobre', 'entre',
  'desde', 'hasta', 'este', 'esta', 'esto', 'aquest', 'aquesta', 'aquestes',
  'tabla', 'tablas', 'taula', 'taules', 'columna', 'columnas', 'columnes', 'descripcion',
  'descripcio', 'description',
])

/** Minúsculas, sin acentos, partido por no-alfanuméricos; tokens ≥3, sin vacías, sin repes. */
const DIACRITICS = /[̀-ͯ]/g
export function tokenize(text: string): string[] {
  const normalized = text.toLowerCase().normalize('NFD').replace(DIACRITICS, '')
  const seen = new Set<string>()
  const tokens: string[] = []
  for (const raw of normalized.split(/[^a-z0-9]+/)) {
    if (raw.length < 3 || STOPWORDS.has(raw) || seen.has(raw)) {
      continue
    }
    seen.add(raw)
    tokens.push(raw)
  }
  return tokens
}

// Cacheo los trigramas por token: se repiten muchísimo entre tablas, y sin cache se
// reconstruían cientos de miles de Sets por pregunta a escala de ~800 tablas.
const trigramCache = new Map<string, Set<string>>()

function trigrams(token: string): Set<string> {
  const cached = trigramCache.get(token)
  if (cached) {
    return cached
  }
  const padded = `  ${token} `
  const grams = new Set<string>()
  for (let i = 0; i < padded.length - 2; i++) {
    grams.add(padded.slice(i, i + 3))
  }
  trigramCache.set(token, grams)
  return grams
}

/** Jaccard sobre trigramas: 1 = idénticas, 0 = sin trigramas comunes. */
export function trigramSimilarity(a: string, b: string): number {
  if (a === b) {
    return 1
  }
  const ga = trigrams(a)
  const gb = trigrams(b)
  let intersection = 0
  for (const gram of ga) {
    if (gb.has(gram)) {
      intersection++
    }
  }
  const union = ga.size + gb.size - intersection
  return union === 0 ? 0 : intersection / union
}

/** Umbral por debajo del cual una coincidencia de token no cuenta (evita ruido de trigramas). */
const MATCH_THRESHOLD = 0.4

/** Lo bien que casa un token de la pregunta con el mejor token del objetivo (0 si no llega). */
function bestTokenMatch(questionToken: string, targetTokens: string[]): number {
  let best = 0
  for (const target of targetTokens) {
    let score: number
    if (questionToken === target) {
      score = 1
    } else if (target.includes(questionToken) || questionToken.includes(target)) {
      score = 0.9
    } else {
      score = trigramSimilarity(questionToken, target)
    }
    if (score > best) {
      best = score
    }
  }
  return best >= MATCH_THRESHOLD ? best : 0
}

/** Suma de coincidencias de los tokens de la pregunta contra el texto de la tabla. */
export function lexicalScore(questionTokens: string[], targetText: string): number {
  const targetTokens = tokenize(targetText)
  if (targetTokens.length === 0) {
    return 0
  }
  let score = 0
  for (const questionToken of questionTokens) {
    score += bestTokenMatch(questionToken, targetTokens)
  }
  return score
}

/** Ordena las tablas por coincidencia léxica de su nombre/columnas con la pregunta. */
export function rankLexically(
  question: string,
  tables: { tableName: string; searchText: string }[],
): TableMatch[] {
  const questionTokens = tokenize(question)
  return tables
    .map((table) => ({ tableName: table.tableName, score: lexicalScore(questionTokens, table.searchText) }))
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score)
}

/**
 * Reciprocal Rank Fusion: cada tabla suma 1/(k + posición) por cada lista donde aparece, así
 * que una fuerte en cualquiera de los rankings sube, sin pesos que calibrar. El Map preserva
 * el orden de entrada y el sort es estable, de modo que los empates son deterministas.
 */
export function fuseByReciprocalRank(rankings: TableMatch[][], k = 60): TableMatch[] {
  const fused = new Map<string, number>()
  for (const ranking of rankings) {
    ranking.forEach((match, index) => {
      fused.set(match.tableName, (fused.get(match.tableName) ?? 0) + 1 / (k + index + 1))
    })
  }
  return [...fused.entries()]
    .map(([tableName, score]) => ({ tableName, score }))
    .sort((a, b) => b.score - a.score)
}
