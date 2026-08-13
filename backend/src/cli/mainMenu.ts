/**
 * Menú principal del CLI. La construcción de las opciones es una función pura
 * sobre el estado del índice vectorial, para poder probarla sin terminal: la
 * primera vez (sin esquema escaneado) el menú guía hacia el escaneo y deshabilita
 * lo que no puede funcionar sin índice, con el motivo a la vista.
 */
import chalk from 'chalk'
import { getIndexedModel } from '../graphsql/application/scan/getIndexedModel'

export type MainAction = 'chat' | 'query' | 'scan' | 'describe' | 'debug' | 'exit'

export interface MainMenuChoice {
  name: string
  value: MainAction
  /** inquirer: string = opción atenuada y no seleccionable, con este texto como motivo. */
  disabled?: string
}

/**
 * true/false = hay índice vectorial o no; null = no lo pude comprobar (pgvector
 * inaccesible). Con null no se deshabilita nada: mejor un error honesto al usar
 * la opción que un cerrojo en falso.
 */
export async function checkVectorIndexExists(): Promise<boolean | null> {
  try {
    return (await getIndexedModel()) !== null
  } catch {
    return null
  }
}

const NEEDS_INDEX = '— necesita el esquema escaneado y vectorizado'

export function buildMainMenuChoices(hasIndex: boolean | null): MainMenuChoice[] {
  if (hasIndex === false) {
    return [
      { name: `Escanear el esquema de la BD objetivo ${chalk.yellow('← empieza por aquí (primera vez)')}`, value: 'scan' },
      { name: 'Generar descripciones de tablas con IA', value: 'describe' },
      { name: 'Consultar en lenguaje natural (con revisión humana)', value: 'query', disabled: NEEDS_INDEX },
      { name: 'Depurar recuperación (ver el circuito)', value: 'debug', disabled: NEEDS_INDEX },
      { name: 'Salir', value: 'exit' },
    ]
  }
  return [
    { name: 'Consultar en lenguaje natural (con revisión humana)', value: 'query' },
    { name: 'Escanear el esquema de la BD objetivo', value: 'scan' },
    { name: 'Generar descripciones de tablas con IA', value: 'describe' },
    { name: 'Depurar recuperación (ver el circuito)', value: 'debug' },
    { name: 'Salir', value: 'exit' },
  ]
}
