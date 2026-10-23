# ==============================================================================
# FlowPilot Windows PowerShell CLI Helper
# Usage: .\scripts\dev.ps1 <command>
# ==============================================================================

param (
    [Parameter(Position=0, Mandatory=$false)]
    [string]$Command = "help"
)

# Prefer the project virtual environment so tests never run against global packages.
$VenvPython = Join-Path $PSScriptRoot "..\backend\venv\Scripts\python.exe"
$Python = if (Test-Path $VenvPython) { $VenvPython } else { "python" }

function Show-Help {
    Write-Host "==================================================" -ForegroundColor Cyan
    Write-Host "  FlowPilot PowerShell Management Console         " -ForegroundColor Cyan
    Write-Host "==================================================" -ForegroundColor Cyan
    Write-Host "Usage: .\scripts\dev.ps1 <command>`n"
    Write-Host "Docker Environment Commands:" -ForegroundColor White
    Write-Host "  up             - Start all services in background with Docker" -ForegroundColor Green
    Write-Host "  down           - Stop all running Docker containers" -ForegroundColor Yellow
    Write-Host "  build          - Build or rebuild Docker containers" -ForegroundColor Green
    Write-Host "  logs           - Tail all Docker container logs" -ForegroundColor White
    Write-Host "  test           - Run tests inside Docker containers" -ForegroundColor Cyan
    Write-Host "  migrate        - Run Alembic migrations inside backend container" -ForegroundColor Magenta
    Write-Host "  status         - Check status of Docker containers" -ForegroundColor White
    Write-Host "`nLocal Development Commands:" -ForegroundColor White
    Write-Host "  seed           - Create demo user and the published Enterprise Lead pipeline" -ForegroundColor Green
    Write-Host "  run-demo       - Send a signed lead through the pipeline and approve it" -ForegroundColor Green
    Write-Host "  setup          - Create backend venv, install backend + frontend dependencies" -ForegroundColor Green
    Write-Host "  test:local     - Run backend & frontend tests locally" -ForegroundColor Cyan
    Write-Host "  test:backend   - Run backend pytest locally" -ForegroundColor Cyan
    Write-Host "  test:frontend  - Run frontend vitest locally" -ForegroundColor Cyan
    Write-Host "  migrate:local  - Run Alembic migrations locally against PostgreSQL" -ForegroundColor Magenta
    Write-Host "  migrate:sql    - Generate static SQL migration DDL (offline)" -ForegroundColor Magenta
    Write-Host "  run:backend    - Start FastAPI locally with uvicorn" -ForegroundColor Green
    Write-Host "  run:frontend   - Start Vite frontend locally" -ForegroundColor Green
    Write-Host "  clean          - Remove Python, Node, and cache artifacts" -ForegroundColor Red
    Write-Host "  help           - Display this help message"
}

switch ($Command.ToLower()) {
    "up" {
        Write-Host "Starting FlowPilot services with Docker..." -ForegroundColor Green
        docker compose up -d
    }
    "down" {
        Write-Host "Stopping FlowPilot services..." -ForegroundColor Yellow
        docker compose down
    }
    "build" {
        Write-Host "Building FlowPilot containers..." -ForegroundColor Green
        docker compose build
    }
    "logs" {
        docker compose logs -f
    }
    "test" {
        Write-Host "Running backend tests in Docker..." -ForegroundColor Cyan
        docker compose exec backend pytest
        Write-Host "Running frontend tests in Docker..." -ForegroundColor Cyan
        docker compose exec frontend npm run test
    }
    "migrate" {
        Write-Host "Applying database migrations inside Docker..." -ForegroundColor Magenta
        docker compose exec backend alembic upgrade head
    }
    "seed" {
        Write-Host "Seeding demo user and Enterprise Lead pipeline..." -ForegroundColor Green
        docker compose exec backend python -m scripts.seed_demo
    }
    "run-demo" {
        Write-Host "Sending a signed demo lead and approving it..." -ForegroundColor Green
        docker compose exec backend python -m scripts.run_demo
    }
    "status" {
        docker compose ps
    }
    "test:local" {
        Write-Host "Running backend tests locally..." -ForegroundColor Cyan
        Set-Location backend
        & $Python -m pytest tests/ -v
        Set-Location ..
        Write-Host "Running frontend tests locally..." -ForegroundColor Cyan
        Set-Location frontend
        npm run test
        Set-Location ..
    }
    "setup" {
        Write-Host "Setting up local environment..." -ForegroundColor Green
        if (-not (Test-Path (Join-Path $PSScriptRoot "..\.env"))) { Copy-Item (Join-Path $PSScriptRoot "..\.env.example") (Join-Path $PSScriptRoot "..\.env") }
        Set-Location backend
        if (-not (Test-Path venv)) { python -m venv venv }
        & .\venv\Scripts\python.exe -m pip install -r requirements-dev.txt
        Set-Location ..\frontend
        npm install
        Set-Location ..
        Write-Host "Setup complete." -ForegroundColor Green
    }
    "test:backend" {
        Write-Host "Running backend tests..." -ForegroundColor Cyan
        Set-Location backend
        & $Python -m pytest tests/ -v
        Set-Location ..
    }
    "test:frontend" {
        Write-Host "Running frontend tests..." -ForegroundColor Cyan
        Set-Location frontend
        npm run test
        Set-Location ..
    }
    "migrate:local" {
        Write-Host "Running Alembic migrations locally..." -ForegroundColor Magenta
        Set-Location backend
        & $Python -m alembic upgrade head
        Set-Location ..
    }
    "migrate:sql" {
        Write-Host "Generating offline SQL migration DDL..." -ForegroundColor Magenta
        Set-Location backend
        & $Python -m alembic upgrade head --sql
        Set-Location ..
    }
    "run:backend" {
        Write-Host "Starting FastAPI local server at http://localhost:8000..." -ForegroundColor Green
        Set-Location backend
        python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
        Set-Location ..
    }
    "run:frontend" {
        Write-Host "Starting Vite frontend at http://localhost:5173..." -ForegroundColor Green
        Set-Location frontend
        npm run dev
        Set-Location ..
    }
    "clean" {
        Write-Host "Cleaning temporary artifacts..." -ForegroundColor Yellow
        Get-ChildItem -Recurse -Include __pycache__,.pytest_cache,.ruff_cache | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
        Write-Host "Clean completed." -ForegroundColor Green
    }
    default {
        Show-Help
    }
}
