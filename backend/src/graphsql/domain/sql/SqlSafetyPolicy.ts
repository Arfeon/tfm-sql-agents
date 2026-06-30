/**
 * Comprobación de seguridad del Judge (SPEC-06): validación sin LLM, pura y determinista.
 *
 * Es la seguridad por diseño: pase lo que pase con el LLM, una consulta que no sea
 * claramente de solo lectura no debe poder ejecutarse. Compruebo tres cosas:
 *
 *  1. la sentencia empieza por SELECT o WITH (allowlist de solo lectura),
 *  2. no contiene palabras peligrosas de escritura/DDL (DROP, DELETE, …) como
 *     palabra completa y sin distinguir mayúsculas,
 *  3. no trae patrones de inyección (varias sentencias con ";", comentarios
 *     "--" o "/* *\/").
 *
 * Al no depender de nada externo, la pruebo a fondo con una tabla de casos.
 */
import { type QueryVerdict, validVerdict, invalidVerdict } from './QueryVerdict'

/** Una consulta de solo lectura empieza por una de estas palabras. */
export const READ_ONLY_PREFIXES = ['SELECT', 'WITH'] as const

/**
 * Palabras que escriben o cambian el esquema: si aparecen como palabra completa,
 * la consulta deja de ser de solo lectura. Incluyo las del contrato (DROP, DELETE,
 * INSERT, UPDATE, TRUNCATE, ALTER, GRANT) más otras igual de peligrosas.
 */
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

/** Compruebo la seguridad sobre el texto de una sentencia y devuelvo el veredicto. */
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

/** La sentencia tiene que empezar por SELECT o WITH. */
function collectPrefixError(statement: string, errors: string[]): void {
  const startsReadOnly = READ_ONLY_PREFIXES.some((prefix) => new RegExp(`^${prefix}\\b`, 'i').test(statement))
  if (!startsReadOnly) {
    errors.push(`La sentencia debe empezar por ${READ_ONLY_PREFIXES.join(' o ')} (solo se permiten consultas de lectura).`)
  }
}

/** Ninguna palabra peligrosa puede aparecer como palabra completa. */
function collectDangerousKeywordErrors(statement: string, errors: string[]): void {
  for (const keyword of DANGEROUS_KEYWORDS) {
    if (new RegExp(`\\b${keyword}\\b`, 'i').test(statement)) {
      errors.push(`Palabra no permitida: "${keyword}". Solo se admiten consultas de solo lectura.`)
    }
  }
}

/** Detecto patrones típicos de inyección: varias sentencias y comentarios. */
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
