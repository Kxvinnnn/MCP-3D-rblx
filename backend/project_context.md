# Contexto del Proyecto Roblox: Arquitectura Rojo & Convenciones Luau

> Este archivo es leído dinámicamente por **Forge AI Backend** antes de cada consulta a Gemini.
> Cualquier convención, módulo preexistente o estructura definida aquí será respetada por la IA al generar código.

---

## 1. Mapeo de Proyecto Rojo (`default.project.json`)

El proyecto utiliza **Rojo 7.x** con la siguiente distribución hacia el DataModel de Roblox Studio:

```
[Directorio Local de Rojo]                 [DataModel en Roblox Studio]
├── src/
│   ├── server/           --------->      game.ServerScriptService.Server
│   │   └── ... (*.server.luau, *.luau)
│   ├── client/           --------->      game.StarterPlayer.StarterPlayerScripts.Client
│   │   ├── Controllers/  --------->      Controladores de cliente (Knit / Singletons)
│   │   ├── UI/           --------->      game.StarterGui.Interface (Componentes ScreenGui)
│   │   └── ... (*.client.luau)
│   └── shared/           --------->      game.ReplicatedStorage.Shared
│       ├── Types/        --------->      Definiciones de tipos exportados (export type ...)
│       ├── Utils/        --------->      Utilidades (Maid, Signal, Promise)
│       └── Network/      --------->      Definición de RemoteEvents y RemoteFunctions
```

---

## 2. Estándares Innegociables de Código Luau

1. **Modo Estricto Obligatorio:**
   - La primera línea de absolutamente cualquier archivo generado DEBE ser:
     ```luau
     --!strict
     ```
   - Tipado estático riguroso en argumentos, retornos, tablas y variables locales.

2. **Servicios de Roblox:**
   - Declarados siempre al principio del script usando `game:GetService(...)` en orden alfabético o de uso:
     ```luau
     local Players = game:GetService("Players")
     local ReplicatedStorage = game:GetService("ReplicatedStorage")
     local TweenService = game:GetService("TweenService")
     local UserInputService = game:GetService("UserInputService")
     ```

3. **Librería de Tareas Moderna (task library):**
   - **PROHIBIDO** el uso de funciones heredadas/deprecadas: `wait()`, `spawn()`, `delay()`.
   - **OBLIGATORIO** el uso exclusivo de:
     - `task.wait(seconds)`
     - `task.spawn(fn, ...)`
     - `task.delay(seconds, fn, ...)`
     - `task.defer(fn, ...)`

4. **Gestión de Memoria y Patrón Maid:**
   - Cualquier conexión a eventos (`RBXScriptConnection`), animación o instancia creada dinámicamente DEBE registrarse en un `Maid` o `Janitor` para evitar memory leaks.
   - Todo componente debe exponer un método `:Destroy()` que invoque `self._maid:DoCleaning()`.

---

## 3. Implementación Estándar de Maid (Referencia en `ReplicatedStorage.Shared.Utils.Maid`)

```luau
--!strict
local Maid = {}
Maid.__index = Maid

export type MaidTask = RBXScriptConnection | Instance | (() -> ()) | { Destroy: (any) -> () } | { disconnect: (any) -> () }

export type Maid = typeof(setmetatable({} :: {
    _tasks: { [any]: MaidTask },
}, Maid))

function Maid.new(): Maid
    local self = setmetatable({
        _tasks = {},
    }, Maid)
    return self
end

function Maid:GiveTask(taskItem: MaidTask): any
    local taskId = #self._tasks + 1
    self._tasks[taskId] = taskItem
    return taskId
end

function Maid:DoCleaning()
    local tasks = self._tasks
    for key, taskItem in pairs(tasks) do
        if typeof(taskItem) == "RBXScriptConnection" then
            taskItem:Disconnect()
        elseif typeof(taskItem) == "Instance" then
            taskItem:Destroy()
        elseif typeof(taskItem) == "function" then
            taskItem()
        elseif typeof(taskItem) == "table" and typeof((taskItem :: any).Destroy) == "function" then
            (taskItem :: any):Destroy()
        elseif typeof(taskItem) == "table" and typeof((taskItem :: any).disconnect) == "function" then
            (taskItem :: any):disconnect()
        end
        tasks[key] = nil
    end
end

function Maid:Destroy()
    self:DoCleaning()
end

return Maid
```

---

## 4. Convenciones de UI (ForgeGUI Engine)

Para garantizar interfaces responsive en cualquier dispositivo (PC, Móvil, Consola):

- **Escalado 100% Responsive (Scale):**
  - Los contenedores principales usan `UDim2.fromScale(widthScale, heightScale)` y `AnchorPoint = Vector2.new(0.5, 0.5)`.
  - **PROHIBIDO** usar valores fijos en Offset para el tamaño general del viewport o de las ventanas modales.
  - El Offset solo se permite en elementos de padding interno (`UIPadding`) o grosor de borde (`UIStroke.Thickness`).

- **Restricción de Proporción:**
  - Agregar `UIAspectRatioConstraint` en iconos, botones cuadrados o vistas previas 3D.

- **Estilizado Moderno Roblox:**
  - `UICorner`: Para bordes redondeados pulidos (`UDim.new(0, 8)` o `UDim.new(0, 12)`).
  - `UIStroke`: Para contornos limpios (`ApplyStrokeMode = Enum.ApplyStrokeMode.Border`).
  - `UIGradient`: Para iluminación y efectos degradados.
  - `UIListLayout` / `UIGridLayout`: Con `SortOrder = Enum.SortOrder.LayoutOrder`.

- **Animaciones TweenService:**
  - Siempre crear transiciones de apertura con `TweenInfo.new(0.35, Enum.EasingStyle.Back, Enum.EasingDirection.Out)` o `Enum.EasingStyle.Quad`.
  - Efectos Hover en botones conectando `MouseEnter` y `MouseLeave` limpiados a través del `Maid`.

---

## 5. Módulos y Singletons Existentes en el Proyecto

- `ReplicatedStorage.Shared.Utils.Maid` (Limpieza de memoria y conexiones)
- `ReplicatedStorage.Shared.Network.RemoteProvider` (Gestor de RemoteEvents fuertemente tipados)
- `ReplicatedStorage.Shared.Types.GameTypes` (Estructuras de datos compartidas: PlayerData, InventoryItem)
- `ServerScriptService.Server.Services.DataStoreService` (Manejo seguro de datos con session-locking)
