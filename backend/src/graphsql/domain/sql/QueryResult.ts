/**
 * Resultado de ejecutar una consulta contra la BD objetivo (SPEC-07).
 *
 * Llevo las columnas y las filas que se devuelven, cuántas son y si se ha truncado
 * al alcanzar el tope (para no inundar el terminal con una consulta enorme). Es lo
 * que la CLI mostrará tras la aprobación humana.
 */
export interface QueryResult {
  /** Nombres de las columnas, en orden. Vacío si la consulta no devuelve filas. */
  columns: string[]
  /** Las filas devueltas (ya recortadas al tope si hubo truncado). */
  rows: Array<Record<string, unknown>>
  /** Número de filas devueltas (las visibles, tras recortar). */
  rowCount: number
  /** `true` si la consulta devolvía más filas que el tope y se recortaron. */
  truncated: boolean
}
