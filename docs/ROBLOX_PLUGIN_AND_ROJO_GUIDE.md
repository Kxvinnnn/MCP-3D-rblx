# Guía del Plugin de Roblox Studio v2.3.0, Forge Local Bridge y Sincronización Rojo 7.x

Esta guía explica cómo conectar **NIGHTMARE FORGE / Forge AI Studio v2.3.0** con **Roblox Studio** utilizando **Forge Local Bridge (`127.0.0.1:48720`)**, **Rojo 7.x (`:34872`)** y el plugin nativo **`ForgeAIStudioPlugin.server.luau`**.

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

## 2. Instalación y Uso del Servicio `Forge Local Bridge` (127.0.0.1:48720)

El puente local (`forge-bridge/`) permite a Forge AI Studio comunicarse con Rojo y Roblox Studio sin abrir puertos de entrada en Windows.

### 2.1 Configuración de Variables (`forge-bridge/.env`)
Genera primero un secreto aleatorio de 32 bytes (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`) y configúralo en `forge-bridge/.env`:
```bash
BRIDGE_PORT=48720
BRIDGE_HOST=127.0.0.1
FORGE_CLOUD_URL="http://127.0.0.1:3000"
FORGE_BRIDGE_SHARED_SECRET="<TU_SECRETO_ALEATORIO_32_BYTES>"
FORGE_PLUGIN_LOCAL_TOKEN="<TU_SECRETO_ALEATORIO_32_BYTES>"
ROJO_PROJECT_PATH="../rojo_workspace"
ROJO_PORT=34872
```

### 2.2 Inicio y Parada en Windows
- **Iniciar**: Ejecutar `./scripts/start-bridge.ps1` o `npm --prefix forge-bridge start`.
- **Detener**: Ejecutar `./scripts/stop-bridge.ps1`.
- **Verificar Estado**: `GET http://127.0.0.1:48720/local/status`.

---

## 3. Instalación del Plugin `ForgeAIStudioPlugin.server.luau` v2.3.0

1. Copia `backend/roblox_plugin/ForgeAIStudioPlugin.server.luau` en la carpeta de Plugins de Roblox Studio:
   - **Windows**: `%LocalAppData%\Roblox\Plugins\ForgeAIStudioPlugin.server.luau`
   - **macOS**: `~/Library/Application Support/Roblox/Plugins/ForgeAIStudioPlugin.server.luau`
2. En Roblox Studio, abre **Game Settings → Security** y habilita **Allow HTTP Requests**.
3. En el DockWidget de **Forge AI v2.3.0**:
   - Configura **Local Bridge URL** (por defecto `http://127.0.0.1:48720`).
   - Configura **Security Token** (el mismo token definido en `FORGE_PLUGIN_LOCAL_TOKEN`).
   - El plugin guardará la configuración automáticamente con `plugin:SetSetting`.

---

## 4. Capacidades del Plugin de Roblox Studio v2.3.0

### 4.1 Modificación Real del DataModel (`studio.apply_modifications`)
- Recibe especificaciones completas de modelos o selecciones parciales desde Forge.
- Si el modelo existe en `Workspace`, ejecuta una **actualización incremental in-place** (`applyIncrementalModelUpdateInStudio`):
  - Actualiza `CFrame` relativo al pivote del modelo (`ForgeSyncOriginCFrame`).
  - Actualiza `Color3`, `Material`, `Transparency` y `Reflectance`.
  - Reconstruye `EditableMesh` únicamente en piezas cuya geometría cambió.
  - Asigna `SurfaceAppearance` si existen `rbxassetid://` publicados.
  - Conserva scripts hijos, welds y accesorios personalizados.

### 4.2 Cola de Confirmaciones Destructivas (Regla de Seguridad)
- **NUNCA** se eliminan piezas automáticamente sin interacción del usuario.
- Si una sincronización implica eliminar piezas ausentes, el plugin las añade a una cola protegida y muestra un banner en el DockWidget:
  `⚠️ Confirmar eliminación de N piezas en 'Modelo' [Confirmar] [Cancelar]`.

### 4.3 Inspección y Serialización del DataModel (`studio.get_selection` / `studio.serialize_parts`)
- Serializa la selección activa en espacio de coordenadas del modelo (`originCFrame:ToObjectSpace(part.CFrame)`).
- Calcula los 5 hashes canónicos FNV-1a de 32 bits (`geometryHash`, `materialHash`, `transformHash`, `hierarchyHash`, `combinedHash`) idénticos a Python y TypeScript.
- Identifica `MeshPart.MeshId` reales y mapas de `SurfaceAppearance`.

### 4.4 Verificador de Sincronización Rojo y Autoverificación
- Consulta el manifiesto de Rojo y compara el hash FNV32 del código Luau en memoria y en disco.
- Ejecuta autochequeos unitarios en Luau (`runForgePluginSelfVerification`) validando la sensibilidad de hashes ante mutaciones de vértices intermedios y renombrado de piezas.
- **Estado de Validación**: La estructura Luau `--!strict`, el límite de `20,000` vértices/caras, los endpoints del Bridge y la reconciliación de recibos están **TESTEADOS** en la suite automatizada; la ejecución visual directa dentro de **Roblox Studio Desktop** requiere validación manual interactiva.

---

## 5. Checklist de Validación Manual Real en Roblox Studio Desktop

1. **Preparar entorno**: Inicia `npm run dev` (puerto `3000`) y `npm --prefix forge-bridge start` (`127.0.0.1:48720`) con el mismo token seguro en `.env` y `forge-bridge/.env`.
2. **Habilitar permisos en Studio**: Abre un Place en Roblox Studio -> `Game Settings -> Security -> Allow HTTP Requests = ON`, y activa `EditableMesh` si tu canal de Studio lo requiere.
3. **Conectar el Plugin v2.3.0**: Abre el DockWidget **Forge AI v2.3.0**, ingresa `http://127.0.0.1:48720` y tu `Security Token`, y verifica que el estado muestre **Conectado**.
4. **Probar árbol 3D de punta a punta**:
   - Genera un árbol en la web (ej. *"Genera un árbol de fantasía con tronco grueso, copa amplia, hojas rojizas y estilo low-poly"*).
   - Pulsa **Enviar a Roblox Studio** y observa la creación de todas las `MeshPart` (`RootFlare`, `MainTrunk`, `Branch_*`, `CanopyCrown_Main`, `FoliageCluster_*`) en `Workspace` con pivote en `Y = 0`.
5. **Verificar exportación y reconstrucción**: Comprueba en la ventana **Output** de Studio que no existan errores de `EditableMesh` / `SetFaceNormals` / `SetFaceUVs`, que la consola devuelva `verified: true` hacia Forge y que la importación manual del `.rbxmx` o `.luau` exportado genere exactamente la misma geometría.
