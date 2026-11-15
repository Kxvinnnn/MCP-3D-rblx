# Guía de Instalación y Ejecución — NIGHTMARE FORGE / Forge AI Studio

Esta guía describe los pasos verificados para instalar, configurar, compilar y ejecutar **NIGHTMARE FORGE / Forge AI Studio v2.3.0** en Windows (PowerShell) y entornos Linux/CI.

---

## 1. Requisitos del Sistema

| Componente | Versión Mínima | Uso en el Proyecto |
| :--- | :---: | :--- |
| **Node.js** | `>= 20.0.0` | Gateway Express + Vite + Motor 3D TS (`server.ts`, `src/`), pruebas y `forge-bridge/` |
| **npm** | `>= 10.0.0` | Gestión de dependencias (`npm ci` en raíz y `forge-bridge/`) |
| **Python** | `3.11+` | Backend FastAPI (`backend/main.py`) y pruebas de paridad Python (`tests/test_e2e_bidirectional_sync.py`) |
| **Rojo CLI** *(opcional para sincronización real)* | `7.x` | Servidor local de sincronización en puerto `34872` hacia Roblox Studio |
| **Roblox Studio Desktop** *(opcional)* | Actualizado (`EditableMesh`) | Ejecución del plugin `ForgeAIStudioPlugin.server.luau` y pruebas visuales en Viewport/Workspace |

---

## 2. Estructura Principal de Trabajo

- **Raíz del repositorio**: Servidor Express unificado + frontend React 19 + Three.js (`server.ts`, `src/`, `tests/`).
- **`forge-bridge/`**: Servicio puente local Zero-Inbound en `127.0.0.1:48720` con cola persistente atómica.
- **`backend/`**: Backend FastAPI Python en `127.0.0.1:8000` + motores espejo en `backend/engines/` + plugin Luau en `backend/roblox_plugin/`.
- **`rojo_workspace/`**: Directorio administrado de Rojo (`default.project.json`) donde se escriben scripts Luau `--!strict`, UI `ForgeGUI` y assets `.luau` / `.rbxmx`.

---

## 3. Instalación Desde Cero

### 3.1 Dependencias Node.js (Raíz y Local Bridge)

```powershell
# En la raíz del repositorio
npm ci

# En el subproyecto forge-bridge
npm --prefix forge-bridge ci
```

> **Nota para Windows con `&` en la ruta de carpeta**: Si la ruta del directorio contiene `&` (por ejemplo `Forge-AI---Roblox-Luau-&-Rojo-Engine`), PowerShell bloqueando `.ps1` o `cmd.exe` puede fallar al invocar shims `.cmd`. En esos entornos usa directamente:
> ```powershell
> node node_modules/typescript/bin/tsc --noEmit
> node node_modules/vite/bin/vite.js build
> npm.cmd test
> Push-Location forge-bridge; node --import ./node_modules/tsx/dist/loader.mjs --test tests/bridge.test.ts; Pop-Location
> ```

### 3.2 Dependencias Python (Backend FastAPI)

```powershell
python -m pip install --upgrade pip
pip install -r backend/requirements.txt
```

Dependencias instaladas desde `backend/requirements.txt`: `fastapi>=0.115.0`, `uvicorn[standard]>=0.30.0`, `pydantic>=2.8.0`, `python-dotenv>=1.0.0`, `google-genai>=1.0.0`.

---

## 4. Configuración de Variables de Entorno

Copia las plantillas `.env.example` (nunca subas `.env` reales ni credenciales al repositorio):

```powershell
Copy-Item .env.example .env
Copy-Item backend\.env.example backend\.env
Copy-Item forge-bridge\.env.example forge-bridge\.env
```

Genera secretos aleatorios criptográficos de 32 bytes para autenticación entre servicios:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Consulta [ENVIRONMENT_AND_SECURITY.md](./ENVIRONMENT_AND_SECURITY.md) para el detalle completo de cada variable.

---

## 5. Compilación y Verificación Inicial

```powershell
# 1. Verificación de tipos TypeScript (raíz y puente)
node node_modules/typescript/bin/tsc --noEmit
npm --prefix forge-bridge run typecheck

# 2. Build de producción del frontend React + Vite
node node_modules/vite/bin/vite.js build

# 3. Suite combinada de pruebas (raíz + forge-bridge)
npm.cmd test
```

---

## 6. Ejecución de Servicios Locales

### 6.1 Gateway Web + API + Frontend (`127.0.0.1:3000`)

```powershell
# Desarrollo (tsx server.ts)
npm.cmd run dev

# Producción (después de vite build)
npm.cmd start
```

### 6.2 Backend Python FastAPI (`127.0.0.1:8000`, opcional si se usa paridad Python)

```powershell
Push-Location backend
uvicorn main:app --host 127.0.0.1 --port 8000
Pop-Location
```

### 6.3 Forge Local Bridge (`127.0.0.1:48720`) y Rojo 7.x (`:34872`)

```powershell
# Iniciar puente local en segundo plano (o usar npm --prefix forge-bridge start)
powershell -ExecutionPolicy Bypass -File .\forge-bridge\scripts\start-bridge.ps1

# Iniciar servidor Rojo apuntando al workspace administrado
rojo serve rojo_workspace --port 34872
```

### 6.4 Instalación del Plugin en Roblox Studio

1. Copia `backend/roblox_plugin/ForgeAIStudioPlugin.server.luau` hacia `%LocalAppData%\Roblox\Plugins\ForgeAIStudioPlugin.server.luau` (en Windows).
2. En **Roblox Studio → Game Settings → Security**, activa **Allow HTTP Requests**.
3. En el DockWidget de **Forge AI Studio**, configura:
   - **Forge Backend URL**: `http://127.0.0.1:3000`
   - **Local Bridge URL**: `http://127.0.0.1:48720`
   - **Security Token (`X-Forge-Token`)**: el mismo valor de `FORGE_PLUGIN_LOCAL_TOKEN` configurado en `forge-bridge/.env`.
4. Pulsa **Guardar Configuración y Probar Bridge**.

---

## 7. Modo Offline / Sin Clave IA vs Modo Híbrido con GPU Externa

- **Sin `GEMINI_API_KEY`**: El sistema funciona localmente usando el parser NLP (`src/utils/treePromptParser.ts`), el blueprint heurístico (`buildBaselineDirectorBlueprint`) y los motores geométricos 3D (`procedural3DGenerator.ts`, `specializedGeometryGenerators.ts`, `universalFreeform3DEngine.ts`), informando `fallback_triggered` / `provider_status: 'mock_or_local'` en `execution_report`.
- **Con `GEMINI_API_KEY`**: El AI Director (`requestGeminiDirectorBlueprint`) genera planos semánticos y grafos `arbitrary_components` respetando la precedencia estricta sobre `default`/`ai_director`.
- **Con `FORGE_EXTERNAL_3D_ENDPOINT` (opcional)**: Permite delegar generación 3D a un servidor GPU autohospedado que ejecute `TRELLIS`, `Hunyuan3D-2.0`, `SF3D` o `TripoSR`. Si no está configurado o falla, realiza fallback local honesto.
