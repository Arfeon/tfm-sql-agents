# Guía paso a paso (instalación manual)

De cero a la primera consulta **sin tocar Docker**: el propio programa comprueba y
levanta su infraestructura, y te va guiando — tú solo respondes que sí. Cada paso
termina con un *"deberías ver"* para que sepas que vas bien.

Es la misma instalación que hace el [instalador de un comando](instalacion.md#instalación-en-un-comando),
pero **hecha a mano**, viendo cada paso — útil si prefieres controlar cada pieza o
quieres entender qué hay detrás. Si solo quieres el comando rápido, o buscas la
demo solo con Docker o la vía avanzada, vuelve al [índice de instalación](instalacion.md).

Todo funciona igual en **Windows, Linux y macOS**; donde hay alguna diferencia
(terminal, permisos, rutas), la guía lo señala en el momento.

## 1. Instala los requisitos (una sola vez)

- **Docker** — para levantar PostgreSQL y Neo4j sin instalarlos a mano (ver la nota
  de tu sistema operativo justo abajo).
- **Node.js 20 o superior** — https://nodejs.org (la versión LTS vale).
- **Git** — https://git-scm.com

Comprueba que responden:

```bash
docker --version
node --version
```

**Deberías ver** dos números de versión (p. ej. `Docker version 27...` y `v20...` o
superior). Si alguno falla, revisa esa instalación antes de seguir.

### Notas por sistema operativo

**Windows**
- **Docker Desktop** (https://www.docker.com/products/docker-desktop/): instálalo, ábrelo
  y espera a que el icono diga **"Engine running"**. Pide **WSL2** — es requisito del
  propio Docker; si te lo reclama, `wsl --install` en una consola como administrador,
  reinicia y vuelve a abrir Docker Desktop.
- **Abre el proyecto en PowerShell o en Windows Terminal**, **no en Git Bash**. Git Bash
  se come los colores y puede romper los menús de flechas (no es un terminal nativo de
  Windows). En PowerShell verás la interfaz completa.

**macOS**
- **Docker Desktop** (https://www.docker.com/products/docker-desktop/): instálalo y
  ábrelo. La terminal nativa (Terminal o iTerm) va perfecta, sin nada extra.

**Linux** — el entorno más suave (es el objetivo de despliegue del proyecto):
- **Docker Engine + Compose v2** (no hace falta Docker Desktop): sigue
  https://docs.docker.com/engine/install/.
- Añade tu usuario al grupo `docker` (`sudo usermod -aG docker $USER` y reinicia la
  sesión) para no necesitar `sudo`. Si no, los comandos `docker` fallan con *"permission
  denied"* — y el programa lo verá como *"Docker no está en marcha"*, que despista.
- Terminal nativa, colores y menús sin problemas.

## 2. Descarga el proyecto y prepara la configuración

```bash
git clone https://github.com/Arfeon/tfm-sql-agents.git
cd tfm-sql-agents
cp .env.example .env
cp descriptions/descriptions.example.json descriptions/descriptions.json
```

Los comandos valen tal cual en cualquier sistema: en Windows, PowerShell entiende
`cp` y las barras `/` sin cambiar nada.

El segundo `cp` activa las **descripciones de tablas** de la base de prueba: mejoran
mucho la búsqueda (verás por qué cuando preguntes por la "lista de deseos" y el
sistema encuentre una tabla llamada `t_042`).

El `.env` ya viene listo para las bases de demo **arcadia** y **nebula**: los nombres,
las conexiones y las contraseñas (un valor local por defecto) están puestos y funcionan
tal cual — no toques nada de eso. Lo **único** que tienes que configurar es el
**proveedor de IA**. Dos opciones:

**a) Nube (OpenAI)** — la rápida. Pega tu clave y listo (el resto ya viene puesto):

```ini
OPENAI_API_KEY=sk-...
```

**b) 100% local (LM Studio)** — sin coste y sin que nada salga de tu máquina:
instala https://lmstudio.ai, descarga y carga **a la vez** un modelo de chat
(recomendado: `Qwen2.5-Coder-14B`) y uno de embeddings (`bge-m3`), arranca su
servidor local, y en el `.env` cambia:

```ini
LLM_PROVIDER=local
EMBEDDING_PROVIDER=local
```

## 3. Arranca — el programa hace el resto

```bash
cd backend
npm install
npm start
```

La primera vez detecta que no hay nada montado y se ofrece a montarlo. Responde
que sí y espera **en torno a un minuto** (la primerísima vez se suma la descarga
de las imágenes de Docker, que depende de tu conexión; luego, segundos). No te
preocupes por el tiempo: el programa enseña el progreso en directo y, mientras
vea actividad, sigue esperando.

**Deberías ver**, en este orden:

```
⚠ Los contenedores de GraphSQL (Postgres y Neo4j) todavía no existen.
? ¿Los levanto ahora con la configuración por defecto? (Y/n)   ← di que sí

Levantando la infraestructura. El primer arranque carga las bases de datos...
⠹ Esperando a graphsql_neo4j (0:38)
✔ Postgres y Neo4j healthy (0:52).

╭──────────────────────────────────────╮
│  ✔ Infraestructura lista             │
╰──────────────────────────────────────╯
? ¿Arranco GraphSQL? (Y/n)                                     ← di que sí
```

Si la carga se queda **parada de verdad** (2 minutos sin actividad), el programa
te enseña las últimas líneas del log y te deja elegir: seguir esperando, reiniciar
desde cero o salir a mirarlo a mano.

> ¿Dice **"Docker no está en marcha"**? Abre Docker Desktop, espera el
> "Engine running" y responde que sí al "¿Lo compruebo otra vez?".

Después elige tu proveedor de IA (sale preseleccionado el del `.env`) y llegas al
menú principal.

### Opcional: el comando `gsql`, para invocarlo desde cualquier carpeta

Si vas a usar GraphSQL a menudo, puedes registrarlo como un comando global y
olvidarte del `cd backend && npm start`:

```bash
cd backend
npm link
```

A partir de ahí, `gsql` desde cualquier terminal y carpeta abre exactamente el
mismo programa que `npm start` (mismo menú, misma configuración del `.env` del
proyecto). Es lo mismo que hace el [instalador de un comando](instalacion.md#instalación-en-un-comando)
cuando le dices que sí al comando global — dónde queda registrado en cada
sistema, cómo comprobarlo y el tema de permisos en Linux están explicados en
[Cómo queda registrado el comando `gsql`](instalacion.md#cómo-queda-registrado-el-comando-gsql).
Para quitarlo: `npm unlink -g graphsql-backend`.

## 4. Escanea el esquema (solo la primera vez)

El menú te marca el camino — las opciones que aún no pueden funcionar salen
apagadas con el motivo al lado:

```
? ¿Qué quieres hacer?
❯ Escanear el esquema de la BD objetivo ← empieza por aquí (primera vez)
- Consultar en lenguaje natural — necesita el esquema escaneado y vectorizado
```

Elige **Escanear** → base **arcadia** → incluye las descripciones (dile que sí) →
confirma. Tarda unos segundos.

**Deberías ver** algo como:

```
✔ Escaneando "postgresql / arcadia" e ingiriendo en Neo4j…
  17 tablas, ... columnas, ... relaciones en Neo4j.
✔ Vectorizando el esquema en pgvector…
  17 tablas vectorizadas (...)
```

Lo importante: **17 tablas** en las dos líneas, y ningún error rojo.

## 5. Tu primera consulta

Menú → **Consultar en lenguaje natural** → escribe:

> ¿Cuántos clientes hay en cada región?

**Deberías ver** dos cajas — la consulta SQL propuesta y el veredicto del Judge — y
un menú para decidir. Elige **Aprobar y ejecutar** y, como el resultado es
"categoría → valor", te ofrecerá verlo como gráfico:

```
Oceania         ████████████████████████████ 883
North America   ██████████████████████████ 835
Europe          █████████████████████████ 823
```

**Listo.** A partir de aquí, la [guía de uso](uso.md) explica cada función (afinar
consultas, la traza de recuperación, los gráficos…).

## Si algo no cuadra

- **Lo veo sin colores, o los menús de flechas no responden** (Windows) → lo abriste en
  Git Bash; ciérralo y ábrelo en **PowerShell o Windows Terminal** (ver la nota de Windows
  arriba). No es un fallo del programa: Git Bash no expone un terminal nativo.
- **"Docker no está en marcha"** → abre Docker Desktop y espera "Engine running" (Windows/Mac);
  en **Linux**, si Docker sí está corriendo, casi seguro es que tu usuario no está en el grupo
  `docker` (`sudo usermod -aG docker $USER` y reinicia sesión). Reintenta.
- **"La infraestructura quedó a medio inicializar"** → pasa si el primer arranque se
  interrumpió (un Ctrl+C durante la carga). El propio programa te ofrece **reiniciarla
  desde cero**: dile que sí y espera (las bases de prueba se regeneran solas).
- **Veo un `FATAL` y Postgres parece reiniciarse al acabar de montarse** (se nota sobre
  todo en Linux, donde los logs de Docker quedan a la vista) → es normal, no es un fallo.
  Para el init, Postgres levanta un servidor temporal que solo escucha por socket local;
  al terminar lo apaga y arranca el definitivo, ya por red. Los `FATAL` son el healthcheck
  llamando mientras el servidor aún arranca (`the database system is starting up`). Si
  acabó en `healthy`, fue bien.
- **El primer arranque va lento** → en portátiles modestos o con Docker recién
  instalado puede tardar más del minuto habitual. Mientras el progreso en pantalla
  cambie, va bien — el programa no da error por tardar, solo si deja de ver actividad.
- **El puerto 5432, 7474 o 7687 está ocupado** → tienes otro PostgreSQL/Neo4j corriendo
  en tu máquina; cómo resolverlo está en la [guía avanzada](instalacion-avanzada.md).
- **Con LM Studio no responde o va vacío** → asegúrate de tener cargados el modelo de
  chat **y** el de embeddings a la vez, y su servidor arrancado.
- **Error de credenciales con OpenAI** → revisa la `OPENAI_API_KEY` del `.env`.
- **`gsql` no se encuentra tras registrarlo** (Windows) → abre una terminal **nueva** (el
  PATH se lee al abrirla); si sigue sin salir con `where.exe gsql`, revisa que existe
  `%APPDATA%\npm\gsql.cmd`. En **Linux**, `which gsql` y el tema de permisos/prefix está
  en [Cómo queda registrado el comando `gsql`](instalacion.md#cómo-queda-registrado-el-comando-gsql).
- Cualquier otra cosa → [guía avanzada](instalacion-avanzada.md), sección de problemas
  frecuentes.
