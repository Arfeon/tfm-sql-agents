/**
 * Error de dominio: el juez LLM (SPEC-06) respondió algo que no puedo interpretar
 * como veredicto (ni JSON válido, ni con la forma esperada).
 *
 * Lo trato como error de dominio para que quien combina las comprobaciones pueda
 * decidir qué hacer (la revisión del juez LLM es opcional, así que un veredicto
 * ilegible no debe romper el flujo: la comprobación de seguridad ya lo cubre).
 */
export class JudgeResponseError extends Error {
  constructor(public readonly rawResponse: string) {
    super('La respuesta del juez LLM no es interpretable como veredicto.')
    this.name = 'JudgeResponseError'
  }
}
