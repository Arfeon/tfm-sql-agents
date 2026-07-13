/**
 * Catálogo único de las variables de entorno del backend, validado con zod: aquí viven
 * el nombre, el default y el formato de cada variable estática. Las numeradas por BD
 * objetivo (TARGET_DB_N_*) las gestiona targetDatabases.ts aparte, porque sus claves
 * son dinámicas. Los valores de enum (LLM_PROVIDER, EMBEDDING_PROVIDER) se transportan
 * como texto y los valida cada factory contra su enum, que da el mensaje con las opciones.
 *
 * `loadEnv` se evalúa en cada llamada, nada de singleton al importar: el selector del
 * CLI muta `process.env.LLM_PROVIDER` en caliente y las factories deben ver el cambio,
 * y los tests inyectan su propio `env`.
 */
import { z } from 'zod'

/** Entero positivo escrito en una variable (p. ej. "1536"). */
const positiveInt = z.coerce.number().int().positive()

const envSchema = z.object({
  // Neo4j: grafo del esquema.
  NEO4J_URI: z.string().default('neo4j://localhost:7687'),
  NEO4J_USER: z.string().default('neo4j'),
  NEO4J_PASSWORD: z.string().default('neo4j'),
  NEO4J_DATABASE: z.string().default('neo4j'),

  // PostgreSQL de memoria: embeddings (pgvector) y checkpoints del grafo.
  POSTGRES_HOST: z.string().default('localhost'),
  POSTGRES_PORT: positiveInt.default(5432),
  POSTGRES_DB: z.string().default('graphsql_memory'),
  POSTGRES_USER: z.string().default('postgres'),
  POSTGRES_PASSWORD: z.string().default('postgres'),

  // LLM de chat.
  LLM_PROVIDER: z.string().optional(),
  LLM_TEMPERATURE: z.coerce.number().min(0).max(2).optional(),
  OPENAI_API_KEY: z.string().default(''),
  OPENAI_MODEL: z.string().optional(),
  OPENAI_MODEL_REASONING: z.string().optional(),
  OPENAI_MODEL_GENERATION: z.string().optional(),
  LMSTUDIO_BASE_URL: z.string().default('http://localhost:1234/v1'),
  LMSTUDIO_API_KEY: z.string().default('lm-studio'),
  LMSTUDIO_MODEL: z.string().optional(),
  LMSTUDIO_MODEL_REASONING: z.string().optional(),
  LMSTUDIO_MODEL_GENERATION: z.string().optional(),

  // Embeddings.
  EMBEDDING_PROVIDER: z.string().optional(),
  OPENAI_EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),
  OPENAI_EMBEDDING_DIMENSIONS: positiveInt.default(1536),
  LMSTUDIO_EMBEDDING_MODEL: z.string().default('text-embedding-bge-m3'),
  LMSTUDIO_EMBEDDING_DIMENSIONS: positiveInt.default(1024),

  // Varios.
  GRAPHSQL_SKIP_INFRA_PREFLIGHT: z
    .string()
    .optional()
    .transform((value) => value === 'true'),
})

export type BackendEnv = z.infer<typeof envSchema>

/**
 * Lee y valida el entorno. Una variable presente pero mal formada (p. ej. una dimensión
 * no numérica) falla aquí con un error claro, en vez de propagar un NaN silencioso.
 * Una variable vacía (`VAR=` en el .env) se trata como no puesta: aplica su default.
 */
export function loadEnv(env: NodeJS.ProcessEnv = process.env): BackendEnv {
  const withoutEmpty = Object.fromEntries(Object.entries(env).filter(([, value]) => value !== undefined && value !== ''))
  const parsed = envSchema.safeParse(withoutEmpty)
  if (!parsed.success) {
    throw new Error(`Variables de entorno inválidas:\n${z.prettifyError(parsed.error)}`)
  }
  return parsed.data
}
