/**
 * Sentencia SQL generada. El dialecto va pegado al texto para que el resto del
 * flujo sepa contra qué motor se generó.
 */
export interface SqlStatement {
  text: string
  dialect: string
}
