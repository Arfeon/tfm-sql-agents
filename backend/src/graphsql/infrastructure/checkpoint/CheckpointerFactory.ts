/**
 * Factory del checkpointer del grafo: persiste el estado en `graphsql_memory`, de
 * modo que la pausa de la revisión humana sobrevive al proceso (recuperable por thread_id).
 */
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres'
import { loadEnv } from '../config/env'

function memoryConnectionString(env: NodeJS.ProcessEnv = process.env): string {
  const vars = loadEnv(env)
  const user = encodeURIComponent(vars.POSTGRES_USER)
  const password = encodeURIComponent(vars.POSTGRES_PASSWORD)
  return `postgresql://${user}:${password}@${vars.POSTGRES_HOST}:${vars.POSTGRES_PORT}/${vars.POSTGRES_DB}`
}

export class CheckpointerFactory {
  /** Crea sus tablas si no existen; al terminar hay que cerrarlo con `end()`. */
  static async fromEnv(env: NodeJS.ProcessEnv = process.env): Promise<PostgresSaver> {
    const checkpointer = PostgresSaver.fromConnString(memoryConnectionString(env))
    await checkpointer.setup()
    return checkpointer
  }
}
