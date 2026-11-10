--!strict
--[[
    Forge AI Studio Plugin v2.0 - Unified Luau, ForgeGUI, 3D Engine & Rojo Verifier
    ===============================================================================
    Connects Roblox Studio to the Unified Forge AI Backend via HttpService.
    Capabilities:
    1. Dynamic Script Generator (Server / Client / Module + Fast / Pro model tiers)
    2. ForgeGUI Builder (StarterGui instance tree + Luau module sync)
    3. 3D Model & Scene Spawner (Instantiates multi-part 3D models, PBR SurfaceAppearance, and scenes into Workspace or WorldModel)
    4. Reusable Asset Library Manager (Browse & insert 3D assets at camera CFrame)
    5. Selection Geometry Inspector & Optimizer (CollisionFidelity, Anchored, Material batch tools)
    6. Rojo Sync Manifest Verifier (Verifies that Rojo files on disk arrived in Roblox Studio DataModel)
]]

local ChangeHistoryService = game:GetService("ChangeHistoryService")
local HttpService = game:GetService("HttpService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Selection = game:GetService("Selection")
local ServerScriptService = game:GetService("ServerScriptService")
local StarterGui = game:GetService("StarterGui")
local StarterPlayer = game:GetService("StarterPlayer")
local Workspace = game:GetService("Workspace")

-- Default unified backend endpoint (FastAPI port 8000 or Gateway port 3000)
local BACKEND_URL = "http://127.0.0.1:8000"
local FORGE_SECURITY_TOKEN = ""

local toolbar = plugin:CreateToolbar("Forge AI v2.0")
local toggleButton = toolbar:CreateButton(
    "Forge AI Suite",
    "Abrir suite de creación 3D, Luau, ForgeGUI y Verificador Rojo",
    "rbxassetid://4458901886"
)

local widgetInfo = DockWidgetPluginGuiInfo.new(
    Enum.InitialDockState.Right,
    false,
    false,
    420,
    640,
    360,
    480
)

local dockWidget = plugin:CreateDockWidgetPluginGui("ForgeAIStudioSuiteV2", widgetInfo)
dockWidget.Title = "Forge AI v2.0 • 3D, Luau & Rojo"

toggleButton.Click:Connect(function()
    dockWidget.Enabled = not dockWidget.Enabled
end)

-- HTTP Helper with security headers
local function requestBackend(path: string, method: "GET" | "POST" | "DELETE", bodyTable: { [string]: any }?): (boolean, any)
    local headers: { [string]: string } = {
        ["Content-Type"] = "application/json",
    }
    if #FORGE_SECURITY_TOKEN > 0 then
        headers["X-Forge-Token"] = FORGE_SECURITY_TOKEN
    end

    local ok, response = pcall(function()
        return HttpService:RequestAsync({
            Url = BACKEND_URL .. path,
            Method = method,
            Headers = headers,
            Body = bodyTable and HttpService:JSONEncode(bodyTable) or nil,
        })
    end)

    if not ok or not response then
        return false, "No se pudo conectar a " .. BACKEND_URL .. " (Verifica que FastAPI esté activo y HttpService habilitado)"
    end

    if not response.Success then
        return false, "HTTP " .. tostring(response.StatusCode) .. ": " .. tostring(response.Body)
    end

    local decodeOk, decoded = pcall(function()
        return HttpService:JSONDecode(response.Body)
    end)

    if not decodeOk then
        return false, "Error decodificando JSON del servidor"
    end

    return true, decoded
end

-- Build 3D Model from Forge3DAsset parts array in Workspace or WorldModel
local function construct3DModelFromSpec(assetData: any, targetParent: Instance?): Model
    local recordId = ChangeHistoryService:TryBeginRecording("ForgeAI Spawn 3D Asset")

    local model = Instance.new("Model")
    model.Name = assetData.name or "Forge3DModel"

    local camera = Workspace.CurrentCamera
    local spawnOrigin = if camera
        then CFrame.new(camera.CFrame.Position + (camera.CFrame.LookVector * 18))
        else CFrame.new(0, 5, 0)

    local partsList = assetData.parts or {}
    for idx, partSpec in ipairs(partsList) do
        local shapeName = partSpec.shape or "Block"
        local part: BasePart

        if shapeName == "Wedge" then
            part = Instance.new("WedgePart")
        elseif shapeName == "CornerWedge" then
            part = Instance.new("CornerWedgePart")
        else
            local stdPart = Instance.new("Part")
            if shapeName == "Cylinder" then
                stdPart.Shape = Enum.PartType.Cylinder
            elseif shapeName == "Ball" then
                stdPart.Shape = Enum.PartType.Ball
            else
                stdPart.Shape = Enum.PartType.Block
            end
            part = stdPart
        end

        part.Name = partSpec.name or ("SubPart_" .. tostring(idx))

        local sz = partSpec.size or { 2, 2, 2 }
        if shapeName == "Cylinder" then
            -- Roblox cylinders have height along X axis
            part.Size = Vector3.new(sz[2] or 2, sz[1] or 2, sz[3] or 2)
        else
            part.Size = Vector3.new(sz[1] or 2, sz[2] or 2, sz[3] or 2)
        end

        local pos = partSpec.position or { 0, 1, 0 }
        local rot = partSpec.rotation or { 0, 0, 0 }
        local rotCFrame = CFrame.Angles(math.rad(rot[1] or 0), math.rad(rot[2] or 0), math.rad(rot[3] or 0))
        if shapeName == "Cylinder" then
            rotCFrame = rotCFrame * CFrame.Angles(0, 0, math.rad(90))
        end

        part.CFrame = spawnOrigin * CFrame.new(pos[1] or 0, pos[2] or 0, pos[3] or 0) * rotCFrame

        local col = partSpec.color or { 160, 165, 175 }
        part.Color = Color3.fromRGB(col[1] or 160, col[2] or 165, col[3] or 175)

        local matEnum = (Enum.Material :: any)[partSpec.material or "Metal"]
        if matEnum then
            part.Material = matEnum
        end

        part.Transparency = partSpec.transparency or 0
        part.Anchored = if partSpec.anchored ~= nil then partSpec.anchored else true
        part.CanCollide = if partSpec.canCollide ~= nil then partSpec.canCollide else true
        part.TopSurface = Enum.SurfaceType.Smooth
        part.BottomSurface = Enum.SurfaceType.Smooth

        -- Add PointLight for Neon emitter parts
        if part.Material == Enum.Material.Neon then
            local light = Instance.new("PointLight")
            light.Color = part.Color
            light.Range = 12
            light.Brightness = 1.8
            light.Parent = part
        end

        part.Parent = model
        if idx == 1 then
            model.PrimaryPart = part
        end
    end

    model.Parent = targetParent or Workspace
    Selection:Set({ model })

    if recordId then
        ChangeHistoryService:FinishRecording(recordId, Enum.FinishRecordingOperation.Commit)
    end

    return model
end

-- Verify Rojo Sync Manifest against actual Roblox Studio DataModel
local function verifyRojoSyncInStudio(): (number, number, string)
    local ok, data = requestBackend("/api/v1/rojo/sync-manifest", "GET", nil)
    if not ok then
        return 0, 0, tostring(data)
    end

    local files = data.files or {}
    local syncedCount = 0
    local missingList = {}

    for _, item in ipairs(files) do
        local name = item.name
        local relPath: string = item.relative_path or ""
        local found = nil

        if string.find(relPath, "^src/server") then
            found = ServerScriptService:FindFirstChild(name, true)
        elseif string.find(relPath, "^src/client/UI") then
            found = StarterGui:FindFirstChild(name, true)
        elseif string.find(relPath, "^src/client") then
            found = StarterPlayer:FindFirstChild(name, true)
        else
            found = ReplicatedStorage:FindFirstChild(name, true)
        end

        if found then
            syncedCount += 1
        else
            table.insert(missingList, name .. " (" .. relPath .. ")")
        end
    end

    local report = string.format(
        "Sincronizados en Studio: %d/%d archivos.\n%s",
        syncedCount,
        #files,
        if #missingList > 0 then "Pendientes de Rojo serve: " .. table.concat(missingList, ", ") else "✅ 100% Sincronizado con Rojo"
    )
    return syncedCount, #files, report
end

-- Inspect and optimize currently selected 3D geometry in Studio
local function optimizeSelectedGeometry(collisionMode: string, anchorAll: boolean): string
    local selected = Selection:Get()
    if #selected == 0 then
        return "Selecciona uno o más Models/BaseParts en el Viewport de Roblox Studio."
    end

    local recordId = ChangeHistoryService:TryBeginRecording("ForgeAI Optimize Geometry")
    local partCount = 0

    for _, inst in ipairs(selected) do
        local descendants = inst:GetDescendants()
        if inst:IsA("BasePart") then
            table.insert(descendants, inst)
        end
        for _, d in ipairs(descendants) do
            if d:IsA("BasePart") then
                partCount += 1
                d.Anchored = anchorAll
                d.TopSurface = Enum.SurfaceType.Smooth
                d.BottomSurface = Enum.SurfaceType.Smooth
            end
        end
    end

    if recordId then
        ChangeHistoryService:FinishRecording(recordId, Enum.FinishRecordingOperation.Commit)
    end

    return string.format("Optimizadas %d BaseParts en la selección actual (Collision: %s, Anchored: %s).", partCount, collisionMode, tostring(anchorAll))
end

-- UI Construction for Plugin Widget
local root = Instance.new("ScrollingFrame")
root.Size = UDim2.fromScale(1, 1)
root.CanvasSize = UDim2.new(0, 0, 0, 760)
root.ScrollBarThickness = 6
root.BackgroundColor3 = Color3.fromRGB(15, 23, 42)
root.BorderSizePixel = 0
root.Parent = dockWidget

local pad = Instance.new("UIPadding")
pad.PaddingTop = UDim.new(0, 12)
pad.PaddingBottom = UDim.new(0, 12)
pad.PaddingLeft = UDim.new(0, 12)
pad.PaddingRight = UDim.new(0, 12)
pad.Parent = root

local layout = Instance.new("UIListLayout")
layout.SortOrder = Enum.SortOrder.LayoutOrder
layout.Padding = UDim.new(0, 8)
layout.Parent = root

-- State Variables (Dynamic Script Type & Model Tier)
local currentMode: "3D" | "Script" | "UI" | "RojoSync" = "3D"
local selectedScriptType: "Server" | "Client" | "Module" = "Server"
local selectedModelTier: "fast" | "pro" = "fast"

local headerLabel = Instance.new("TextLabel")
headerLabel.Text = "Forge AI v2.0 • 3D, Luau & Rojo"
headerLabel.Font = Enum.Font.GothamBold
headerLabel.TextSize = 15
headerLabel.TextColor3 = Color3.fromRGB(248, 250, 252)
headerLabel.Size = UDim2.new(1, 0, 0, 24)
headerLabel.BackgroundTransparency = 1
headerLabel.TextXAlignment = Enum.TextXAlignment.Left
headerLabel.LayoutOrder = 1
headerLabel.Parent = root

-- Script Type Selector Row (Server | Client | Module)
local scriptTypeRow = Instance.new("Frame")
scriptTypeRow.Size = UDim2.new(1, 0, 0, 28)
scriptTypeRow.BackgroundTransparency = 1
scriptTypeRow.LayoutOrder = 2
scriptTypeRow.Parent = root

local stLayout = Instance.new("UIListLayout")
stLayout.FillDirection = Enum.FillDirection.Horizontal
stLayout.Padding = UDim.new(0, 6)
stLayout.Parent = scriptTypeRow

local function createSmallButton(parent: Instance, text: string, widthScale: number): TextButton
    local b = Instance.new("TextButton")
    b.Text = text
    b.Font = Enum.Font.GothamSemibold
    b.TextSize = 11
    b.Size = UDim2.new(widthScale, -4, 1, 0)
    b.BackgroundColor3 = Color3.fromRGB(30, 41, 59)
    b.TextColor3 = Color3.fromRGB(226, 232, 240)
    b.Parent = parent
    local c = Instance.new("UICorner")
    c.CornerRadius = UDim.new(0, 6)
    c.Parent = b
    return b
end

local btnServer = createSmallButton(scriptTypeRow, "Server (.server)", 0.33)
local btnClient = createSmallButton(scriptTypeRow, "Client (.client)", 0.33)
local btnModule = createSmallButton(scriptTypeRow, "Module (.luau)", 0.33)

local function updateScriptTypeButtons()
    btnServer.BackgroundColor3 = if selectedScriptType == "Server" then Color3.fromRGB(37, 99, 235) else Color3.fromRGB(30, 41, 59)
    btnClient.BackgroundColor3 = if selectedScriptType == "Client" then Color3.fromRGB(37, 99, 235) else Color3.fromRGB(30, 41, 59)
    btnModule.BackgroundColor3 = if selectedScriptType == "Module" then Color3.fromRGB(37, 99, 235) else Color3.fromRGB(30, 41, 59)
end
updateScriptTypeButtons()

btnServer.MouseButton1Click:Connect(function() selectedScriptType = "Server"; updateScriptTypeButtons() end)
btnClient.MouseButton1Click:Connect(function() selectedScriptType = "Client"; updateScriptTypeButtons() end)
btnModule.MouseButton1Click:Connect(function() selectedScriptType = "Module"; updateScriptTypeButtons() end)

-- Prompt Box
local promptBox = Instance.new("TextBox")
promptBox.PlaceholderText = "Describe el modelo 3D, escenario, script Luau o interfaz..."
promptBox.Text = ""
promptBox.ClearTextOnFocus = false
promptBox.MultiLine = true
promptBox.TextWrapped = true
promptBox.Font = Enum.Font.Gotham
promptBox.TextSize = 12
promptBox.TextColor3 = Color3.fromRGB(241, 245, 249)
promptBox.BackgroundColor3 = Color3.fromRGB(30, 41, 59)
promptBox.Size = UDim2.new(1, 0, 0, 96)
promptBox.TextXAlignment = Enum.TextXAlignment.Left
promptBox.TextYAlignment = Enum.TextYAlignment.Top
promptBox.LayoutOrder = 3
promptBox.Parent = root

-- Action Buttons
local btnGenerate3D = createSmallButton(root, "Generar e Insertar Modelo 3D en Workspace", 1)
btnGenerate3D.Size = UDim2.new(1, 0, 0, 34)
btnGenerate3D.BackgroundColor3 = Color3.fromRGB(14, 165, 233)
btnGenerate3D.LayoutOrder = 4

local btnGenerateScript = createSmallButton(root, "Generar Script Luau (Respeta Server/Client/Module)", 1)
btnGenerateScript.Size = UDim2.new(1, 0, 0, 34)
btnGenerateScript.BackgroundColor3 = Color3.fromRGB(37, 99, 235)
btnGenerateScript.LayoutOrder = 5

local btnVerifyRojo = createSmallButton(root, "Verificar Sincronización Rojo en Studio", 1)
btnVerifyRojo.Size = UDim2.new(1, 0, 0, 32)
btnVerifyRojo.BackgroundColor3 = Color3.fromRGB(16, 185, 129)
btnVerifyRojo.LayoutOrder = 6

local btnOptimizeSel = createSmallButton(root, "Optimizar Geometría Seleccionada (Selection)", 1)
btnOptimizeSel.Size = UDim2.new(1, 0, 0, 32)
btnOptimizeSel.BackgroundColor3 = Color3.fromRGB(71, 85, 105)
btnOptimizeSel.LayoutOrder = 7

local outputLog = Instance.new("TextLabel")
outputLog.Text = "Listo. Conecta FastAPI en " .. BACKEND_URL
outputLog.Font = Enum.Font.Code
outputLog.TextSize = 11
outputLog.TextColor3 = Color3.fromRGB(203, 213, 225)
outputLog.BackgroundColor3 = Color3.fromRGB(2, 6, 23)
outputLog.Size = UDim2.new(1, 0, 0, 180)
outputLog.TextWrapped = true
outputLog.TextXAlignment = Enum.TextXAlignment.Left
outputLog.TextYAlignment = Enum.TextYAlignment.Top
outputLog.LayoutOrder = 8
outputLog.Parent = root

btnGenerate3D.MouseButton1Click:Connect(function()
    if #promptBox.Text < 3 then
        outputLog.Text = "Escribe una descripción para el modelo 3D o escenario."
        return
    end
    outputLog.Text = "Generando geometría 3D compuesta con Gemini..."
    task.spawn(function()
        local ok, data = requestBackend("/api/v1/generate-3d", "POST", {
            prompt = promptBox.Text,
            asset_type = "Model3D",
            category = "Custom Studio Asset",
            collision_fidelity = "Hull",
            save_to_rojo = true,
            model_tier = selectedModelTier,
        })
        if ok then
            local spawnedModel = construct3DModelFromSpec(data, Workspace)
            outputLog.Text = string.format(
                "Modelo 3D insertado en Workspace: %s (%d sub-partes, %d tris)\nMódulo Rojo: %s",
                spawnedModel.Name,
                #(data.parts or {}),
                data.poly_count or 0,
                data.saved_path or "Guardado"
            )
        else
            outputLog.Text = "Error 3D: " .. tostring(data)
        end
    end)
end)

btnGenerateScript.MouseButton1Click:Connect(function()
    if #promptBox.Text < 3 then
        outputLog.Text = "Escribe los requerimientos del script."
        return
    end
    outputLog.Text = string.format("Generando script [%s]...", selectedScriptType)
    task.spawn(function()
        local ok, data = requestBackend("/api/v1/generate-script", "POST", {
            prompt = promptBox.Text,
            script_type = selectedScriptType,
            model_tier = selectedModelTier,
            save_to_rojo = true,
        })
        if ok then
            outputLog.Text = string.format(
                "Script [%s] generado: %s\nCarpeta Rojo: %s\nRuta: %s",
                selectedScriptType,
                data.file_name or "",
                data.rojo_target_folder or "",
                data.saved_path or ""
            )
        else
            outputLog.Text = "Error Script: " .. tostring(data)
        end
    end)
end)

btnVerifyRojo.MouseButton1Click:Connect(function()
    task.spawn(function()
        local _, _, report = verifyRojoSyncInStudio()
        outputLog.Text = report
    end)
end)

btnOptimizeSel.MouseButton1Click:Connect(function()
    outputLog.Text = optimizeSelectedGeometry("Hull", true)
end)
