# Guía de uso de GraphSQL

Cómo uso el proyecto en el día a día: arrancar el CLI, hacer una consulta en lenguaje
natural y revisarla antes de ejecutarla, escanear el esquema, depurar la recuperación,
y lanzar la evaluación. Para montar el entorno desde cero (Docker, `.env`, dependencias)
mira antes [`instalacion.md`](instalacion.md). Los términos técnicos (GraphRAG,
schema-linking, Judge, execution accuracy…) están en el [glosario](glosario.md).

---

## Qué hay en las bases de demo (Arcadia y Nebula)

Antes de escribir la primera pregunta conviene saber qué modela cada BD — si no, es
fácil quedarse mirando el prompt sin saber qué pedir. No hace falta mirar el
[golden set](../setup/datasets/arcadia/golden_set.yaml) para esto.

**Arcadia (17 tablas, la de uso diario)** — una plataforma de suscripción de
videojuegos en streaming ("Netflix de videojuegos"): catálogo (`company`, `franchise`,
`game`, `genre`, `platform`, `dlc`), negocio (`region`, `subscription_plan`, `customer`,
`subscription`, `purchase`) y telemetría de uso (`play_session`, `rating`,
`concurrent_snapshot`). Esquema completo, dominio y diagrama en
[`setup/datasets/arcadia/README.md`](../setup/datasets/arcadia/README.md).

Preguntas para arrancar:

- «¿Cuántos juegos hay en el catálogo?»
- «Dame los 5 juegos con mayor precio base»
- «¿Qué 10 juegos se han jugado más minutos en total?»
- «¿Qué 5 clientes tienen más juegos en su lista de deseos?» ← ver `t_042` abajo

> **`t_042` no es un error de nombrado.** Es la tabla de lista de deseos (qué juegos ha
> marcado un cliente sin comprar todavía), con un nombre **opaco a propósito**: no dice
> nada de lo que contiene. Es el caso de prueba de que la recuperación encuentra tablas
> por su **descripción**, no adivinando el nombre — pregunta algo de "lista de deseos" y
> compara escaneando con y sin descripciones (§3): sin ellas, esta tabla es casi
> invisible para el sistema por mucho que subas el número de tablas candidatas.

**Nebula (66 tablas, la de la prueba de escala)** — el mismo universo de Arcadia
extendido (más catálogo, comercio, telemetría, social, reseñas, eventos, soporte) para
medir cómo se comporta la recuperación con un esquema mucho más grande. No está pensada
para explorar preguntas de negocio a mano; existe para la evaluación de escala (§7). Si
la escaneas y preguntas igualmente, funciona, pero el interés está en comparar el
tamaño del contexto entre las dos BDs, no en el dominio en sí. Conserva su propia
`t_042` (misma lista de deseos), por si quieres repetir la prueba de arriba a escala.

---

## 0. Antes de empezar (lista rápida)

Para que todo funcione necesito, en este orden:

1. **Las bases de datos levantadas** — el propio `npm start` lo comprueba y, si faltan,
   se ofrece a levantarlas (PostgreSQL con pgvector + Neo4j). Si prefiero hacerlo a mano:
   `docker compose up -d --wait` desde la raíz.
2. **Dependencias instaladas** — `cd backend && npm install`.
3. **El `.env` con un proveedor de LLM y de embeddings** — como mínimo `LLM_PROVIDER`
   (`openai` o `local`) con su clave/URL, y `EMBEDDING_PROVIDER`. Ver §5.
4. **El esquema escaneado y vectorizado** — la primera vez, y cada vez que cambie el
   esquema, hay que escanear (menú → *Escanear el esquema*, §3). Sin índice vectorial, la
   recuperación no encuentra tablas y la consulta falla.

> Regla de oro: **si es la primera vez, escanea antes de consultar** (paso §3 antes que §2).

---

## 1. Arrancar el CLI

Desde `backend/`:

```bash
npm start
```

Sale la cabecera y lo primero que hace es **comprobar la infraestructura**: que Docker está
en marcha y que los contenedores de Postgres y Neo4j existen y están `healthy`. Si todo está
bien, pasa de largo con un `✔ Infraestructura lista` y no pregunta nada. Si falta algo, me guía:

- **Docker apagado** → me avisa y me deja reintentarlo cuando lo haya arrancado.
- **Contenedores inexistentes o parados** → me enseña el estado de cada uno y se ofrece a
  levantarlos con `docker compose up -d --wait` (veo el progreso real de Docker). Al
  terminar pinta el banner de *Infraestructura lista* y me pregunta si arranco la app.

Con la infraestructura lista llega **el selector de proveedor LLM de la sesión**: elijo
si trabajo con OpenAI (nube) o en local (LM Studio), y cada opción muestra el modelo
concreto que usaría. El `.env` (`LLM_PROVIDER`) es solo el valor por defecto que sale
preseleccionado; así nunca arranco sin saber con qué modelo estoy trabajando.

```
¿Con qué proveedor de LLM quieres trabajar en esta sesión?
❯ OpenAI (nube) — gpt-5-mini-2025-08-07
  Local / LM Studio — qwen2.5-coder-14b-instruct
```

Tras elegir, el menú principal:

```
¿Qué quieres hacer?
❯ Consultar en lenguaje natural (con revisión humana)
  Escanear el esquema de la BD objetivo
  Depurar recuperación (ver el circuito)
  Salir
```

Me muevo con las flechas, elijo con Enter. Salgo con *Salir* o con Ctrl+C (sale limpio, sin
volcar el error). Cada opción vuelve al menú al terminar.

> **La primera vez el menú marca el camino.** Si el esquema aún no está escaneado ni
> vectorizado (no hay índice), el CLI lo avisa y el menú cambia: *Escanear el esquema*
> pasa a la primera posición con la marca `← empieza por aquí (primera vez)`, y
> *Consultar* y *Depurar* salen atenuadas y no seleccionables, con el motivo al lado.
> En cuanto escaneas, el menú vuelve solo a la normalidad — no hace falta reiniciar.

---

## 2. Consultar en lenguaje natural (con revisión humana)

Es el flujo principal: escribo una pregunta en español y el sistema me propone una consulta
SQL, la valida, y **me para para que la revise antes de ejecutar nada**.

### Qué hago

1. Elijo *Consultar en lenguaje natural*.
2. Si hay más de una BD en el catálogo, elijo **sobre cuál pregunto** (la que está
   indexada sale marcada; si elijo otra, me ofrece escanearla ahí mismo — ver abajo).
3. Escribo la pregunta, p. ej. `¿qué 10 juegos se han jugado más minutos en total?`
   (o `salir` para volver al menú).
4. Espero mientras el sistema recupera las tablas, genera la SQL y la pasa por el Judge.
5. Reviso las dos cajas que aparecen (la consulta y la evaluación del Judge) y **decido**.

### Qué pasa por dentro

El pipeline es un grafo determinista: **recuperar** las tablas relevantes (GraphRAG) →
**generar** la SQL → **juzgarla** (Judge) → **pausa para mi revisión** → **ejecutar** (solo si
la apruebo). Si el Judge no da por buena la consulta, el sistema **reintenta él solo** hasta 3
veces con los errores del Judge como pista, antes de pararse. Nada se ejecuta sin mi visto bueno.

### La caja de la consulta

Muestra la SQL propuesta (resaltada), las tablas que ha usado y, si hubo reintento automático,
cuántos intentos llevó. El título es cian si la consulta pasó el Judge (`📝 Consulta SQL
propuesta`) o rojo si no lo pasó (`❌ Consulta SQL (no superó el Judge)`).

### La caja del Judge (cómo leerla)

- **✅ Válida / ❌ No válida · confianza NN%** — el veredicto y su confianza. La confianza mide
  si la consulta **responde a mi pregunta** con datos reales, no solo si es SQL correcto; si al
  afinar di indicaciones, el Judge evalúa contra la pregunta más esas indicaciones.
- **Por qué** — una o dos frases justificando la nota.
- **Propósito de las tablas usadas** — qué cree el Judge que contiene cada tabla y de dónde lo
  sabe: *según descripción*, *por el nombre*, *por las columnas*. Si una tabla es opaca y sin
  descripción, sale un aviso de que su uso es una **suposición** (verifícalo).
- **Problemas** — lo que impediría ejecutarla (si los hay).
- **Qué le resta confianza / cautelas** y **Sugerencias** — avisos y mejoras opcionales.

> El Judge **asesora**, no manda: quien bloquea de verdad una consulta son las comprobaciones
> deterministas (seguridad de solo lectura + sintaxis real contra la BD). El juez LLM puede
> equivocarse, así que su opinión es un aviso, no un veto.

### Mis cuatro decisiones

| Opción | Qué hace |
|--------|----------|
| **Aprobar y ejecutar** | Ejecuta la consulta en **solo lectura** y me muestra los resultados. (No aparece si la consulta no superó el Judge.) |
| **Afinar** | Me pide dos cosas (ambas opcionales, pero al menos una): una **indicación en lenguaje natural** (p. ej. «añade la popularidad por wishlist») y/o **tablas a forzar** (separadas por comas). El sistema **rehace** la consulta con ese ajuste y me la vuelve a presentar. |
| **Modificar la SQL a mano** | Me deja editar la SQL directamente; la editada vuelve a pasar por el Judge. |
| **Rechazar** | No ejecuta nada y vuelve al menú. |

*Afinar* y *Modificar* me devuelven a la revisión con la nueva propuesta: puedo iterar las veces
que haga falta hasta aprobar o rechazar.

### Los resultados: tabla, gráfico o ambas

Al aprobar, sale el número de filas y, si el resultado tiene forma de **"categoría → valor"**
(p. ej. clientes por región: una columna de texto + una numérica, entre 2 y 30 filas), me
pregunta **¿Cómo lo muestro? Tabla / Gráfico de barras / Ambas**:

```
Oceania               ████████████████████████████████████████ 883
North America         ██████████████████████████████████████ 835
Europe                █████████████████████████████████████ 823
```

Si el resultado no es graficable (una sola fila, todo texto, demasiadas filas), muestra la tabla
directamente. En la tabla (máximo 50 filas en pantalla; si la consulta devolvió más, avisa de que
está *truncado*) los nulos se marcan con `∅` en gris; en el gráfico, un valor 0 o nulo sale con su
número y sin barra (un cero es información, no se esconde).

### Elegir sobre qué BD pregunto (y el guardián del índice)

Neo4j y pgvector guardan **un solo esquema a la vez**: el de la última BD escaneada. Por eso,
al elegir BD en la consulta, la indexada sale marcada como `(indexada)`. Si elijo otra, el
sistema **avisa** (la recuperación devolvería tablas de otra BD) y ofrece **escanearla ahí
mismo** con el mismo modelo de embeddings del índice, o cancelar — si cancelo, la consulta
no sigue: nunca se genera SQL con el índice de otra BD. Este escaneo inline hace la **misma
pregunta de descripciones** que el del menú cuando la BD es la principal; si no lo es, avisa
de que las descripciones no le aplican. La evaluación multi-BD, en cambio, usa `EVAL_TARGET` (§7).

---

## 3. Escanear el esquema de la BD objetivo

Leo el esquema de la BD, lo vuelco a Neo4j (el grafo de tablas y claves foráneas) y lo
**vectorizo** en pgvector (para la búsqueda por significado). Hay que hacerlo **la primera vez**
y **cada vez que cambie el esquema** o quiera cambiar de BD/proveedor de embeddings.

### Qué me pregunta (en este orden)

1. **Qué BD escanear** — la lista sale del catálogo del `.env` (Arcadia, Nebula…).
2. **Tipo de escaneo** (solo si ya hay índice de esa misma BD y fichero de descripciones):
   **completo** (lo de siempre) o **solo actualizar descripciones** — compara el JSON con lo
   indexado y re-vectoriza únicamente las tablas cuya descripción cambió (nuevas, modificadas
   o eliminadas), actualizando Neo4j y pgvector a la vez. Sin cambios no gasta ni un embedding.
   Es el modo barato para iterar descripciones en esquemas grandes; si cambió el *esquema*
   (columnas o tablas), hace falta el completo.
3. **Descripciones** — si hay un fichero de descripciones de tablas, me pregunta si incluirlas
   (mejoran la recuperación de tablas de nombre opaco). 
4. **Proveedor de embeddings** — OpenAI (nube) o LM Studio (local).
5. **Confirmación** — con su aviso de coste/tiempo. Si el índice actual usa otro modelo o
   dimensión, avisa de que lo reemplazará por completo.

### Importante

- El escaneo **reconstruye Neo4j y pgvector a la vez**, con la misma decisión de descripciones,
  para que los dos almacenes no queden desincronizados. Si no confirmo, no se toca nada.
- Con OpenAI, vectorizar **tiene coste por uso** (avisa antes).
- En local, si el modelo de embeddings no está cargado en LM Studio, avisa antes de empezar.

---

## 4. Depurar la recuperación (ver el circuito)

Enseña **por qué** entran las tablas que entran, sin generar SQL. Útil para entender el GraphRAG
o para afinar una pregunta. Escribo una pregunta y ejecuta la recuperación **con las mismas
palancas que el pipeline en vivo** (ranking híbrido + expansión por caminos de FK + selector LLM,
las tres capas de [`arquitectura.md` §6](design/arquitectura.md) — SPEC-26), así que lo que veo
aquí es exactamente lo que vería el generador de SQL. Pinta, en orden:

1. **Ranking híbrido** — todas las tablas ordenadas por el score fusionado (denso + léxico, RRF),
   con ✓ en las que entran en el top-K.
2. **Añadidas por expansión de FK** — las que no salían por significado pero arrastra el grafo por
   una clave foránea (su score semántico suele ser bajo: por eso el vector solo no las pilla).
3. **Conectores por camino de FK** — tablas puente necesarias para el JOIN entre dos anclas.
4. **Destinos de FK de las anclas** — las dimensiones que referencia un ancla (donde suele vivir
   el nombre de la cosa por la que se pregunta).
5. **Selección con LLM** — qué eligió el selector del pool de candidatas (o el aviso de que no
   eligió nada válido y se usó el recorte por prioridad).
6. **Contexto final** — las tablas que acaban pasando al generador, con el **motivo** de cada una:
   *semántica*, *expansión FK*, *conector (puente)*, *destino FK (dimensión)*, *elegida por el LLM*
   o *fijada*.

Y al final, el **DDL que recibe el generador**: exactamente lo que ve el modelo, útil para detectar
si una columna que aparece en la SQL generada en realidad se la inventó.

Así se ve de un vistazo si una tabla se recupera por su significado, la rescata el grafo, o la
elige el razonamiento del selector.

---

## 5. Elegir base de datos y proveedor (variables del `.env`)

| Variable | Para qué |
|----------|----------|
| `TARGET_DB_1_*` | La **BD objetivo principal** (Arcadia por defecto): la que consulto en el CLI. |
| `TARGET_DB_2_*` | Una **segunda BD** del catálogo (Nebula, la grande de la prueba de escala). Aparece para escanear/evaluar. |
| `TARGET_DB_n_TYPE` | Motor de esa BD: `postgresql` (por defecto) o `mssql` (SQL Server; puerto/schema por defecto 1433/`dbo`). El dialecto sale del motor y se inyecta en el prompt del SQL Agent, así que la consulta generada usa la sintaxis correcta de cada uno. |
| `TARGET_DB_n_PUBLIC` | `true` si la BD es pública (muestra un aviso de posible contaminación del LLM). |
| `EVAL_TARGET` | Qué BD evalúa `npm run evaluate` (por defecto Arcadia). |
| `LLM_PROVIDER` | `openai` o `local` (LM Studio). Es el **valor por defecto** del selector que sale al arrancar; puedo cambiarlo por sesión ahí sin tocar el `.env`. |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | Credenciales y modelo de OpenAI. |
| `LMSTUDIO_BASE_URL`, `LMSTUDIO_MODEL` | URL y modelo de LM Studio (local). |
| `EMBEDDING_PROVIDER` | `openai` o `local`: con qué se vectoriza (se elige también al escanear). |

> Con LM Studio (local) necesito tener cargados **a la vez** el modelo de chat y el de
> embeddings; el sistema avisa si falta alguno antes de usarlo.

---

## 6. Comandos útiles

Todos desde `backend/` salvo los de Docker (desde la raíz):

```bash
# Uso
npm start                       # arranca el CLI (menú principal)

# Calidad
npm test                        # tests unitarios (rápidos, con dobles, sin Docker)
npm run typecheck               # comprueba tipos (tsc --noEmit)
npm run test:diagnostic         # comprueba que Postgres/pgvector y Arcadia están listos (necesita Docker)
npm run test:integration        # tests de integración (necesita Docker)

# Evaluación experimental (opt-in: necesitan Docker + LLM) — ver §7 y docs/evaluacion/README.md
npm run evaluate                # ablation de 3 modos sobre la BD de EVAL_TARGET (Arcadia por defecto)
npm run evaluate:descriptions   # ablation 2×2 con/sin descripciones
npm run evaluate:scale          # prueba de escala Arcadia (17 tablas) vs Nebula (66)
npm run evaluate:aggregate      # media/rango de varias tiradas de la prueba de escala
npm run evaluate:confusion      # caso difícil: tablas y columnas de nombre opaco
npm run evaluate:review         # revisión objetiva de equivalencia (sin juez LLM)

# Regenerar datos (solo si cambio esquema/volumen) — normalmente NO hace falta
npm run seed -- --truncate      # repuebla Arcadia (seed=42)
npm run seed:nebula -- --reset  # recrea y repuebla Nebula

# Docker (desde la raíz del repo) — normalmente no hace falta: npm start lo gestiona
docker compose up -d --wait     # levanta Postgres + Neo4j y espera a que estén 'healthy'
docker compose ps               # ver su estado
docker compose down             # parar (conserva los datos)
docker compose down -v          # borrar TODO, incluidos los datos (empezar de cero)
```

---

## 7. Lanzar y leer la evaluación

La evaluación mide, sobre un *golden set* de preguntas con su SQL de referencia, si la
recuperación GraphRAG aporta frente a alternativas más pobres. Es **opt-in** (necesita Docker y
el LLM) y guarda informes en [`docs/evaluacion/`](evaluacion/).

> **Qué mide cada métrica y cómo se interpretan las tablas** está explicado, sin dudas, en
> [`docs/evaluacion/README.md`](evaluacion/README.md). Léelo antes de sacar conclusiones de los
> números (sobre todo: la equivalencia la juzga un LLM y con pocos casos no discrimina).

Los arneses disponibles:

- **`npm run evaluate`** — el ablation base: 3 modos de recuperación (sin recuperación / solo vectorial / GraphRAG) sobre la BD de `EVAL_TARGET`.
- **`npm run evaluate:descriptions`** — el mismo experimento con y sin las descripciones de tablas, para aislar cuánto aportan.
- **`npm run evaluate:scale`** — Arcadia (17 tablas) vs Nebula (66); enseña que el contexto del GraphRAG se mantiene plano. Restaura Arcadia al terminar.
- **`npm run evaluate:aggregate`** — media y rango de varias tiradas de la prueba de escala (la generación no es determinista, así que la media es más fiable que una tirada suelta).
- **`npm run evaluate:confusion`** — el caso difícil: tablas y columnas de nombre opaco, para ver quién sobrevive sin descripciones.
- **`npm run evaluate:review`** — revisión objetiva de equivalencia **sin juez LLM**: ejecuta la SQL generada y la de referencia de cada caso y compara los resultados de verdad.

La lectura neutra y los **sesgos conocidos de las métricas** están en [`arquitectura.md` §10](design/arquitectura.md).

---

## 8. Problemas frecuentes

- **"No encontré tablas relevantes" / la consulta falla al recuperar** → el esquema no está
  vectorizado (o se vectorizó con otro modelo). Escanéalo: menú → *Escanear el esquema* (§3).
- **"No pude preparar el checkpointer"** → falta Postgres. Relanza `npm start` (se ofrecerá a
  levantarlo) o hazlo a mano con `docker compose up -d --wait`.
- **Con LM Studio no responde / respuesta vacía** → asegúrate de tener cargados el modelo de chat
  **y** el de embeddings en LM Studio, y que la URL del `.env` apunta a su servidor.
- **Con OpenAI da error de credenciales** → revisa `OPENAI_API_KEY` en el `.env`.
- **El escaneo dice que el índice quedó "desincronizado"** → Neo4j se actualizó pero la
  vectorización falló; vuelve a escanear cuando el proveedor de embeddings esté disponible.
- **Cambié el esquema y la consulta usa el viejo** → re-escanea; la recuperación trabaja sobre el
  índice vectorial, no sobre la BD en vivo.
