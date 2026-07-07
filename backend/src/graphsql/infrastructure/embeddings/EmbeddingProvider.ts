/**
 * Proveedores de embeddings; separado de `LlmProvider` a propósito, porque puedo
 * chatear en local y vectorizar con OpenAI (o al revés). Valor esperado en `EMBEDDING_PROVIDER`.
 */
export enum EmbeddingProvider {
  OpenAI = 'openai',
  Local = 'local',
}
