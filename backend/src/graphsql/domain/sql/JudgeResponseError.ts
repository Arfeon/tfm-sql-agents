/**
 * El juez LLM (SPEC-06) respondió algo no interpretable como veredicto. Un veredicto
 * ilegible no debe romper el flujo: la comprobación de seguridad ya lo cubre.
 */
export class JudgeResponseError extends Error {
  constructor(public readonly rawResponse: string) {
    super('La respuesta del juez LLM no es interpretable como veredicto.')
    this.name = 'JudgeResponseError'
  }
}
