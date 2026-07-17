# Instalación con Docker (sin instalar Node)

Esta vía es para **evaluar la demo sin instalar nada más que Docker**: ni Node,
ni Git, ni clonar el repo. La aplicación entera corre dentro de un contenedor.
Si en cambio quieres trabajar con el proyecto (editar código, usarlo a diario),
mejor el [instalador de un comando](instalacion.md#instalación-en-un-comando)
o la [guía paso a paso](instalacion-paso-a-paso.md).

## Qué te vas a descargar (y de dónde)

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

Ojo: no son "dos imágenes a elegir" ni versiones alternativas — las tres se usan
**a la vez**, cada una con su papel (aplicación / base de datos / grafo). El
compose las levanta juntas en una sola orden.

## Paso a paso

**1. Docker en marcha.** Docker Desktop con "Engine running" en Windows/Mac;
Docker Engine + Compose v2 y tu usuario en el grupo `docker` en Linux (el
[detalle por sistema operativo está en la guía paso a paso](instalacion-paso-a-paso.md#notas-por-sistema-operativo)).

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
servidor en tu máquina con el modelo de chat y el de embeddings cargados **a la
vez** — los dos verificados son `Qwen2.5-Coder-14B` y `bge-m3`; el detalle está en
[Modo local: los modelos de LM Studio](instalacion.md#modo-local-los-modelos-de-lm-studio) —
y elige "Local" en el menú del programa. Ojo: el contenedor no puede ver `localhost` de tu
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
programa te marca que empieces por **Escanear el esquema** — sigue por
[§4 de la guía paso a paso](instalacion-paso-a-paso.md#4-escanea-el-esquema-solo-la-primera-vez)
(el menú es idéntico, da igual la vía por la que hayas llegado). Y para el resto
de funciones, la [guía de uso](uso.md).

## El día a día de esta vía

- **Volver a entrar**: el mismo `docker compose -f docker-compose.hub.yml run --rm cli`.
  Las imágenes ya están descargadas y las bases cargadas: segundos.
- **Al salir del programa**, Postgres y Neo4j siguen en marcha (y tu esquema
  escaneado persiste en los volúmenes de Docker). Para pararlos:
  `docker compose -f docker-compose.hub.yml down`.
- **Empezar de cero** (borra bases de prueba e índice):
  `docker compose -f docker-compose.hub.yml down -v`.

## Consultar tu propia base de datos

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

## Si estás tocando el código

La misma demo se puede construir desde el repo en vez de usar las imágenes
publicadas (es lo que hago yo en desarrollo): `git clone`, `cp .env.example .env`,
y `docker compose --profile demo build && docker compose --profile demo run --rm cli`
desde la raíz. El profile `demo` existe para eso: el `docker compose up -d` normal
del repo no toca el contenedor de la aplicación.

## Si algo no cuadra

- **"Docker no está en marcha"** → abre Docker Desktop y espera "Engine running" (Windows/Mac);
  en **Linux**, si Docker sí está corriendo, casi seguro es que tu usuario no está en el grupo
  `docker` (`sudo usermod -aG docker $USER` y reinicia sesión). Reintenta.
- **Error de credenciales con OpenAI** → aquí no hay `.env`: la clave se exporta en la
  terminal (`export OPENAI_API_KEY=...` o `$env:OPENAI_API_KEY = "..."`) **antes** del
  `docker compose run`, y en esa misma terminal — si abres una terminal nueva, hay que
  volver a exportarla.
- **Con LM Studio no responde o va vacío** → asegúrate de tener cargados el modelo de
  chat **y** el de embeddings a la vez, y su servidor arrancado; además, activa en LM
  Studio la opción de servir en la red local (el contenedor no ve tu `localhost`).
- **El primer arranque va lento** → depende de tu conexión (descarga de las tres
  imágenes) y de tu equipo; mientras el progreso en pantalla cambie, va bien.
- **El puerto 5432, 7474 o 7687 está ocupado** → tienes otro PostgreSQL/Neo4j corriendo
  en tu máquina; cómo resolverlo está en la [guía avanzada](instalacion-avanzada.md).
- Cualquier otra cosa → [guía avanzada](instalacion-avanzada.md), sección de problemas
  frecuentes.
