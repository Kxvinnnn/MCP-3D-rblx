# Guía del Plugin de Roblox Studio v2.0 y Sincronización Rojo 7.x

Esta guía explica cómo conectar **Forge AI Studio v2.0** con **Roblox Studio** utilizando **Rojo 7.x** y el plugin nativo **`ForgeAIStudioPlugin.server.luau`**.

---

## 1. Mapeo de Carpetas de Rojo 7.x (`default.project.json`)

El archivo `rojo_workspace/default.project.json` mapea automáticamente las carpetas en disco hacia el `DataModel` de Roblox Studio en el puerto `34872`:

| Carpeta en Disco (`ROJO_PROJECT_PATH`) | Ubicación en Roblox Studio (`DataModel`) | Uso Principal |
| :--- | :--- | :--- |
| `src/server/` | `ServerScriptService.Server` | Scripts de servidor (`*.server.luau`) y lógica autoritativa. |
| `src/client/` | `StarterPlayer.StarterPlayerScripts.Client` | Controladores locales (`*.client.luau`) e input del jugador. |
| `src/client/UI/` | `StarterGui.Interface` | Módulos `ScreenGui`, HUDs y `ViewportFrame` 3D generados por `UI Engine`. |
| `src/shared/` | `ReplicatedStorage.Shared` | Módulos compartidos y escenarios generados por `World Engine`. |
| `src/shared/Assets3D/` | `ReplicatedStorage.Shared.Assets3D` | Constructores de modelos 3D (`.Spawn(CFrame)`) generados por `3D Generation Engine`. |
| `src/shared/Utils/Maid.luau` | `ReplicatedStorage.Shared.Utils.Maid` | Gestión de memoria y limpieza de `RBXScriptConnection` e instancias. |
| `src/shared/Network/RemoteProvider.luau` | `ReplicatedStorage.Shared.Network.RemoteProvider` | Contenedor tipado de `RemoteEvent` y `RemoteFunction`. |
| `src/shared/Types/GameTypes.luau` | `ReplicatedStorage.Shared.Types.GameTypes` | Definiciones de tipos estáticos Luau (`--!strict`). |

---

## 2. Instalación del Plugin `ForgeAIStudioPlugin.server.luau` v2.0

1. Abre la pestaña **Código Motores (FastAPI)** en la interfaz web de Forge AI Studio y selecciona `roblox_plugin/ForgeAIStudioPlugin.server.luau` (o encuéntralo en `backend/roblox_plugin/ForgeAIStudioPlugin.server.luau`).
2. Copia o descarga el archivo en la carpeta de Plugins de Roblox Studio de tu sistema operativo:
   - **Windows**: `%LocalAppData%\Roblox\Plugins\ForgeAIStudioPlugin.server.luau`
   - **macOS**: `~/Library/Application Support/Roblox/Plugins/ForgeAIStudioPlugin.server.luau`
3. En Roblox Studio, abre **Game Settings → Security** y habilita **Allow HTTP Requests**.
4. Aparecerá el botón **Forge AI v2.0** en la barra de herramientas de Plugins.

---

## 3. Capacidades del Plugin de Roblox Studio v2.0

El plugin `ForgeAIStudioPlugin.server.luau` resuelve todas las limitaciones de la primera versión e incluye 4 herramientas integradas en su `DockWidgetPluginGui`:

### 3.1 Selector Dinámico de Tipo de Script (`Server | Client | Module`)
- Permite alternar con un clic entre `Server` (`ServerScriptService`), `Client` (`StarterPlayerScripts`) y `Module` (`ReplicatedStorage`) antes de generar un script, además de elegir el tier de modelo (`fast` o `pro`).

### 3.2 Generador e Importador de Modelos 3D en `Workspace`
- Invoca `POST /api/v1/generate-3d` y reconstruye inmediatamente en `Workspace` un objeto `Model` con todas sus sub-partes (`Part`, `WedgePart`, `CornerWedgePart`), aplicando `Size`, `CFrame`, `Color3`, `Enum.Material`, `Transparency`, `PrimaryPart` y atributos PBR (`Roughness`, `Metalness`, `CollisionFidelity`), registrando un waypoint en `ChangeHistoryService` para permitir `Ctrl+Z` (*Undo*).

### 3.3 Optimizador de Geometría y Colisiones sobre `Selection:Get()`
- Al seleccionar cualquier `Model` o `BasePart` en el visor de Roblox Studio y pulsar **Optimizar Selección**, el plugin recorre la jerarquía seleccionada, habilita `Anchored`, ajusta materiales, aplica atributos de `CollisionFidelity` y reporta el conteo de partes optimizadas.

### 3.4 Verificador de Sincronización Rojo con SHA-256
- Consulta `GET /api/v1/rojo/sync-manifest` y comprueba en tiempo real dentro del `DataModel` de Roblox Studio (`ServerScriptService`, `StarterPlayerScripts`, `StarterGui`, `ReplicatedStorage`) que cada módulo `.luau` listado en el manifiesto del servidor haya sido sincronizado correctamente por Rojo.
