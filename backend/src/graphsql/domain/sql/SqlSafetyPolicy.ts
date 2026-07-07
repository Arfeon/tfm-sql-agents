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

  const errors: string[] = []
  collectPrefixError(statement, errors)
  collectDangerousKeywordErrors(statement, errors)
  collectInjectionErrors(statement, errors)

  return errors.length === 0 ? validVerdict() : invalidVerdict(errors)
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
