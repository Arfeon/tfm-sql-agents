/**
 * Proveedores de embeddings disponibles.
 *
 * Lo mantengo separado de `LlmProvider` a propósito: puedo querer chatear en
 * local pero vectorizar con OpenAI (o al revés). El valor es la cadena que
 * espero en `EMBEDDING_PROVIDER`.
 */
export enum EmbeddingProvider {
  OpenAI = 'openai',
  Local = 'local',
}
