/**
 * Error de dominio: se intentó ejecutar una consulta que no es de solo lectura (SPEC-07).
 *
 * Es la invariante de seguridad: justo antes de ejecutar, el ejecutor vuelve a pasar
 * la comprobación de seguridad. Si una consulta peligrosa llegara hasta aquí (algo
 * se saltó las comprobaciones previas), lanzo este error y NO toco la base de datos.
 */
export class UnsafeQueryError extends Error {
  constructor(public readonly reasons: string[]) {
    super(`Consulta rechazada por seguridad, no se ejecuta: ${reasons.join('; ')}`)
    this.name = 'UnsafeQueryError'
  }
}
