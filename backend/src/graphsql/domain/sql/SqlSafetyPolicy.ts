/**
 * Comprobación de seguridad del Judge (SPEC-06): validación sin LLM, pura y determinista.
 * Es la seguridad por diseño: pase lo que pase con el LLM, una consulta que no sea
 * claramente de solo lectura no debe poder ejecutarse.
 */
import { type QueryVerdict, validVerdict, invalidVerdict } from './QueryVerdict'

export const READ_ONLY_PREFIXES = ['SELECT', 'WITH'] as const

/** Las palabras del contrato (DROP, DELETE, INSERT, …) más otras igual de peligrosas. */
export const DANGEROUS_KEYWORDS = [
  'DROP',
  'DELETE',
  'INSERT',
  'UPDATE',
  'TRUNCATE',
  'ALTER',
  'GRANT',
  'REVOKE',
  'CREATE',
  'MERGE',
  'REPLACE',
  'CALL',
  'EXEC',
  'EXECUTE',
] as const

export function checkSqlSafety(sql: string): QueryVerdict {
  const statement = sql.trim()
  if (statement === '') {
    return invalidVerdict(['La sentencia está vacía.'])
  }

  // Las reglas de abajo tienen que mirar SQL, no datos: sin esto, un filtro legítimo
  // como `WHERE nota ILIKE '%alta -- urgente%'` se rechaza como comentario de línea.
  const { masked, unterminated } = maskQuoted(statement)
  if (unterminated) {
    return invalidVerdict(['Hay una comilla sin cerrar: no puedo comprobar la consulta con seguridad.'])
  }

  const errors: string[] = []
  collectPrefixError(statement, errors)
  collectDangerousKeywordErrors(masked, errors)
  collectInjectionErrors(masked, errors)

  return errors.length === 0 ? validVerdict() : invalidVerdict(errors)
}

/** Comillas que abren un tramo entrecomillado: valor ('…') o identificador ("…"). */
const QUOTES = ["'", '"'] as const

/**
 * Vacía el contenido de los tramos entrecomillados dejando las comillas, para que las
 * reglas se apliquen solo a la estructura de la sentencia. Dentro de un literal, la
 * comilla duplicada ('') es la comilla escapada, no el cierre.
 *
 * El criterio ante la duda es enmascarar de menos: quedarse corto solo produce falsos
 * positivos, mientras que enmascarar de más podría esconder una inyección. Por eso una
 * comilla sin cerrar no se enmascara hasta el final —eso taparía un `'; DROP TABLE t`—
 * sino que se declara y el llamante la rechaza.
 */
function maskQuoted(statement: string): { masked: string; unterminated: boolean } {
  let masked = ''
  let index = 0

  while (index < statement.length) {
    const char = statement[index]
    if (!QUOTES.includes(char as (typeof QUOTES)[number])) {
      masked += char
      index += 1
      continue
    }

    const closing = findClosingQuote(statement, index, char)
    if (closing === null) {
      return { masked, unterminated: true }
    }
    masked += char + char
    index = closing + 1
  }

  return { masked, unterminated: false }
}

/** Índice de la comilla que cierra la abierta en `start`, o `null` si no se cierra. */
function findClosingQuote(statement: string, start: number, quote: string): number | null {
  let index = start + 1
  while (index < statement.length) {
    if (statement[index] !== quote) {
      index += 1
    } else if (statement[index + 1] === quote) {
      index += 2
    } else {
      return index
    }
  }
  return null
}

function startsWithWord(word: string, statement: string): boolean {
  return new RegExp(`^${word}\\b`, 'i').test(statement)
}

function containsWord(word: string, statement: string): boolean {
  return new RegExp(`\\b${word}\\b`, 'i').test(statement)
}

function collectPrefixError(statement: string, errors: string[]): void {
  const startsReadOnly = READ_ONLY_PREFIXES.some((prefix) => startsWithWord(prefix, statement))
  if (!startsReadOnly) {
    errors.push(`La sentencia debe empezar por ${READ_ONLY_PREFIXES.join(' o ')} (solo se permiten consultas de lectura).`)
  }
}

function collectDangerousKeywordErrors(statement: string, errors: string[]): void {
  for (const keyword of DANGEROUS_KEYWORDS) {
    if (containsWord(keyword, statement)) {
      errors.push(`Palabra no permitida: "${keyword}". Solo se admiten consultas de solo lectura.`)
    }
  }
}

function collectInjectionErrors(statement: string, errors: string[]): void {
  // Permito un único ";" final; cualquier otro indica varias sentencias.
  const withoutTrailingSemicolon = statement.replace(/;\s*$/, '')
  if (withoutTrailingSemicolon.includes(';')) {
    errors.push('No se permiten varias sentencias en una sola consulta (";").')
  }
  if (withoutTrailingSemicolon.includes('--')) {
    errors.push('No se permiten comentarios de línea ("--").')
  }
  if (withoutTrailingSemicolon.includes('/*') || withoutTrailingSemicolon.includes('*/')) {
    errors.push('No se permiten comentarios de bloque ("/* */").')
  }
}
