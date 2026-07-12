# Guía de instalación

De cero a la primera consulta **sin tocar Docker**: el propio programa comprueba y
levanta su infraestructura, y te va guiando — tú solo respondes que sí. Cada paso
termina con un *"deberías ver"* para que sepas que vas bien.

> ¿Prefieres controlar cada pieza a mano (docker compose, verificaciones, regenerar
> datos)? Eso vive en la [guía avanzada](instalacion-avanzada.md). Para usar el
> programa una vez instalado, la [guía de uso](uso.md).

## 1. Instala los requisitos (una sola vez)

- **Docker Desktop** — https://www.docker.com/products/docker-desktop/
  Tras instalarlo, ábrelo y espera a que el icono diga **"Engine running"**. No
  necesitas saber usarlo: el programa se encarga.
- **Node.js 20 o superior** — https://nodejs.org (la versión LTS vale).
- **Git** — https://git-scm.com

Comprueba que responden:

```bash
docker --version
node --version
```

**Deberías ver** dos números de versión (p. ej. `Docker version 27...` y `v20...` o
superior). Si alguno falla, revisa esa instalación antes de seguir.

## 2. Descarga el proyecto y prepara la configuración

```bash
git clone https://github.com/Arfeon/tfm-sql-agents.git
cd tfm-sql-agents
cp .env.example .env
cp descriptions/descriptions.example.json descriptions/descriptions.json
```

El segundo `cp` activa las **descripciones de tablas** de la base de prueba: mejoran
mucho la búsqueda (verás por qué cuando preguntes por la "lista de deseos" y el
sistema encuentre una tabla llamada `t_042`).

Ahora abre el `.env` y configura **solo el proveedor de IA** — todo lo demás puede
quedarse como está. Dos opciones:

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
que sí y espera (**2-3 minutos** la primera vez; luego, segundos).

**Deberías ver**, en este orden:

```
⚠ Los contenedores de GraphSQL (Postgres y Neo4j) todavía no existen.
? ¿Los levanto ahora con la configuración por defecto? (Y/n)   ← di que sí

Levantando la infraestructura. El primer arranque tarda unos 2-3 minutos...
 Container graphsql_postgres  Healthy
 Container graphsql_neo4j     Healthy

╭──────────────────────────────────────╮
│  ✔ Infraestructura lista             │
╰──────────────────────────────────────╯
? ¿Arranco GraphSQL? (Y/n)                                     ← di que sí
```

> ¿Dice **"Docker no está en marcha"**? Abre Docker Desktop, espera el
> "Engine running" y responde que sí al "¿Lo compruebo otra vez?".

Después elige tu proveedor de IA (sale preseleccionado el del `.env`) y llegas al
menú principal.

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

- **"Docker no está en marcha"** → abre Docker Desktop, espera "Engine running", reintenta.
- **"La infraestructura quedó a medio inicializar"** → pasa si el primer arranque se
  interrumpió (un Ctrl+C durante la carga). El propio programa te ofrece **reiniciarla
  desde cero**: dile que sí y espera los 2-3 minutos (las bases de prueba se regeneran solas).
- **El puerto 5432, 7474 o 7687 está ocupado** → tienes otro PostgreSQL/Neo4j corriendo
  en tu máquina; cómo resolverlo está en la [guía avanzada](instalacion-avanzada.md).
- **Con LM Studio no responde o va vacío** → asegúrate de tener cargados el modelo de
  chat **y** el de embeddings a la vez, y su servidor arrancado.
- **Error de credenciales con OpenAI** → revisa la `OPENAI_API_KEY` del `.env`.
- Cualquier otra cosa → [guía avanzada](instalacion-avanzada.md), sección de problemas
  frecuentes.
