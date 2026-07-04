# Guía de uso de GraphSQL

Cómo uso el proyecto en el día a día: arrancar el CLI, hacer una consulta en lenguaje
natural y revisarla antes de ejecutarla, escanear el esquema, depurar la recuperación,
y lanzar la evaluación. Para montar el entorno desde cero (Docker, `.env`, dependencias)
mira antes [`instalacion.md`](instalacion.md). Los términos técnicos (GraphRAG,
schema-linking, Judge, execution accuracy…) están en el [glosario](glosario.md).

---

## 0. Antes de empezar (lista rápida)

Para que todo funcione necesito, en este orden:

1. **Las bases de datos levantadas** — `docker compose up -d` desde la raíz (PostgreSQL con
   pgvector + Neo4j). Compruebo con `docker compose ps` que están `healthy`.
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

Sale una cabecera y el menú principal:

```
¿Qué quieres hacer?
❯ Consultar en lenguaje natural (con revisión humana)
  Escanear el esquema de la BD objetivo
  Depurar recuperación (ver el circuito)
  Salir
```

Me muevo con las flechas, elijo con Enter. Salgo con *Salir* o con Ctrl+C (sale limpio, sin
volcar el error). Cada opción vuelve al menú al terminar.

---

## 2. Consultar en lenguaje natural (con revisión humana)

Es el flujo principal: escribo una pregunta en español y el sistema me propone una consulta
SQL, la valida, y **me para para que la revise antes de ejecutar nada**.

### Qué hago

1. Elijo *Consultar en lenguaje natural*.
2. Escribo la pregunta, p. ej. `¿qué 10 juegos se han jugado más minutos en total?`.
3. Espero mientras el sistema recupera las tablas, genera la SQL y la pasa por el Judge.
4. Reviso las dos cajas que aparecen (la consulta y la evaluación del Judge) y **decido**.

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

- **✅ Válida / ❌ No válida · confianza NN%** — el veredicto y su confianza.
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

### Los resultados

Al aprobar, salen el número de filas y una tabla con las columnas alineadas (máximo 50 filas en
pantalla; si la consulta devolvió más, avisa de que está *truncado*). Los nulos se marcan con `∅`
en gris para distinguirlos de un texto vacío.

> La consulta interactiva trabaja sobre la **BD objetivo principal** (`TARGET_DB_1`, Arcadia por
> defecto). Para trabajar sobre otra BD, escanéala primero (§3); la evaluación multi-BD usa
> `EVAL_TARGET` (§7).

---

## 3. Escanear el esquema de la BD objetivo

Leo el esquema de la BD, lo vuelco a Neo4j (el grafo de tablas y claves foráneas) y lo
**vectorizo** en pgvector (para la búsqueda por significado). Hay que hacerlo **la primera vez**
y **cada vez que cambie el esquema** o quiera cambiar de BD/proveedor de embeddings.

### Qué me pregunta (en este orden)

1. **Qué BD escanear** — la lista sale del catálogo del `.env` (Arcadia, Nebula…).
2. **Descripciones** — si hay un fichero de descripciones de tablas, me pregunta si incluirlas
   (mejoran la recuperación de tablas de nombre opaco). 
3. **Proveedor de embeddings** — OpenAI (nube) o LM Studio (local).
4. **Confirmación** — con su aviso de coste/tiempo. Si el índice actual usa otro modelo o
   dimensión, avisa de que lo reemplazará por completo.

### Importante

- El escaneo **reconstruye Neo4j y pgvector a la vez**, con la misma decisión de descripciones,
  para que los dos almacenes no queden desincronizados. Si no confirmo, no se toca nada.
- Con OpenAI, vectorizar **tiene coste por uso** (avisa antes).
- En local, si el modelo de embeddings no está cargado en LM Studio, avisa antes de empezar.

---

## 4. Depurar la recuperación (ver el circuito)

Enseña **por qué** entran las tablas que entran, sin generar SQL. Útil para entender el GraphRAG
o para afinar una pregunta. Escribo una pregunta y pinta tres tablas:

1. **Ranking semántico (coseno)** — todas las tablas ordenadas por parecido con la pregunta, con
   su score; marca con ✓ las que entran en el top-K.
2. **Añadidas por expansión de FK** — las que no salían por significado pero arrastra el grafo por
   una clave foránea (su score semántico suele ser bajo: por eso el vector solo no las pilla).
3. **Contexto final** — las que acaban pasando al generador de SQL, con el **motivo** de cada una:
   *semántica*, *expansión FK* o *fijada*.

Así se ve de un vistazo si una tabla se recupera por su significado o la rescata el grafo.

---

## 5. Elegir base de datos y proveedor (variables del `.env`)

| Variable | Para qué |
|----------|----------|
| `TARGET_DB_1_*` | La **BD objetivo principal** (Arcadia por defecto): la que consulto en el CLI. |
| `TARGET_DB_2_*` | Una **segunda BD** del catálogo (Nebula, la grande de la prueba de escala). Aparece para escanear/evaluar. |
| `TARGET_DB_n_PUBLIC` | `true` si la BD es pública (muestra un aviso de posible contaminación del LLM). |
| `EVAL_TARGET` | Qué BD evalúa `npm run evaluate` (por defecto Arcadia). |
| `LLM_PROVIDER` | `openai` o `local` (LM Studio). Elige el modelo de chat/generación. |
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

# Evaluación experimental (opt-in: necesitan Docker + LLM) — ver §7
npm run evaluate                # ablation de 3 modos sobre la BD de EVAL_TARGET (Arcadia por defecto)
npm run evaluate:descriptions   # ablation 2×2 con/sin descripciones
npm run evaluate:scale          # prueba de escala Arcadia (17 tablas) vs Nebula (66)

# Regenerar datos (solo si cambio esquema/volumen) — normalmente NO hace falta
npm run seed -- --truncate      # repuebla Arcadia (seed=42)
npm run seed:nebula -- --reset  # recrea y repuebla Nebula

# Docker (desde la raíz del repo)
docker compose up -d            # levanta Postgres + Neo4j
docker compose ps               # ver que están 'healthy'
docker compose down             # parar (conserva los datos)
docker compose down -v          # borrar TODO, incluidos los datos (empezar de cero)
```

---

## 7. Lanzar y leer la evaluación

La evaluación mide, sobre un *golden set* de preguntas con su SQL de referencia, si la
recuperación GraphRAG aporta frente a alternativas más pobres. Es **opt-in** (necesita Docker y
el LLM) y guarda informes reproducibles en [`docs/evaluacion/`](evaluacion/).

- **`npm run evaluate`** — corre tres modos de recuperación (*sin recuperación* = esquema entero /
  *solo vectorial* / *GraphRAG*) y por cada uno mide:
  - **schema-linking recall** — cuántas de las tablas correctas trae la recuperación.
  - **tamaño de contexto** — tablas y tokens que recibiría el LLM (lo que enseña que volcar el
    esquema entero no escala).
  - **execution accuracy** — ejecuta la SQL generada y la de referencia y compara el resultado, en
    dos variantes: *justa* (la candidata contiene el resultado de referencia) y *estricta*
    (idéntico).
  - **equivalencia semántica (LLM)** — un segundo LLM decide si la candidata responde a la **misma
    pregunta** que la de referencia. Es **complementaria**: recupera aciertos que la comparación de
    filas descarta (empates, columnas de más) y, a la vez, caza diferencias reales que la
    comparación de filas no ve (p. ej. un `LEFT JOIN` que cambia el resultado). Como la juzga un
    LLM, se reporta **al lado** de la execution accuracy, no en su lugar.
- **`npm run evaluate:descriptions`** — el mismo experimento con y sin las descripciones de las
  tablas, para aislar cuánto aportan (re-vectoriza el índice en cada condición y lo restaura).
- **`npm run evaluate:scale`** — compara Arcadia (17 tablas) con Nebula (66) para ver que el
  contexto del GraphRAG se mantiene acotado mientras el de "sin recuperación" se dispara.
  Ingiere/vectoriza cada BD y **restaura Arcadia al terminar**.

La lectura neutra de los resultados —y los **sesgos conocidos de las métricas** (columna de más,
`INNER` vs `LEFT JOIN`, interpretación de la referencia única)— está en
[`arquitectura.md` §10](design/arquitectura.md); la orientada a producto, en
[`propuesta-valor.md`](propuesta-valor.md).

---

## 8. Problemas frecuentes

- **"No encontré tablas relevantes" / la consulta falla al recuperar** → el esquema no está
  vectorizado (o se vectorizó con otro modelo). Escanéalo: menú → *Escanear el esquema* (§3).
- **"No pude preparar el checkpointer"** → falta Postgres. `docker compose up -d` y reintenta.
- **Con LM Studio no responde / respuesta vacía** → asegúrate de tener cargados el modelo de chat
  **y** el de embeddings en LM Studio, y que la URL del `.env` apunta a su servidor.
- **Con OpenAI da error de credenciales** → revisa `OPENAI_API_KEY` en el `.env`.
- **El escaneo dice que el índice quedó "desincronizado"** → Neo4j se actualizó pero la
  vectorización falló; vuelve a escanear cuando el proveedor de embeddings esté disponible.
- **Cambié el esquema y la consulta usa el viejo** → re-escanea; la recuperación trabaja sobre el
  índice vectorial, no sobre la BD en vivo.
