# 🌉 Forge Local Bridge v1.0.0

Servicio puente local (Zero-Inbound) diseñado en **Node.js + TypeScript** para conectar **Forge AI Studio** (ejecutándose en Google AI Studio Build, Cloud Run o local) con tu **PC Windows**, **Rojo 7.x** y el **Plugin de Roblox Studio**.

---

## 🛡️ Arquitectura de Seguridad Zero-Inbound

1. **Exclusivamente Loopback (`127.0.0.1`):** El servidor local escucha únicamente en `127.0.0.1:48720` y bloquea cualquier conexión que no provenga de la interfaz de loopback.
2. **Cero Puertos Abiertos en el Router:** Toda la comunicación hacia el backend en la nube de Forge es **saliente** (`HTTPS` / `WebSocket`) desde tu PC Windows.
3. **Sin Rutas Absolutas de Windows en la Nube:** El backend remoto solo utiliza rutas relativas al proyecto Rojo (`src/shared/...`, `default.project.json`). La resolución física ocurre únicamente dentro del puente local.
4. **Lista Cerrada de Operaciones Permitidas (`Allowlist`):** Nunca ejecuta comandos arbitrarios de consola. Solo acepta operaciones tipadas (`rojo.status`, `rojo.get_project_config`, `rojo.read_file`, `rojo.write_file`, `rojo.write_package`, `rojo.detect_changes`, `rojo.request_sync`, `rojo.check_build` y `studio.*`).
5. **Autenticación HMAC-SHA256 + Sesiones con Expiración:** Cada mensaje bajo el Contrato v1.0 incluye firma criptográfica HMAC-SHA256, `taskId` único con deduplicación idempotente, `sessionId` y ventana de tiempo anti-replay.
6. **Confirmación Obligatoria en Studio para Acciones Destructivas:** El plugin de Roblox Studio nunca destruye modelos, piezas ni carpetas automáticamente; presenta una barra de confirmación en el widget de Studio.

---

## ⚙️ Variables de Entorno Separadas por Entorno

### A. Servidor Remoto (Google AI Studio / Cloud Run)
| Variable | Obligatoria | Propósito |
| :--- | :---: | :--- |
| `GEMINI_API_KEY` | **SÍ** | Clave para llamadas a Gemini en Forge AI Studio. |
| `FORGE_BRIDGE_SHARED_SECRET` (o `FORGE_SECURITY_TOKEN`) | **SÍ** | Secreto compartido para validar handshakes y firmar tareas HMAC-SHA256 hacia el puente local. |

### B. Entorno Local en Windows (`forge-bridge/.env`)
| Variable | Obligatoria | Valor por Defecto | Propósito |
| :--- | :---: | :---: | :--- |
| `FORGE_CLOUD_URL` | **SÍ** | `http://127.0.0.1:3000` | URL de tu despliegue de Forge en Google AI Studio / Cloud Run. |
| `FORGE_BRIDGE_SHARED_SECRET` | **SÍ** | — | Mismo secreto compartido configurado en la nube. |
| `FORGE_PLUGIN_LOCAL_TOKEN` | **SÍ** | `forge-local-dev-token-2026` | Token exigido al Plugin de Roblox Studio en `127.0.0.1:48720`. |
| `ROJO_PROJECT_PATH` | **SÍ** | `../` | Ruta en Windows hacia la carpeta raíz de tu proyecto Rojo (`default.project.json`). |
| `BRIDGE_PORT` | No | `48720` | Puerto loopback local (`127.0.0.1:48720`). |
| `ROJO_PORT` | No | `34872` | Puerto local de `rojo serve`. |

---

## 🚀 Instalación y Ejecución en Windows (PowerShell)

```powershell
# 1. Entrar al directorio del puente
cd forge-bridge

# 2. Instalar dependencias
npm install

# 3. Crear archivo .env desde la plantilla
Copy-Item .env.example .env

# 4. Ejecutar pruebas automatizadas de seguridad e integración End-to-End
npm test

# 5. Iniciar el servicio en primer plano
npm run start

# O iniciarlo/detenerlo en segundo plano con los scripts de Windows:
powershell -ExecutionPolicy Bypass -File .\scripts\start-bridge.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\stop-bridge.ps1
```
