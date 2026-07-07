/**
 * Factory de la BD objetivo: el único sitio que elige adaptador por motor. Devuelve
 * un `ITargetDatabase` ya conectado en solo lectura.
 */
import { PostgresTargetDatabase } from '../postgres/PostgresTargetDatabase'
import { loadTargetDatabases, type TargetDatabaseConfig } from '../config/targetDatabases'
import type { ITargetDatabase } from '../../domain/ports/ITargetDatabase'

export interface TargetDatabaseSessionOptions {
  /** Límite de tiempo por consulta, en ms. */
  statementTimeoutMs?: number
}

export const TargetDatabaseFactory = {
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
