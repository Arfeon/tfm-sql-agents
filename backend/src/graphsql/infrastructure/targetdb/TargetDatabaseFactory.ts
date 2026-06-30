/**
 * Factory de la base de datos objetivo.
 *
 * Es el único sitio que sabe qué adaptador usar para cada motor y cómo conectarse.
 * Devuelve un `ITargetDatabase` ya conectado (en solo lectura), de modo que los
 * casos de uso dependen solo de la abstracción y no construyen clientes a mano ni
 * discriminan el tipo de motor. Mismo patrón que `ChatModelFactory` o `EmbeddingsFactory`.
 */
import { PostgresTargetDatabase } from '../postgres/PostgresTargetDatabase'
import { loadTargetDatabases, type TargetDatabaseConfig } from '../config/targetDatabases'
import type { ITargetDatabase } from '../../domain/ports/ITargetDatabase'

export interface TargetDatabaseSessionOptions {
  /** Límite de tiempo por consulta, en ms; lo aplica el adaptador a su sesión. */
  statementTimeoutMs?: number
}

export const TargetDatabaseFactory = {
  /** Conecta con una BD objetivo concreta, eligiendo el adaptador según su tipo. */
  async connect(
    target: TargetDatabaseConfig,
    options: TargetDatabaseSessionOptions = {},
  ): Promise<ITargetDatabase> {
    switch (target.type) {
      case 'postgresql':
        return PostgresTargetDatabase.fromParams(
          {
            host: target.host,
            port: target.port,
            database: target.name,
            user: target.user,
            password: target.password,
          },
          { statementTimeoutMs: options.statementTimeoutMs },
        )
      default:
        throw new Error(`BD objetivo no soportada todavía: "${target.type}". De momento solo PostgreSQL.`)
    }
  },

  /** Conecta con la primera BD objetivo declarada en el entorno. */
  connectDefault(options: TargetDatabaseSessionOptions = {}): Promise<ITargetDatabase> {
    return this.connect(loadTargetDatabases()[0], options)
  },
}
