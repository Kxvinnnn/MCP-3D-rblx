--!strict
--[[
    Forge AI - Roblox Studio Plugin
    ================================
    Connects Roblox Studio to your local FastAPI Forge AI backend via HttpService.
    Place this script in your local Studio plugins folder (%LocalAppData%/Roblox/Plugins on Windows
    or ~/Library/Application Support/Roblox/Plugins on macOS) or save as a Local Plugin in Studio.
]]

local ChangeHistoryService = game:GetService("ChangeHistoryService")
local HttpService = game:GetService("HttpService")
local Selection = game:GetService("Selection")
local StarterGui = game:GetService("StarterGui")
local ServerScriptService = game:GetService("ServerScriptService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local StarterPlayer = game:GetService("StarterPlayer")

-- Configuration for local backend
local BACKEND_URL = "http://127.0.0.1:8000"

-- Check if HttpService is enabled
local function checkHttpEnabled(): boolean
    local success, _ = pcall(function()
        HttpService:GetAsync(BACKEND_URL .. "/api/v1/health")
    end)
    return success
end

-- Plugin Toolbar and UI Setup
local toolbar = plugin:CreateToolbar("Forge AI")
local openButton = toolbar:CreateButton(
    "Forge AI Studio",
    "Open Forge AI Luau & UI Generator",
    "rbxassetid://4458901886"
)

local widgetInfo = DockWidgetPluginGuiInfo.new(
    Enum.InitialDockState.Right,
    false, -- Initially enabled
    false, -- Override previous enabled state
    380,   -- Default width
    520,   -- Default height
    320,   -- Min width
    400    -- Min height
)

local dockWidget = plugin:CreateDockWidgetPluginGui("ForgeAIWidget", widgetInfo)
dockWidget.Title = "Forge AI - Luau & Rojo Copilot"

openButton.Click:Connect(function()
    dockWidget.Enabled = not dockWidget.Enabled
end)

-- Helper to deserialize JSON ui_tree directly into Roblox Instances in StarterGui
local function buildInstanceFromTree(nodeData: any, parent: Instance): Instance?
    local className = nodeData.class_name or "Frame"
    local instanceName = nodeData.name or "NewInstance"
    
    local ok, inst = pcall(function()
        return Instance.new(className)
    end)
    if not ok or not inst then
        warn("[Forge AI] Unsupported ClassName in ui_tree:", className)
        return nil
    end

    inst.Name = instanceName

    -- Apply properties
    if nodeData.properties and typeof(nodeData.properties) == "table" then
        for propName, propValue in pairs(nodeData.properties) do
            pcall(function()
                -- Common property type conversions from JSON
                if propName == "Size" and typeof(propValue) == "table" then
                    inst[propName] = UDim2.new(
                        propValue[1] or 0, propValue[2] or 0,
                        propValue[3] or 0, propValue[4] or 0
                    )
                elseif propName == "Position" and typeof(propValue) == "table" then
                    inst[propName] = UDim2.new(
                        propValue[1] or 0, propValue[2] or 0,
                        propValue[3] or 0, propValue[4] or 0
                    )
                elseif propName == "AnchorPoint" and typeof(propValue) == "table" then
                    inst[propName] = Vector2.new(propValue[1] or 0, propValue[2] or 0)
                elseif (propName == "BackgroundColor3" or propName == "TextColor3" or propName == "Color") and typeof(propValue) == "table" then
                    inst[propName] = Color3.fromRGB(propValue[1] or 255, propValue[2] or 255, propValue[3] or 255)
                elseif propName == "CornerRadius" and typeof(propValue) == "table" then
                    inst[propName] = UDim.new(propValue[1] or 0, propValue[2] or 8)
                else
                    inst[propName] = propValue
                end
            end)
        end
    end

    inst.Parent = parent

    -- Recursively build children
    if nodeData.children and typeof(nodeData.children) == "table" then
        for _, childNode in ipairs(nodeData.children) do
            buildInstanceFromTree(childNode, inst)
        end
    end

    return inst
end

-- Plugin GUI Construction (Pure Luau with strict responsive styling)
local rootFrame = Instance.new("Frame")
rootFrame.Size = UDim2.fromScale(1, 1)
rootFrame.BackgroundColor3 = Color3.fromRGB(24, 25, 29)
rootFrame.BorderSizePixel = 0
rootFrame.Parent = dockWidget

local padding = Instance.new("UIPadding")
padding.PaddingTop = UDim.new(0, 14)
padding.PaddingBottom = UDim.new(0, 14)
padding.PaddingLeft = UDim.new(0, 14)
padding.PaddingRight = UDim.new(0, 14)
padding.Parent = rootFrame

local listLayout = Instance.new("UIListLayout")
listLayout.SortOrder = Enum.SortOrder.LayoutOrder
listLayout.Padding = UDim.new(0, 10)
listLayout.Parent = rootFrame

-- Header
local titleLabel = Instance.new("TextLabel")
titleLabel.Text = "⚡ Forge AI: Luau & Rojo Engine"
titleLabel.Font = Enum.Font.GothamBold
titleLabel.TextSize = 16
titleLabel.TextColor3 = Color3.fromRGB(240, 240, 245)
titleLabel.Size = UDim2.new(1, 0, 0, 26)
titleLabel.BackgroundTransparency = 1
titleLabel.TextXAlignment = Enum.TextXAlignment.Left
titleLabel.LayoutOrder = 1
titleLabel.Parent = rootFrame

-- Status Indicator
local statusLabel = Instance.new("TextLabel")
statusLabel.Text = "Conectando al servidor local (http://127.0.0.1:8000)..."
statusLabel.Font = Enum.Font.Gotham
statusLabel.TextSize = 12
statusLabel.TextColor3 = Color3.fromRGB(160, 165, 180)
statusLabel.Size = UDim2.new(1, 0, 0, 20)
statusLabel.BackgroundTransparency = 1
statusLabel.TextXAlignment = Enum.TextXAlignment.Left
statusLabel.LayoutOrder = 2
statusLabel.Parent = rootFrame

-- Tab Selection Buttons (Script vs UI)
local tabContainer = Instance.new("Frame")
tabContainer.Size = UDim2.new(1, 0, 0, 32)
tabContainer.BackgroundTransparency = 1
tabContainer.LayoutOrder = 3
tabContainer.Parent = rootFrame

local tabLayout = Instance.new("UIListLayout")
tabLayout.FillDirection = Enum.FillDirection.Horizontal
tabLayout.Padding = UDim.new(0, 8)
tabLayout.Parent = tabContainer

local scriptTabBtn = Instance.new("TextButton")
scriptTabBtn.Text = "📄 Generar Script"
scriptTabBtn.Font = Enum.Font.GothamMedium
scriptTabBtn.TextSize = 12
scriptTabBtn.Size = UDim2.new(0.48, 0, 1, 0)
scriptTabBtn.BackgroundColor3 = Color3.fromRGB(59, 130, 246)
scriptTabBtn.TextColor3 = Color3.fromRGB(255, 255, 255)
scriptTabBtn.Parent = tabContainer
local btnCorner1 = Instance.new("UICorner")
btnCorner1.CornerRadius = UDim.new(0, 6)
btnCorner1.Parent = scriptTabBtn

local uiTabBtn = Instance.new("TextButton")
uiTabBtn.Text = "🎨 ForgeGUI (UI)"
uiTabBtn.Font = Enum.Font.GothamMedium
uiTabBtn.TextSize = 12
uiTabBtn.Size = UDim2.new(0.48, 0, 1, 0)
uiTabBtn.BackgroundColor3 = Color3.fromRGB(38, 42, 53)
uiTabBtn.TextColor3 = Color3.fromRGB(180, 185, 200)
uiTabBtn.Parent = tabContainer
local btnCorner2 = Instance.new("UICorner")
btnCorner2.CornerRadius = UDim.new(0, 6)
btnCorner2.Parent = uiTabBtn

-- Mode state
local activeMode = "Script" -- "Script" | "UI"

-- Input Prompt Box
local promptBox = Instance.new("TextBox")
promptBox.PlaceholderText = "Describe el sistema o UI: ej. 'Sistema de inventario con DataStore y Maid' o 'Tienda Cyberpunk modal con animaciones Tween'"
promptBox.Text = ""
promptBox.ClearTextOnFocus = false
promptBox.MultiLine = true
promptBox.Font = Enum.Font.Gotham
promptBox.TextSize = 12
promptBox.TextColor3 = Color3.fromRGB(230, 230, 235)
promptBox.BackgroundColor3 = Color3.fromRGB(32, 35, 45)
promptBox.Size = UDim2.new(1, 0, 0, 110)
promptBox.TextXAlignment = Enum.TextXAlignment.Left
promptBox.TextYAlignment = Enum.TextYAlignment.Top
promptBox.LayoutOrder = 4
promptBox.Parent = rootFrame
local promptCorner = Instance.new("UICorner")
promptCorner.CornerRadius = UDim.new(0, 8)
promptCorner.Parent = promptBox
local promptPadding = Instance.new("UIPadding")
promptPadding.PaddingTop = UDim.new(0, 8)
promptPadding.PaddingBottom = UDim.new(0, 8)
promptPadding.PaddingLeft = UDim.new(0, 8)
promptPadding.PaddingRight = UDim.new(0, 8)
promptPadding.Parent = promptBox

-- Action Generate Button
local actionBtn = Instance.new("TextButton")
actionBtn.Text = "🚀 Generar con Gemini & Rojo"
actionBtn.Font = Enum.Font.GothamBold
actionBtn.TextSize = 13
actionBtn.TextColor3 = Color3.fromRGB(255, 255, 255)
actionBtn.BackgroundColor3 = Color3.fromRGB(16, 185, 129)
actionBtn.Size = UDim2.new(1, 0, 0, 38)
actionBtn.LayoutOrder = 5
actionBtn.Parent = rootFrame
local actionCorner = Instance.new("UICorner")
actionCorner.CornerRadius = UDim.new(0, 8)
actionCorner.Parent = actionBtn

-- Output Info Box
local infoBox = Instance.new("TextLabel")
infoBox.Text = "Listo. Los scripts generados se guardarán automáticamente en tu carpeta Rojo configurada (src/server, src/client, etc.)."
infoBox.Font = Enum.Font.Code
infoBox.TextSize = 11
infoBox.TextColor3 = Color3.fromRGB(140, 145, 160)
infoBox.BackgroundColor3 = Color3.fromRGB(18, 20, 26)
infoBox.Size = UDim2.new(1, 0, 0, 140)
infoBox.TextXAlignment = Enum.TextXAlignment.Left
infoBox.TextYAlignment = Enum.TextYAlignment.Top
infoBox.TextWrapped = true
infoBox.LayoutOrder = 6
infoBox.Parent = rootFrame
local infoCorner = Instance.new("UICorner")
infoCorner.CornerRadius = UDim.new(0, 8)
infoCorner.Parent = infoBox

-- Tab switches
scriptTabBtn.MouseButton1Click:Connect(function()
    activeMode = "Script"
    scriptTabBtn.BackgroundColor3 = Color3.fromRGB(59, 130, 246)
    scriptTabBtn.TextColor3 = Color3.fromRGB(255, 255, 255)
    uiTabBtn.BackgroundColor3 = Color3.fromRGB(38, 42, 53)
    uiTabBtn.TextColor3 = Color3.fromRGB(180, 185, 200)
    actionBtn.Text = "🚀 Generar Script Luau"
end)

uiTabBtn.MouseButton1Click:Connect(function()
    activeMode = "UI"
    uiTabBtn.BackgroundColor3 = Color3.fromRGB(139, 92, 246)
    uiTabBtn.TextColor3 = Color3.fromRGB(255, 255, 255)
    scriptTabBtn.BackgroundColor3 = Color3.fromRGB(38, 42, 53)
    scriptTabBtn.TextColor3 = Color3.fromRGB(180, 185, 200)
    actionBtn.Text = "🎨 Generar ForgeGUI & Instancias"
end)

-- Generation handler
actionBtn.MouseButton1Click:Connect(function()
    local promptText = promptBox.Text
    if #promptText < 5 then
        infoBox.Text = "⚠️ Por favor escribe una descripción más detallada para generar el código."
        return
    end

    actionBtn.Text = "⏳ Consultando a Gemini..."
    actionBtn.Active = false

    task.spawn(function()
        local record = ChangeHistoryService:SetWaypoint("Forge AI Generation")

        if activeMode == "Script" then
            local payload = HttpService:JSONEncode({
                prompt = promptText,
                script_type = "Server",
                model_tier = "fast",
                save_to_rojo = true,
            })

            local ok, response = pcall(function()
                return HttpService:RequestAsync({
                    Url = BACKEND_URL .. "/api/v1/generate-script",
                    Method = "POST",
                    Headers = { ["Content-Type"] = "application/json" },
                    Body = payload,
                })
            end)

            if ok and response.Success then
                local data = HttpService:JSONDecode(response.Body)
                infoBox.Text = string.format(
                    "✅ Script generado exitosamente!\nArchivo: %s\nCarpeta Rojo: %s\nRuta local: %s\n\nExplicación: %s",
                    data.file_name or "script.luau",
                    data.rojo_target_folder or "src/server",
                    data.saved_path or "Guardado vía Rojo",
                    data.explanation or ""
                )
            else
                infoBox.Text = "❌ Error al contactar el servidor local. Asegúrate de que FastAPI esté corriendo (uvicorn main:app) y que HttpService esté habilitado en Game Settings."
            end

        elseif activeMode == "UI" then
            local payload = HttpService:JSONEncode({
                prompt = promptText,
                style_theme = "Dark Cyberpunk",
                save_to_rojo = true,
                model_tier = "fast",
            })

            local ok, response = pcall(function()
                return HttpService:RequestAsync({
                    Url = BACKEND_URL .. "/api/v1/generate-ui",
                    Method = "POST",
                    Headers = { ["Content-Type"] = "application/json" },
                    Body = payload,
                })
            end)

            if ok and response.Success then
                local data = HttpService:JSONDecode(response.Body)
                
                -- Also instantiate GUI in StarterGui if ui_tree is present
                if data.ui_tree then
                    local screenGui = Instance.new("ScreenGui")
                    screenGui.Name = data.file_name:gsub("%.luau$", "")
                    screenGui.ResetOnSpawn = false
                    screenGui.Parent = StarterGui

                    buildInstanceFromTree(data.ui_tree, screenGui)
                    Selection:Set({ screenGui })
                end

                infoBox.Text = string.format(
                    "✅ ForgeGUI Generado!\nArchivo: %s\nÁrbol de instancias insertado en StarterGui.\nRuta Rojo: %s\n\n%s",
                    data.file_name,
                    data.saved_path or "src/client/UI",
                    data.explanation or ""
                )
            else
                infoBox.Text = "❌ Error en generación de UI. Revisa la consola de FastAPI."
            end
        end

        actionBtn.Text = activeMode == "Script" and "🚀 Generar Script Luau" or "🎨 Generar ForgeGUI & Instancias"
        actionBtn.Active = true
    end)
end)

-- Health check on load
task.spawn(function()
    local ok, res = pcall(function()
        return HttpService:GetAsync(BACKEND_URL .. "/api/v1/health")
    end)
    if ok then
        local data = HttpService:JSONDecode(res)
        statusLabel.Text = string.format("🟢 Conectado | Rojo: %s", data.rojo_path_exists and "Encontrado" or "Ruta no creada")
        statusLabel.TextColor3 = Color3.fromRGB(52, 211, 153)
    else
        statusLabel.Text = "🔴 Servidor local desconectado en http://127.0.0.1:8000"
        statusLabel.TextColor3 = Color3.fromRGB(248, 113, 113)
    end
end)
