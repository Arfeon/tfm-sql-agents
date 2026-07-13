# Instalador de GraphSQL para Windows. Lo escribí para que la instalación sea UN comando:
#
#   irm https://raw.githubusercontent.com/Arfeon/tfm-sql-agents/main/install.ps1 | iex
#
# Qué hace: comprueba los requisitos (Git, Node 20+, Docker), pregunta dónde instalar,
# clona el repo (o lo actualiza si ya está), prepara el .env con tu proveedor de IA,
# instala las dependencias y, si quieres, registra el comando global `gsql`. La
# infraestructura (contenedores, datos de prueba) NO la monta este script: la monta el
# propio programa, guiándote, la primera vez que lo arrancas.
#
# Ejecutado con `irm | iex` no puede recibir parámetros, así que todo se pregunta de
# forma interactiva; para automatizarlo (o probarlo), cada pregunta se puede fijar por
# variable de entorno: GRAPHSQL_INSTALL_DIR, GRAPHSQL_PROVIDER (openai|local),
# GRAPHSQL_OPENAI_KEY, GRAPHSQL_REGISTER_GSQL (yes|no) y GRAPHSQL_REPO_URL.
# Compatible con Windows PowerShell 5.1 (el que trae Windows) y con PowerShell 7.

$ErrorActionPreference = 'Stop'

$RepoUrl = if ($env:GRAPHSQL_REPO_URL) { $env:GRAPHSQL_REPO_URL } else { 'https://github.com/Arfeon/tfm-sql-agents.git' }
$DefaultDir = Join-Path $env:LOCALAPPDATA 'GraphSQL'

function Write-Step($text) { Write-Host "`n== $text" -ForegroundColor Cyan }
function Write-Ok($text) { Write-Host "[OK] $text" -ForegroundColor Green }
function Write-Warning2($text) { Write-Host "[!] $text" -ForegroundColor Yellow }
function Fail($text) { Write-Host "[X] $text" -ForegroundColor Red; exit 1 }

# Pregunta con valor por defecto; una variable de entorno la responde sin preguntar,
# y sin terminal interactivo (automatización) se toma el defecto directamente.
function Ask($question, $default, $envValue) {
    if ($envValue) { return $envValue }
    try {
        $answer = Read-Host "$question [$default]"
    } catch {
        return $default
    }
    if ([string]::IsNullOrWhiteSpace($answer)) { return $default }
    return $answer
}

Write-Host ''
Write-Host '  GraphSQL - instalador para Windows' -ForegroundColor Cyan
Write-Host '  Consultas SQL en lenguaje natural sobre tu base de datos' -ForegroundColor DarkGray

# ── 1. Requisitos ────────────────────────────────────────────────────────────────
Write-Step 'Compruebo los requisitos'

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Fail 'Falta Git. Instalalo desde https://git-scm.com y vuelve a ejecutar el instalador.'
}
Write-Ok "Git: $(git --version)"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Fail 'Falta Node.js 20 o superior. Instala la version LTS desde https://nodejs.org y vuelve a ejecutar.'
}
$nodeMajor = [int]((node --version).TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 20) {
    Fail "Tu Node.js es la version $nodeMajor y hace falta 20 o superior. Actualiza desde https://nodejs.org"
}
Write-Ok "Node.js: $(node --version)"

if (Get-Command docker -ErrorAction SilentlyContinue) {
    Write-Ok "Docker: $(docker --version)"
} else {
    Write-Warning2 'Docker no esta instalado. Puedes terminar la instalacion igualmente, pero para'
    Write-Warning2 'arrancar GraphSQL necesitaras Docker Desktop: https://www.docker.com/products/docker-desktop/'
}

# ── 2. Directorio e instalacion del codigo ──────────────────────────────────────
Write-Step 'Donde lo instalo'

$installDir = Ask 'Directorio de instalacion' $DefaultDir $env:GRAPHSQL_INSTALL_DIR

if (Test-Path (Join-Path $installDir '.git')) {
    Write-Ok "Ya hay una instalacion en $installDir - la actualizo (git pull)."
    git -C $installDir pull --ff-only
    if ($LASTEXITCODE -ne 0) { Fail 'No pude actualizar (git pull fallo). Revisa cambios locales en esa carpeta.' }
} elseif ((Test-Path $installDir) -and (Get-ChildItem $installDir | Select-Object -First 1)) {
    Fail "La carpeta $installDir existe y no esta vacia (y no es una instalacion de GraphSQL). Elige otra."
} else {
    Write-Host "Clonando el proyecto en $installDir..."
    git clone $RepoUrl $installDir
    if ($LASTEXITCODE -ne 0) { Fail 'El git clone fallo. Revisa tu conexion (o el proxy corporativo).' }
    Write-Ok 'Proyecto descargado.'
}

# ── 3. Configuracion (.env y descripciones de la demo) ──────────────────────────
Write-Step 'Preparo la configuracion'

$envFile = Join-Path $installDir '.env'
if (Test-Path $envFile) {
    Write-Ok 'Ya tienes un .env: conservo tu configuracion tal cual.'
} else {
    Copy-Item (Join-Path $installDir '.env.example') $envFile

    $provider = (Ask 'Proveedor de IA: "openai" (nube, necesita clave) o "local" (LM Studio, gratis y offline)' 'openai' $env:GRAPHSQL_PROVIDER).ToLower()
    $content = Get-Content $envFile -Raw
    if ($provider -eq 'local') {
        $content = $content -replace '(?m)^LLM_PROVIDER=.*', 'LLM_PROVIDER=local'
        $content = $content -replace '(?m)^EMBEDDING_PROVIDER=.*', 'EMBEDDING_PROVIDER=local'
        Write-Ok 'Configurado para LM Studio. Recuerda: modelo de chat + modelo de embeddings cargados y servidor arrancado.'
    } else {
        $apiKey = Ask 'Tu OPENAI_API_KEY (dejalo vacio para ponerla luego a mano en el .env)' '' $env:GRAPHSQL_OPENAI_KEY
        if ($apiKey) {
            $content = $content -replace '(?m)^OPENAI_API_KEY=.*', "OPENAI_API_KEY=$apiKey"
            Write-Ok 'Clave de OpenAI guardada en el .env.'
        } else {
            Write-Warning2 "Sin clave aun: antes de usarlo, edita $envFile y pon tu OPENAI_API_KEY."
        }
    }
    Set-Content -Path $envFile -Value $content -NoNewline
}

$descriptions = Join-Path $installDir 'descriptions\descriptions.json'
if (-not (Test-Path $descriptions)) {
    Copy-Item (Join-Path $installDir 'descriptions\descriptions.example.json') $descriptions
    Write-Ok 'Descripciones de la base de demo activadas.'
}

# ── 4. Dependencias ──────────────────────────────────────────────────────────────
Write-Step 'Instalo las dependencias (npm install)'

Push-Location (Join-Path $installDir 'backend')
try {
    npm install
    if ($LASTEXITCODE -ne 0) { Fail 'npm install fallo. Revisa el error de arriba.' }
    Write-Ok 'Dependencias instaladas.'

    # ── 5. Comando global gsql (opcional) ────────────────────────────────────────
    Write-Step 'Comando global gsql'
    $link = (Ask 'Registro el comando global "gsql" para invocarlo desde cualquier carpeta? (yes/no)' 'yes' $env:GRAPHSQL_REGISTER_GSQL).ToLower()
    if ($link -in @('yes', 'y', 'si', 's')) {
        npm link
        if ($LASTEXITCODE -eq 0) {
            Write-Ok 'Comando gsql registrado (en la carpeta global de npm, ya en tu PATH).'
        } else {
            Write-Warning2 'npm link fallo; puedes arrancar igualmente con npm start desde backend/.'
        }
    } else {
        Write-Host 'Sin comando global. Se arranca con: npm start (desde la carpeta backend).'
    }
} finally {
    Pop-Location
}

# ── Final ─────────────────────────────────────────────────────────────────────────
Write-Host ''
Write-Host '  GraphSQL instalado.' -ForegroundColor Green
Write-Host ''
Write-Host "  Instalado en:  $installDir"
Write-Host '  Para arrancar: gsql        (o: cd backend; npm start, desde esa carpeta)'
Write-Host '                 La primera vez, el propio programa monta su infraestructura'
Write-Host '                 (contenedores y datos de prueba) guiandote paso a paso.'
Write-Host '  Actualizar:    vuelve a ejecutar este instalador (hace git pull).'
Write-Host '  Desinstalar:   npm unlink -g graphsql-backend  y borra la carpeta.'
Write-Host ''
