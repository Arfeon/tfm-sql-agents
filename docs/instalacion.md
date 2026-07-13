# Guía de instalación

De cero a la primera consulta **sin tocar Docker**: el propio programa comprueba y
levanta su infraestructura, y te va guiando — tú solo respondes que sí. Cada paso
termina con un *"deberías ver"* para que sepas que vas bien.

Todo funciona igual en **Windows, Linux y macOS**; donde hay alguna diferencia
(terminal, permisos, rutas), la guía lo señala en el momento.

## ¿Qué vía elijo?

Hay cuatro maneras de poner GraphSQL en marcha:

| Vía | Para quién | Necesitas | Dónde |
|-----|------------|-----------|-------|
| **Instalador, un comando** (recomendada) | Instalarlo como herramienta y usarlo | Node 20+, Docker, Git | [Justo debajo](#instalación-en-un-comando) |
| **Guiada paso a paso** | Lo mismo, pero viendo (y controlando) cada paso | Node 20+, Docker, Git | Esta guía, §1–§5 |
| **Demo solo con Docker** | Evaluarlo sin instalar Node (ni clonar el repo) | Docker | [Sección al final](#alternativa-la-demo-solo-con-docker-sin-instalar-node) |
| **Manual avanzada** | Mirar debajo del capó (compose, verificaciones, regenerar datos) | Node 20+, Docker, Git | [Guía avanzada](instalacion-avanzada.md) |

Para usar el programa una vez instalado, la [guía de uso](uso.md).

## Instalación en un comando

Un solo comando descarga el proyecto, lo configura y lo deja invocable como `gsql`.
Solo necesitas los [requisitos del §1](#1-instala-los-requisitos-una-sola-vez) (Git,
Node 20+ y Docker); el instalador los comprueba y te avisa si falta alguno. Los
scripts ([install.ps1](../install.ps1), [install.sh](../install.sh)) están en el
repo y se leen en dos minutos: nada de binarios opacos.

**Windows** — abre PowerShell (no Git Bash) y pega:

```powershell
irm https://raw.githubusercontent.com/Arfeon/tfm-sql-agents/main/install.ps1 | iex
```

**Linux / macOS** — en tu terminal:

```bash
curl -fsSL https://raw.githubusercontent.com/Arfeon/tfm-sql-agents/main/install.sh | bash
```

(`irm`/`curl` descargan el script del repo de GitHub y lo ejecutan directamente;
es el mismo patrón de instalación que usan nvm o rustup.)

### Qué hace, paso a paso

Todas las preguntas traen un valor por defecto sensato: **Enter y sigue**.

1. **Comprueba los requisitos.** Git y Node 20+ son imprescindibles: si falta uno,
   se para y te dice de dónde instalarlo. Docker solo genera un aviso — puedes
   terminar la instalación sin él, porque quien lo necesita es el programa al
   arrancar, no el instalador.
2. **Pregunta dónde instalarlo** — por defecto `%LOCALAPPDATA%\GraphSQL` en
   Windows, `~/graphsql` en Linux/macOS.
3. **Descarga el proyecto ahí** (`git clone`). Si esa carpeta ya tiene una
   instalación de GraphSQL, en vez de clonar la actualiza (`git pull`): **volver a
   ejecutar el instalador es la forma de actualizar**. Si la carpeta existe con
   otra cosa dentro, se para sin tocar nada.
4. **Prepara la configuración.** Crea el `.env` desde el ejemplo y te pregunta el
   proveedor de IA: `openai` (te pide la clave y la escribe en el `.env`) o
   `local` (LM Studio, sin coste y sin que nada salga de tu máquina). Si ya
   tenías un `.env` de antes, lo respeta tal cual.
5. **Instala las dependencias** (`npm install`, solo en `backend/`).
6. **Ofrece registrar el comando global `gsql`** (di que sí; abajo explico qué
   hace exactamente).

**Deberías ver** al final:

```
  GraphSQL instalado.

  Instalado en:  C:\Users\tu-usuario\AppData\Local\GraphSQL
  Para arrancar: gsql        (o: cd backend; npm start, desde esa carpeta)
```

Y de ahí, escribe `gsql`: la primera vez, el propio programa monta su
infraestructura (contenedores y datos de prueba) guiándote — continúa en el
[§3 de esta guía](#3-arranca--el-programa-hace-el-resto), a partir del *"deberías
ver"*.

### Cómo queda registrado el comando `gsql`

No hay magia: el proyecto declara el comando en su `package.json` (campo `"bin"`)
y el instalador ejecuta `npm link`, el mecanismo estándar de npm para registrar
CLIs. Lo que hace en cada sistema:

- **Windows** — npm crea tres lanzadores (`gsql.cmd`, `gsql.ps1` y `gsql`) en su
  carpeta global, `%APPDATA%\npm`. Esa carpeta ya está en tu PATH desde que
  instalaste Node, así que cualquier terminal nueva encuentra el comando. Los
  lanzadores apuntan, a través de un enlace en `%APPDATA%\npm\node_modules`, al
  código del proyecto en tu carpeta de instalación. Compruébalo con:

  ```powershell
  where.exe gsql        # → C:\Users\...\AppData\Roaming\npm\gsql.cmd
  ```

- **Linux / macOS** — npm crea un enlace simbólico `gsql` en el `bin` de su
  prefix global (con nvm: `~/.nvm/versions/node/vXX/bin`, ya en el PATH), que
  apunta igualmente al código del proyecto. Compruébalo con `which gsql`. Si
  usas el Node del sistema (apt/dnf), el prefix es `/usr/local` y `npm link`
  puede fallar por permisos; la salida limpia es un prefix de usuario:

  ```bash
  npm config set prefix ~/.local     # y añade ~/.local/bin al PATH
  cd ~/graphsql/backend && npm link  # reintenta
  ```

El detalle importante: es un **enlace**, no una copia. El comando `gsql` ejecuta
directamente el código de tu carpeta de instalación, así que cuando el proyecto
se actualiza (re-ejecutando el instalador o con `git pull`), `gsql` ya es la
versión nueva sin reinstalar nada.

### Actualizar y desinstalar

- **Actualizar**: vuelve a ejecutar el comando del instalador. Detecta la
  instalación, hace `git pull`, actualiza dependencias y conserva tu `.env`.
- **Desinstalar**: `npm unlink -g graphsql-backend` (quita el comando `gsql`) y
  borra la carpeta de instalación. Los contenedores y sus datos se quitan aparte,
  si quieres: `docker compose down -v` desde esa carpeta antes de borrarla.

> El resto de la guía (§1–§5) es esta misma instalación **hecha a mano**, con un
> *"deberías ver"* en cada paso — útil si prefieres controlar cada pieza o si el
> instalador te avisa de algo que quieres entender.

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
proyecto). Es lo mismo que hace el instalador cuando le dices que sí al comando
global — dónde queda registrado en cada sistema, cómo comprobarlo y el tema de
permisos en Linux están explicados en
[Cómo queda registrado el comando `gsql`](#cómo-queda-registrado-el-comando-gsql).
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

## Alternativa: la demo solo con Docker (sin instalar Node)

Esta vía es para **evaluar la demo sin instalar nada más que Docker**: ni Node,
ni Git, ni clonar el repo. La aplicación entera corre dentro de un contenedor.

### Qué te vas a descargar (y de dónde)

El sistema son tres contenedores, y sus imágenes ya están construidas y publicadas
en Docker Hub — **no tienes que hacer `docker pull` ni `docker build` a mano**, el
propio compose las descarga la primera vez:

| Imagen | Qué es | De dónde |
|--------|--------|----------|
| [`pclota/graphsql-cli`](https://hub.docker.com/r/pclota/graphsql-cli) | **La aplicación**: el CLI completo, con sus dependencias y la configuración de demo | Docker Hub |
| [`pclota/graphsql-postgres-demo`](https://hub.docker.com/r/pclota/graphsql-postgres-demo) | **La base de datos**: PostgreSQL + pgvector que, en su primer arranque, se carga solo las bases de prueba (arcadia y nebula, datos sintéticos) | Docker Hub |
| `neo4j:5-community` | El grafo de conocimiento; imagen oficial de Neo4j, tal cual | Docker Hub |

Lo único que descargas tú a mano es **un fichero de texto**,
`docker-compose.hub.yml`: la pieza que conecta los tres contenedores (red interna,
credenciales, orden de arranque). Sin él tendrías que arrancar y cablear los tres
a mano; con él, es un comando.

### Paso a paso

**1. Docker en marcha.** Docker Desktop con "Engine running" en Windows/Mac;
Docker Engine + Compose v2 y tu usuario en el grupo `docker` en Linux (las notas
de cada sistema están en el [§1](#notas-por-sistema-operativo)).

**2. Descarga el fichero compose** en una carpeta cualquiera (vacía, por ejemplo
`graphsql-demo`):

```bash
# Linux / macOS
curl -fsSL -O https://raw.githubusercontent.com/Arfeon/tfm-sql-agents/main/docker-compose.hub.yml
```

```powershell
# Windows (PowerShell)
irm -OutFile docker-compose.hub.yml https://raw.githubusercontent.com/Arfeon/tfm-sql-agents/main/docker-compose.hub.yml
```

**Deberías ver** el fichero en la carpeta (`ls`): es la única "instalación" de
esta vía.

**3. Tu proveedor de IA.** Si vas a usar OpenAI, exporta la clave en esa misma
terminal (el compose se la pasa al contenedor):

```bash
export OPENAI_API_KEY=sk-...           # Linux / macOS
```

```powershell
$env:OPENAI_API_KEY = "sk-..."         # Windows (PowerShell)
```

Si prefieres **LM Studio** (gratis y offline), no exportes nada: arranca su
servidor en tu máquina con el modelo de chat y el de embeddings cargados, y elige
"Local" en el menú del programa. Ojo: el contenedor no puede ver `localhost` de tu
máquina — la aplicación ya viene configurada para alcanzarlo en
`http://host.docker.internal:1234/v1`, pero en LM Studio activa la opción de
**servir en la red local** si no responde.

**4. Arranca:**

```bash
docker compose -f docker-compose.hub.yml run --rm cli
```

La primera vez hace tres cosas seguidas, y tarda unos minutos según tu conexión:
descarga las tres imágenes (~600 MB en total), arranca Postgres y Neo4j (Postgres
se carga las bases de prueba en este primer arranque) y espera a que los dos estén
sanos. Después abre el programa.

**Deberías ver**, tras las líneas de descarga:

```
 Container graphsql-demo-postgres-1  Started
 Container graphsql-demo-neo4j-1  Started
   ____                 _     ____   ___  _
  / ___|_ __ __ _ _ __ | |__ / ___| / _ \| |     ...
  Tu agente de SQL en lenguaje natural

? ¿Con qué proveedor de LLM quieres trabajar en esta sesión?
```

Elige proveedor y estás en el mismo menú que en cualquier otra instalación: el
programa te marca que empieces por **Escanear el esquema** — sigue por el
[§4](#4-escanea-el-esquema-solo-la-primera-vez).

### El día a día de esta vía

- **Volver a entrar**: el mismo `docker compose -f docker-compose.hub.yml run --rm cli`.
  Las imágenes ya están descargadas y las bases cargadas: segundos.
- **Al salir del programa**, Postgres y Neo4j siguen en marcha (y tu esquema
  escaneado persiste en los volúmenes de Docker). Para pararlos:
  `docker compose -f docker-compose.hub.yml down`.
- **Empezar de cero** (borra bases de prueba e índice):
  `docker compose -f docker-compose.hub.yml down -v`.

### Consultar tu propia base de datos

Las bases de demo sirven para comprobar que todo funciona; lo interesante es
apuntar a la tuya. No hay que tocar ninguna imagen: se añade como variables de
entorno del servicio `cli`, editando el `docker-compose.hub.yml` que descargaste:

```yaml
  cli:
    environment:
      # ... lo que ya está ...
      TARGET_DB_3_TYPE: postgresql          # o mssql
      TARGET_DB_3_HOST: host.docker.internal # si corre en tu máquina; si no, su host
      TARGET_DB_3_PORT: "5432"
      TARGET_DB_3_NAME: tu_base_de_datos
      TARGET_DB_3_SCHEMA: public
      TARGET_DB_3_USER: un_usuario_de_solo_lectura
      TARGET_DB_3_PASSWORD: su-password
```

Al volver a entrar, tu base aparece en el menú junto a las de demo. Recomendación:
un usuario de base de datos **de solo lectura** — el programa ya ejecuta todo en
sesiones read-only, pero la última barrera debe estar en el motor.

### Si estás tocando el código

La misma demo se puede construir desde el repo en vez de usar las imágenes
publicadas (es lo que hago yo en desarrollo): `git clone`, `cp .env.example .env`,
y `docker compose --profile demo build && docker compose --profile demo run --rm cli`
desde la raíz. El profile `demo` existe para eso: el `docker compose up -d` normal
del repo no toca el contenedor de la aplicación.

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
- **El primer arranque va lento** → en portátiles modestos o con Docker recién
  instalado puede tardar más del minuto habitual. Mientras el progreso en pantalla
  cambie, va bien — el programa no da error por tardar, solo si deja de ver actividad.
- **El puerto 5432, 7474 o 7687 está ocupado** → tienes otro PostgreSQL/Neo4j corriendo
  en tu máquina; cómo resolverlo está en la [guía avanzada](instalacion-avanzada.md).
- **Con LM Studio no responde o va vacío** → asegúrate de tener cargados el modelo de
  chat **y** el de embeddings a la vez, y su servidor arrancado. En la **vía Docker**,
  además, activa en LM Studio la opción de servir en la red local (el contenedor no ve
  tu `localhost`).
- **Error de credenciales con OpenAI** → revisa la `OPENAI_API_KEY` del `.env`. En la
  **vía Docker** no hay `.env`: la clave se exporta en la terminal (`export OPENAI_API_KEY=...`
  o `$env:OPENAI_API_KEY = "..."`) **antes** del `docker compose run`, y en esa misma
  terminal.
- **`gsql` no se encuentra tras instalar** (Windows) → abre una terminal **nueva** (el
  PATH se lee al abrirla); si sigue sin salir con `where.exe gsql`, revisa que existe
  `%APPDATA%\npm\gsql.cmd`. En **Linux**, `which gsql` y el tema de permisos/prefix está
  en [Cómo queda registrado el comando `gsql`](#cómo-queda-registrado-el-comando-gsql).
- Cualquier otra cosa → [guía avanzada](instalacion-avanzada.md), sección de problemas
  frecuentes.
