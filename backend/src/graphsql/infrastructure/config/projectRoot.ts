/**
 * Raíz del repo resuelta desde este fichero, NO desde el directorio de ejecución.
 * Antes las rutas a los recursos que viven fuera de backend/ (.env, agents/,
 * descriptions/, docker-compose.yml) eran relativas al cwd y obligaban a arrancar
 * siempre desde backend/; resolverlas desde aquí permite invocar el CLI desde
 * cualquier carpeta (npm start o el comando global `gsql`).
 *
 * El realpath deshace symlinks/junctions: con `npm link`, el paquete global es un
 * enlace al repo, y sin resolverlo `../..` escaparía hacia node_modules global en
 * vez de hacia la raíz real del proyecto.
 */
import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'

export const PROJECT_ROOT = resolve(realpathSync(__dirname), '../../../../..')
