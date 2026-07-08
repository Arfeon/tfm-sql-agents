# Herramientas CLI para la interfaz de consola

- **Fecha**: 2026-06-23
- **Objetivo**: identificar las herramientas Node/TS más adecuadas para construir la CLI interactiva del sistema — la interfaz por la que el usuario escribe preguntas en lenguaje natural y ve los resultados.

## Candidatos evaluados

### Interacción con el usuario

**`@inquirer/prompts`** —  Cada tipo de prompt es un paquete independiente (`input`, `select`, `confirm`, `checkbox`…), lo que evita instalar código que no uso. API basada en promesas, tipado TypeScript nativo. Es el estándar de facto para CLIs interactivas en el ecosistema Node moderno.

```ts
import { input, select } from '@inquirer/prompts'

const question = await input({ message: '¿Qué quieres consultar?' })
const mode = await select({ message: 'Modo', choices: ['sql', 'explain'] })
```

### Color y estilos de texto

**`picocolors`** — la alternativa minimalista a `chalk`. Sin dependencias, ~6 KB, misma API de encadenamiento. Ideal para colorear mensajes de estado (verde = OK, rojo = error, amarillo = warning) sin añadir peso al bundle.

```ts
import pc from 'picocolors'
console.log(pc.green('✓ Consulta ejecutada') + pc.gray(` (${ms}ms)`))
```

### Indicadores de progreso / spinners

**`ora`** — spinner elegante para operaciones asíncronas (llamada al agente, consulta a la BD). Soporta texto dinámico, colores y estados finales (`succeed`, `fail`, `warn`). Ampliamente mantenido y con tipos TS incluidos.

```ts
import ora from 'ora'
const spinner = ora('Generando SQL…').start()
// ... await agente ...
spinner.succeed('SQL generado')
```

### Cajas y layout de texto

**`boxen`** — envuelve texto en un recuadro configurable (bordes, padding, color, alineación). Útil para mostrar el SQL generado o el resultado final de forma destacada antes de ejecutarlo.

```ts
import boxen from 'boxen'
console.log(boxen(generatedSql, { title: 'SQL generado', padding: 1, borderColor: 'cyan' }))
```

### Parsing de argumentos de línea de comandos

**`commander`** — el estándar del ecosistema para parsear `argv`. Declaro subcomandos, opciones y flags con tipos TypeScript. Perfecto si el sistema acaba teniendo modos distintos (`query`, `explain`, `validate`…).

```ts
import { Command } from 'commander'

const program = new Command()
program
  .command('query <question>')
  .option('--dry-run', 'muestra el SQL sin ejecutarlo')
  .action(async (question, opts) => { /* … */ })

program.parse()
```

## Comparativa rápida

| Rol | Candidato elegido | Alternativa descartada | Motivo |
|-----|-------------------|------------------------|--------|
| Prompts interactivos | `@inquirer/prompts` | `prompts`, `enquirer` | Modular, mantenido activamente, tipos nativos |
| Colores | `picocolors` | `chalk`, `kleur` | Sin dependencias, API idéntica a chalk |
| Spinner | `ora` | `cli-spinners`, `listr2` | Simple, ampliamente usado, tipos incluidos |
| Cajas / layout | `boxen` | `ink` | Más simple; `ink` es React en terminal, excesivo para el MVP |
| Args CLI | `commander` | `yargs`, `meow` | Más ergonómico en TS, ecosistema enorme |

## Estado

Pendiente de implementar — llego aquí cuando el núcleo de agentes funcione end-to-end. Por ahora los tests de diagnóstico sirven como interfaz mínima de verificación.
