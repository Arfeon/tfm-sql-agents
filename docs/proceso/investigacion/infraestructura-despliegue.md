# Infraestructura y despliegue

- **Fecha**: 2026-06-22
- **Objetivo**: decidir dónde y cómo corro PostgreSQL+pgvector y Neo4j (local vs cloud managed).

## Qué he leído / probado

- [Supabase](https://supabase.com) — PostgreSQL managed con pgvector incluido, tier gratuito generoso.
- [AuraDB (Neo4j)](https://neo4j.com/cloud/platform/aura-graph-database/) — Neo4j managed, tier free disponible.
- [Railway](https://railway.app) — plataforma PaaS que soporta docker-compose directamente; mencionado en el máster como opción de despliegue sencillo.

## Qué he aprendido

- Las opciones cloud (Supabase, AuraDB) reducen la fricción inicial pero añaden dependencia de terceros y costes a escala.
- Railway permite subir un `docker-compose.yml` casi sin cambios, útil para demos o entornos compartidos.
- En mi empresa las instalaciones locales en servidor propio son la norma → me parece más coherente aprender con las prácticas que usamos de verdad en el día a día.

### Cómo se inicializa Postgres en Docker (esto me pareció lo más interesante)

Montando el compose entendí bien cómo se configura una base de datos en Docker sin
tocarla a mano, y me parece un patrón que merece la pena recordar.

**pgvector tiene dos partes.** Una cosa es tener el binario de la extensión instalado
en el servidor (eso ya viene en la imagen `pgvector/pgvector:pg16`) y otra es
*activarlo* dentro de cada base con `CREATE EXTENSION vector`. Tener el binario no
basta: cada base de datos donde quiera usar vectores tiene que encenderlo.

**El truco para automatizar ese `CREATE EXTENSION` (y crear la base `arcadia`):** la
imagen oficial de Postgres tiene una carpeta especial, `/docker-entrypoint-initdb.d`.
Al arrancar, ejecuta automáticamente todo lo que encuentre ahí (`.sh` y `.sql`) en
orden alfabético. Yo le pongo allí mi script montándolo en esa ruta desde el compose:

```yaml
volumes:
  - ./setup/infra/postgres/init:/docker-entrypoint-initdb.d:ro   # mi script de init
  - postgres_data:/var/lib/postgresql/data                       # datos persistentes
```

**Por qué solo se ejecuta en el primer arranque:** la imagen solo lanza esos scripts
cuando la base está *vacía*, es decir, cuando el volumen `postgres_data` no tiene
datos todavía. La lógica es:

- Primer `docker compose up` -> `postgres_data` vacío -> se inicializa -> corre el init. -> todo ok
- Arranques siguientes (`stop`/`start`, o `down` + `up`) → ya hay datos → Postgres
  asume que está configurado y **se salta el init**, para no machacar nada.

**Consecuencia práctica:** si cambio el script de init y quiero que vuelva a correr,
tengo que vaciar el volumen con `docker compose down -v` y levantar de nuevo. Mientras
el volumen tenga datos, el init se ignora.

## Decisión

**Para el MVP voy con local + Docker (docker-compose)**. Levanto PostgreSQL+pgvector y Neo4j en contenedores locales. Por qué:

1. En mi empresa preferimos instalaciones en servidores propios; aprender en ese contexto me aporta más.
2. Tengo menos variables externas durante el desarrollo (latencia, cuotas, auth cloud).
3. Con `docker-compose up` reproduzco el entorno en cualquier máquina.

**Dejo el cloud para más adelante**: si en algún momento quiero quitarme la gestión de infra, Supabase y AuraDB son los candidatos directos, y Railway parece ser el más rápido para exponer una demo pública sin tocar el docker-compose.
