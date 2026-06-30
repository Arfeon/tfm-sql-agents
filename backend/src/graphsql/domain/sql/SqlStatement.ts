/**
 * Sentencia SQL generada, con el dialecto del motor para el que se escribió.
 *
 * Llevo el dialecto pegado al texto porque la sintaxis depende del motor de la BD
 * objetivo (PostgreSQL, SQL Server…); así el resto del flujo sabe contra qué
 * dialecto se generó.
 */
export interface SqlStatement {
  text: string
  dialect: string
}
