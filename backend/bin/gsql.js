#!/usr/bin/env node
/**
 * Lanzador del comando global `gsql`, registrado con el campo "bin" del package.json.
 * Instalación: `npm link` desde backend/ (crea el comando en la carpeta global de npm,
 * en Windows %APPDATA%\npm, que ya está en el PATH). Desinstalar: `npm unlink -g`.
 *
 * npm instala el paquete global como enlace (symlink/junction) al repo; el realpath
 * lo deshace para lanzar tsx sobre el código fuente real, y así las rutas internas
 * (agents/, descriptions/, docker-compose.yml) resuelven hacia la raíz del proyecto.
 */
const { realpathSync } = require('node:fs')
const { spawn } = require('node:child_process')
const { join, dirname } = require('node:path')

const backendDir = dirname(dirname(realpathSync(__filename)))
const mainScript = join(backendDir, 'src', 'cli', 'main.ts')
const tsxCli = require.resolve('tsx/cli', { paths: [backendDir] })

console.log('Arrancando GraphSQL... (la primera carga de tsx tarda unos segundos)')

const child = spawn(process.execPath, [tsxCli, mainScript], { stdio: 'inherit' })
child.on('exit', (code) => process.exit(code ?? 0))
