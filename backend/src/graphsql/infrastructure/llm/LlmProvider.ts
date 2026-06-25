/**
 * Proveedores LLM disponibles.
 *
 * Uso un enum para tener en un único sitio la lista cerrada de proveedores que
 * soporto. El valor de cada miembro es la cadena que espero en `LLM_PROVIDER`.
 */
export enum LlmProvider {
  OpenAI = 'openai',
  Local = 'local',
}
