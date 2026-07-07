/**
 * Última barrera de seguridad (SPEC-07): si una consulta que no es de solo lectura
 * llega al ejecutor, lanzo este error y NO toco la base de datos.
 */
export class UnsafeQueryError extends Error {
  constructor(public readonly reasons: string[]) {
    super(`Consulta rechazada por seguridad, no se ejecuta: ${reasons.join('; ')}`)
    this.name = 'UnsafeQueryError'
  }
}
