# Guía de instalación

GraphSQL se puede poner en marcha de cuatro maneras. Esta página es el índice y
también la vía recomendada (el instalador de un comando); las otras tres tienen
su propia guía.

## ¿Qué vía elijo?

| Vía | Para quién | Necesitas | Dónde |
|-----|------------|-----------|-------|
| **Instalador, un comando** (recomendada) | Instalarlo como herramienta y usarlo | Node 20+, Docker, Git | Debajo, en esta misma página |
| **Guiada paso a paso** | Lo mismo, pero viendo (y controlando) cada paso | Node 20+, Docker, Git | [instalacion-paso-a-paso.md](instalacion-paso-a-paso.md) |
| **Demo solo con Docker** | Evaluarlo sin instalar Node (ni clonar el repo) | Docker | [instalacion-docker.md](instalacion-docker.md) |
| **Manual avanzada** | Mirar debajo del capó (compose, verificaciones, regenerar datos) | Node 20+, Docker, Git | [instalacion-avanzada.md](instalacion-avanzada.md) |

Para usar el programa una vez instalado, la [guía de uso](uso.md).

## Instalación en un comando

Un solo comando descarga el proyecto, lo configura y lo deja invocable como `gsql`.
Solo necesitas Git, Node 20+ y Docker (el instalador los comprueba y te avisa si
falta alguno — los detalles de cada requisito, incluidas las notas por sistema
operativo, están en la [guía paso a paso, §1](instalacion-paso-a-paso.md#1-instala-los-requisitos-una-sola-vez)).
Los scripts ([install.ps1](../install.ps1), [install.sh](../install.sh)) están en el
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
   `local` (LM Studio, sin coste y sin que nada salga de tu máquina — los dos
   modelos que necesita están en [Modo local: los modelos de LM Studio](#modo-local-los-modelos-de-lm-studio)).
   Si ya tenías un `.env` de antes, lo respeta tal cual.
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
infraestructura (contenedores y datos de prueba) guiándote — es el mismo arranque
que describe [la guía paso a paso, §3](instalacion-paso-a-paso.md#3-arranca--el-programa-hace-el-resto),
a partir del *"deberías ver"*. Con el programa ya en marcha, cada función
(consultar con revisión, escanear el esquema, depurar la recuperación) está
explicada en la [guía de uso](uso.md).

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

### Actualizar

Vuelve a ejecutar el comando del instalador. Detecta la instalación, hace
`git pull`, actualiza dependencias y conserva tu `.env`.

### Desinstalar

No hay un comando de desinstalación: son tres pasos independientes, y como cada
uno deja rastro en un sitio distinto (Docker, npm, el disco), lo más seguro es
hacerlos a mano, en este orden y desde la carpeta de instalación.

1. **Baja los contenedores y borra sus datos** (Postgres y Neo4j, con el esquema
   escaneado y las bases de prueba):

   ```bash
   docker compose down -v
   ```

   El `-v` es lo que borra los volúmenes; sin él, los contenedores desaparecen
   pero los datos quedan guardados para la próxima vez. Si no piensas volver a
   instalar GraphSQL, este paso es el que de verdad libera espacio en disco.

2. **Quita el comando global `gsql`** (si lo registraste con el instalador o con
   `npm link`):

   ```bash
   npm unlink -g graphsql-backend
   ```

   - **Windows** — esto borra los lanzadores `gsql.cmd`/`gsql.ps1`/`gsql` de
     `%APPDATA%\npm`. Compruébalo con `where.exe gsql`: no debería encontrar nada.
   - **Linux / macOS** — borra el enlace simbólico `gsql` del `bin` de tu prefix
     global de npm (`~/.nvm/versions/node/vXX/bin` con nvm, o el que hayas
     configurado). Compruébalo con `which gsql`.

   Si nunca registraste el comando global, este paso no hace nada (ni falla).

3. **Borra la carpeta de instalación** — el `.git` clonado, el `.env` con tu
   clave de API y todo lo demás. Es una carpeta corriente, así que basta con
   borrarla como cualquier otra:

   - **Windows**: borra la carpeta desde el Explorador, o `Remove-Item -Recurse
     -Force` en PowerShell.
   - **Linux / macOS**: `rm -rf` sobre la carpeta.

   Por defecto es `%LOCALAPPDATA%\GraphSQL` (Windows) o `~/graphsql`
   (Linux/macOS) — o la que hayas elegido al instalar.

El orden importa poco entre el paso 1 y el 2, pero haz el 3 el último: los pasos
1 y 2 necesitan el `docker-compose.yml` y el `package.json` que hay dentro de esa
carpeta.

## Modo local: los modelos de LM Studio

Da igual la vía de instalación: si eliges el proveedor `local`, quien pone los
modelos es [LM Studio](https://lmstudio.ai), que expone en tu máquina una API
compatible con OpenAI — sin coste, sin clave, y sin que ni las preguntas ni el
esquema salgan de tu equipo. El sistema necesita **dos modelos cargados a la
vez** (LM Studio lo permite), porque cada uno hace un trabajo distinto:

| Papel | Modelo que verifiqué | Variable del `.env` |
|-------|----------------------|---------------------|
| **Chat** — razona, escribe y juzga la SQL | `qwen2.5-coder-14b-instruct` (Qwen2.5-Coder-14B) | `LMSTUDIO_MODEL` |
| **Embeddings** — vectoriza el esquema para la búsqueda | `bge-m3`, 1024 dimensiones | `LMSTUDIO_EMBEDDING_MODEL` (`text-embedding-bge-m3`) |

Para dejarlo listo:

1. **Instala LM Studio** y descarga los dos modelos desde su buscador:
   **Qwen2.5-Coder-14B** (instruct) y **bge-m3**.
2. **Cárgalos los dos a la vez** y **arranca el servidor local** (en LM Studio,
   pestaña *Developer* → *Start server*; queda en `http://localhost:1234`, que
   es justo lo que espera el `.env`).
3. En el `.env`, pon `LLM_PROVIDER=local` y `EMBEDDING_PROVIDER=local`. Los
   nombres de modelo ya vienen puestos así en el `.env.example`, no hay que
   tocar nada más.

Notas:

- **Con otros modelos también funciona** (cualquiera que sirva LM Studio), pero
  estos dos son los que verifiqué y con los que medí la evaluación en local. Si
  cambias el de embeddings, ajusta `LMSTUDIO_EMBEDDING_DIMENSIONS` a su
  dimensión y re-escanea el esquema: el índice vectorial se construye con un
  modelo concreto y no se mezcla con otro.
- **Si falta un modelo**, el síntoma típico es que el programa no responde o
  devuelve vacío. El sistema lo comprueba y avisa antes de usarlo, pero la
  solución es siempre la misma: los dos modelos cargados y el servidor en marcha.
- **En la vía de la demo con Docker** hay un matiz de red (el contenedor no ve
  el `localhost` de tu máquina): está resuelto y explicado en
  [su guía](instalacion-docker.md#paso-a-paso).
- Opcional: se puede usar un modelo distinto por rol (uno para razonar qué
  tablas hacen falta, otro para escribir la SQL) con `LMSTUDIO_MODEL_REASONING`
  y `LMSTUDIO_MODEL_GENERATION`; el propio `.env.example` lo documenta.

## Si algo no cuadra

Cada guía tiene su propia sección de problemas frecuentes, adaptada a esa vía:
[guiada paso a paso](instalacion-paso-a-paso.md#si-algo-no-cuadra),
[demo con Docker](instalacion-docker.md#si-algo-no-cuadra) y
[manual avanzada](instalacion-avanzada.md#problemas-frecuentes). Si el instalador
te deja el comando `gsql` sin encontrar, la causa casi siempre es la misma que en
la vía guiada — mira [Cómo queda registrado el comando `gsql`](#cómo-queda-registrado-el-comando-gsql)
más arriba.
