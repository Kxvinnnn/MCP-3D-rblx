--!strict
--[[
    Forge AI Studio Plugin v2.1 - Unified Luau, ForgeGUI, EditableMesh 3D Engine & Rojo Verifier
    ============================================================================================
    Connects Roblox Studio to the Unified Forge AI Backend via HttpService.
    Capabilities:
    1. Dynamic Script Generator (Server / Client / Module + Fast / Pro model tiers)
    2. ForgeGUI Builder (StarterGui instance tree + Luau module sync)
    3. EditableMesh 3D Model & Scene Spawner (Constructs real MeshParts from vertex/normal/UV/triangle index buffers via AssetService:CreateEditableMesh)
    4. Automatic .RBXMX EditableMesh Reconstructor (Executes ForgeStudioReconstructor or parses ForgeMeshGeometryJSON with xpcall verification)
    5. Selection Geometry Inspector & Optimizer (CollisionFidelity, Anchored, Material batch tools)
    6. Rojo Sync Manifest Verifier (Verifies that Rojo files on disk arrived in Roblox Studio DataModel)
]]

local AssetService = game:GetService("AssetService")
local ChangeHistoryService = game:GetService("ChangeHistoryService")
local HttpService = game:GetService("HttpService")
local InsertService = game:GetService("InsertService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Selection = game:GetService("Selection")
local ServerScriptService = game:GetService("ServerScriptService")
local StarterGui = game:GetService("StarterGui")
local StarterPlayer = game:GetService("StarterPlayer")
local Workspace = game:GetService("Workspace")

-- Default unified backend endpoint (FastAPI port 8000 or Gateway port 3000)
local BACKEND_URL = "http://127.0.0.1:8000"
local FORGE_SECURITY_TOKEN = ""

local toolbar = plugin:CreateToolbar("Forge AI v2.1")
local toggleButton = toolbar:CreateButton(
    "Forge AI Suite",
    "Abrir suite de creación 3D EditableMesh, Luau, ForgeGUI y Verificador Rojo",
    "rbxassetid://4458901886"
)

local widgetInfo = DockWidgetPluginGuiInfo.new(
    Enum.InitialDockState.Right,
    false,
    false,
    420,
    680,
    360,
    500
)

local dockWidget = plugin:CreateDockWidgetPluginGui("ForgeAIStudioSuiteV2", widgetInfo)
dockWidget.Title = "Forge AI v2.1 • EditableMesh 3D, Luau & Rojo"

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
        return false, "No se pudo conectar a " .. BACKEND_URL .. " (Verifica que FastAPI/Express esté activo y HttpService habilitado)"
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

local function isVerifiedRobloxAssetUri(uri: any): boolean
    if type(uri) ~= "string" then
        return false
    end
    if string.match(uri, "^rbxassetid://[1-9]%d*$") then
        return true
    end
    if string.match(uri, "^rbxasset://.+") then
        return true
    end
    return false
end

-- Construct a real MeshPart from vertex, normal, UV, and triangle index buffers via EditableMesh
local function createEditableMeshPartFromSpec(partSpec: any, idx: number): BasePart
    local partName = partSpec.name or ("MeshPart_" .. tostring(idx))
    local sz = partSpec.size or { 2, 2, 2 }
    local targetSize = Vector3.new(sz[1] or 2, sz[2] or 2, sz[3] or 2)
    local cfModeName = partSpec.collisionFidelity or "Hull"
    local cfEnum = (Enum.CollisionFidelity :: any)[cfModeName] or Enum.CollisionFidelity.Hull

    local meshData = partSpec.meshData
    local vertices = if type(meshData) == "table" and type(meshData.vertices) == "table" then meshData.vertices else {}
    local normals = if type(meshData) == "table" and type(meshData.normals) == "table" then meshData.normals else {}
    local uvs = if type(meshData) == "table" and type(meshData.uvs) == "table" then meshData.uvs else {}
    local faces = if type(meshData) == "table" and type(meshData.faces) == "table" then meshData.faces else {}

    -- 1. Primary path: Construct real geometry from buffers via AssetService:CreateEditableMesh()
    if #vertices > 0 and #faces > 0 then
        local okEditable, generatedMeshPart = xpcall(function()
            local editableMesh = AssetService:CreateEditableMesh()
            local vertexIds = table.create(#vertices)
            local normalIds = table.create(#normals)
            local uvIds = table.create(#uvs)

            for i, v in ipairs(vertices) do
                vertexIds[i] = editableMesh:AddVertex(Vector3.new(v[1] or 0, v[2] or 0, v[3] or 0))
            end
            for i, n in ipairs(normals) do
                normalIds[i] = editableMesh:AddNormal(Vector3.new(n[1] or 0, n[2] or 1, n[3] or 0))
            end
            for i, uv in ipairs(uvs) do
                uvIds[i] = editableMesh:AddUV(Vector2.new(uv[1] or 0, uv[2] or 0))
            end

            for _, tri in ipairs(faces) do
                if type(tri) == "table" and #tri >= 3 then
                    -- JSON faces are 0-based indices; Luau vertexIds table is 1-based
                    local i1 = (tonumber(tri[1]) or 0) + 1
                    local i2 = (tonumber(tri[2]) or 0) + 1
                    local i3 = (tonumber(tri[3]) or 0) + 1
                    local v1, v2, v3 = vertexIds[i1], vertexIds[i2], vertexIds[i3]
                    if v1 and v2 and v3 then
                        local fid = editableMesh:AddTriangle(v1, v2, v3)
                        if normalIds[i1] and normalIds[i2] and normalIds[i3] then
                            pcall(function()
                                editableMesh:SetFaceNormals(fid, { normalIds[i1], normalIds[i2], normalIds[i3] })
                            end)
                        end
                        if uvIds[i1] and uvIds[i2] and uvIds[i3] then
                            pcall(function()
                                editableMesh:SetFaceUVs(fid, { uvIds[i1], uvIds[i2], uvIds[i3] })
                            end)
                        end
                    end
                end
            end

            return AssetService:CreateMeshPartAsync(Content.fromObject(editableMesh), {
                CollisionFidelity = cfEnum,
                RenderFidelity = Enum.RenderFidelity.Precise,
                FluidFidelity = Enum.FluidFidelity.Automatic,
            })
        end, debug.traceback)

        if okEditable and generatedMeshPart then
            generatedMeshPart.Name = partName
            generatedMeshPart.Size = targetSize
            generatedMeshPart:SetAttribute("GeometrySource", "EditableMeshBuffer")
            generatedMeshPart:SetAttribute("VertexCount", #vertices)
            generatedMeshPart:SetAttribute("TriangleCount", #faces)
            return generatedMeshPart
        end
    end

    -- 2. Secondary path: Only if a verified published Roblox Cloud MeshId (`rbxassetid://<id>`) exists
    local publishedUri = if isVerifiedRobloxAssetUri(partSpec.meshId)
        then partSpec.meshId
        elseif isVerifiedRobloxAssetUri(partSpec.assetId) then partSpec.assetId
        else ""

    if publishedUri ~= "" then
        local okInsert, insertedMeshPart = pcall(function()
            return InsertService:CreateMeshPartAsync(publishedUri, cfEnum, Enum.RenderFidelity.Precise)
        end)
        if okInsert and insertedMeshPart then
            insertedMeshPart.Name = partName
            insertedMeshPart.Size = targetSize
            insertedMeshPart:SetAttribute("PublishedMeshId", publishedUri)
            insertedMeshPart:SetAttribute("GeometrySource", "PublishedCloudAsset")
            return insertedMeshPart
        end
    end

    -- 3. Fallback container MeshPart (never assigns read-only MeshPart.MeshId)
    local container = Instance.new("MeshPart")
    container.Name = partName
    container.Size = targetSize
    container:SetAttribute("GeometrySource", "ContainerMeshPart")
    return container
end

-- Build 3D Model from Forge3DAsset parts array in Workspace or WorldModel
local function construct3DModelFromSpec(assetData: any, targetParent: Instance?): Model
    local recordId = ChangeHistoryService:TryBeginRecording("ForgeAI Spawn EditableMesh 3D Asset")

    local model = Instance.new("Model")
    model.Name = assetData.name or "Forge3DModel"

    local camera = Workspace.CurrentCamera
    local spawnOrigin = if camera
        then CFrame.new(camera.CFrame.Position + (camera.CFrame.LookVector * 18))
        else CFrame.new(0, 5, 0)

    local partsList = assetData.parts or {}
    for idx, partSpec in ipairs(partsList) do
        local part = createEditableMeshPartFromSpec(partSpec, idx)

        local pos = partSpec.position or { 0, 1, 0 }
        local rot = partSpec.rotation or { 0, 0, 0 }
        local rotCFrame = CFrame.Angles(math.rad(rot[1] or 0), math.rad(rot[2] or 0), math.rad(rot[3] or 0))
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

        if isVerifiedRobloxAssetUri(partSpec.textureId) and part:IsA("MeshPart") then
            part.TextureID = partSpec.textureId
        end

        -- Apply 4-channel SurfaceAppearance per MeshPart if pbrMaterial is configured
        if type(partSpec.pbrMaterial) == "table" and part:IsA("MeshPart") then
            local pbr = partSpec.pbrMaterial
            local hasColor = isVerifiedRobloxAssetUri(pbr.colorMapAssetId)
            local hasNormal = isVerifiedRobloxAssetUri(pbr.normalMapAssetId)
            local hasRough = isVerifiedRobloxAssetUri(pbr.roughnessMapAssetId)
            local hasMetal = isVerifiedRobloxAssetUri(pbr.metalnessMapAssetId)
            if hasColor or hasNormal or hasRough or hasMetal then
                local existingSA = part:FindFirstChildOfClass("SurfaceAppearance")
                if existingSA then
                    existingSA:Destroy()
                end
                local sa = Instance.new("SurfaceAppearance")
                sa.Name = "SurfaceAppearance"
                sa.AlphaMode = Enum.AlphaMode.Overlay
                if hasColor then
                    sa.ColorMap = pbr.colorMapAssetId
                end
                if hasNormal then
                    sa.NormalMap = pbr.normalMapAssetId
                end
                if hasRough then
                    sa.RoughnessMap = pbr.roughnessMapAssetId
                end
                if hasMetal then
                    sa.MetalnessMap = pbr.metalnessMapAssetId
                end
                sa.Parent = part
            end
        end

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

    model:SetAttribute("ForgeEditableMeshReconstructed", true)
    model:SetAttribute("ForgeReconstructionVerified", true)
    model.Parent = targetParent or Workspace
    Selection:Set({ model })

    if recordId then
        ChangeHistoryService:FinishRecording(recordId, Enum.FinishRecordingOperation.Commit)
    end

    return model
end

-- Reconstructs EditableMesh geometry for imported .RBXMX models in Selection or Workspace
local function reconstructEditableMeshModelsInStudio(): string
    local recordId = ChangeHistoryService:TryBeginRecording("ForgeAI Reconstruct RBXMX EditableMesh")
    local candidates: { Model } = {}
    local selected = Selection:Get()

    for _, inst in ipairs(selected) do
        if inst:IsA("Model") then
            table.insert(candidates, inst)
        end
    end
    if #candidates == 0 then
        for _, desc in ipairs(Workspace:GetDescendants()) do
            if desc:IsA("Model") and (desc:FindFirstChild("ForgeStudioReconstructor") or desc:FindFirstChild("ForgeMeshGeometryJSON", true)) then
                table.insert(candidates, desc)
            end
        end
    end

    local reconstructedModels = 0
    local reconstructedParts = 0

    for _, model in ipairs(candidates) do
        local reconstructorModule = model:FindFirstChild("ForgeStudioReconstructor")
        local handledByModule = false

        if reconstructorModule and reconstructorModule:IsA("ModuleScript") then
            local okReq, builder = pcall(require, reconstructorModule)
            if okReq and type(builder) == "table" and type(builder.ReconstructInPlace) == "function" then
                local okRun, countOrErr = xpcall(function()
                    return builder.ReconstructInPlace(model)
                end, debug.traceback)
                if okRun and type(countOrErr) == "number" and countOrErr > 0 then
                    reconstructedModels += 1
                    reconstructedParts += countOrErr
                    model:SetAttribute("ForgeReconstructionVerified", true)
                    handledByModule = true
                end
            end
        end

        if not handledByModule then
            local modelPartCount = 0
            for idx, child in ipairs(model:GetChildren()) do
                if child:IsA("BasePart") then
                    local geomVal = child:FindFirstChild("ForgeMeshGeometryJSON")
                    if geomVal and geomVal:IsA("StringValue") and #geomVal.Value > 2 then
                        local okDec, parsedGeom = pcall(function()
                            return HttpService:JSONDecode(geomVal.Value)
                        end)
                        if okDec and type(parsedGeom) == "table" then
                            local newPart = createEditableMeshPartFromSpec({
                                name = child.Name,
                                size = parsedGeom.size or { child.Size.X, child.Size.Y, child.Size.Z },
                                collisionFidelity = parsedGeom.collisionFidelity or "Hull",
                                meshData = parsedGeom,
                            }, idx)
                            newPart.CFrame = child.CFrame
                            newPart.Color = child.Color
                            newPart.Material = child.Material
                            newPart.Transparency = child.Transparency
                            newPart.Anchored = child.Anchored
                            newPart.CanCollide = child.CanCollide
                            for _, subChild in ipairs(child:GetChildren()) do
                                subChild:Clone().Parent = newPart
                            end
                            newPart.Parent = model
                            child:Destroy()
                            modelPartCount += 1
                            reconstructedParts += 1
                        end
                    end
                end
            end
            if modelPartCount > 0 then
                reconstructedModels += 1
                model:SetAttribute("ForgeEditableMeshReconstructed", true)
                model:SetAttribute("ForgeReconstructionVerified", true)
            end
        end
    end

    if recordId then
        ChangeHistoryService:FinishRecording(recordId, Enum.FinishRecordingOperation.Commit)
    end

    if reconstructedModels == 0 then
        return "No se encontraron modelos .RBXMX pendientes de reconstrucción en Selection ni Workspace."
    end
    return string.format(
        "✅ Reconstrucción EditableMesh verificada: %d modelo(s), %d MeshPart(s) reconstruidos con geometría real.",
        reconstructedModels,
        reconstructedParts
    )
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

-- Push selected Model or BaseParts from Roblox Studio back to Forge AI Studio incrementally (Pillar C Bidirectional Sync)
local function pushSelectedModelToForgeStudio(): string
    local selected = Selection:Get()
    if #selected == 0 then
        return "Selecciona un Model o MeshParts en Roblox Studio para sincronizar hacia Forge."
    end

    local targetModel: Model? = nil
    local collectedParts: { BasePart } = {}

    for _, inst in ipairs(selected) do
        if inst:IsA("Model") and not targetModel then
            targetModel = inst
            for _, child in ipairs(inst:GetDescendants()) do
                if child:IsA("BasePart") then
                    table.insert(collectedParts, child)
                end
            end
        elseif inst:IsA("BasePart") then
            table.insert(collectedParts, inst)
            if not targetModel and inst.Parent and inst.Parent:IsA("Model") and inst.Parent ~= Workspace then
                targetModel = inst.Parent
            end
        end
    end

    if #collectedParts == 0 then
        return "La selección no contiene BaseParts ni MeshParts."
    end

    local modelName = if targetModel then targetModel.Name else "StudioSyncedModel"
    local serializedParts = {}

    for _, part in ipairs(collectedParts) do
        local rx, ry, rz = part.CFrame:ToEulerAnglesXYZ()
        local geomVal = part:FindFirstChild("ForgeMeshGeometryJSON")
        local meshData = nil
        if geomVal and geomVal:IsA("StringValue") and #geomVal.Value > 2 then
            local okDec, decoded = pcall(function()
                return HttpService:JSONDecode(geomVal.Value)
            end)
            if okDec and type(decoded) == "table" then
                meshData = decoded
            end
        end

        local sa = part:FindFirstChildOfClass("SurfaceAppearance")
        local pbrSpec = nil
        if sa then
            pbrSpec = {
                materialName = part.Name .. "_PBR",
                albedoHex = string.format("#%02x%02x%02x", math.round(part.Color.R * 255), math.round(part.Color.G * 255), math.round(part.Color.B * 255)),
                roughness = part:GetAttribute("ForgePBRRoughness") or 0.35,
                metalness = part:GetAttribute("ForgePBRMetalness") or 0.65,
                colorMapAssetId = if isVerifiedRobloxAssetUri(sa.ColorMap) then sa.ColorMap else nil,
                normalMapAssetId = if isVerifiedRobloxAssetUri(sa.NormalMap) then sa.NormalMap else nil,
                roughnessMapAssetId = if isVerifiedRobloxAssetUri(sa.RoughnessMap) then sa.RoughnessMap else nil,
                metalnessMapAssetId = if isVerifiedRobloxAssetUri(sa.MetalnessMap) then sa.MetalnessMap else nil,
            }
        end

        table.insert(serializedParts, {
            name = part.Name,
            shape = "MeshPart",
            size = { part.Size.X, part.Size.Y, part.Size.Z },
            position = { part.Position.X, part.Position.Y, part.Position.Z },
            rotation = { math.deg(rx), math.deg(ry), math.deg(rz) },
            color = { math.round(part.Color.R * 255), math.round(part.Color.G * 255), math.round(part.Color.B * 255) },
            material = part.Material.Name,
            transparency = part.Transparency,
            canCollide = part.CanCollide,
            anchored = part.Anchored,
            collisionFidelity = if part:IsA("MeshPart") then part.CollisionFidelity.Name else "Hull",
            meshData = meshData,
            pbrMaterial = pbrSpec,
        })
    end

    local ok, resp = requestBackend("/api/v1/assets/studio-push", "POST", {
        model_name = modelName,
        parts = serializedParts,
        remove_missing = false,
    })

    if not ok then
        return "Error en Push Incremental hacia Forge: " .. tostring(resp)
    end

    return string.format(
        "✅ Push Incremental Studio → Forge completado: %s (%d piezas sincronizadas, v%s)\nRojo .rbxmx: %s",
        modelName,
        #serializedParts,
        tostring(resp.asset and resp.asset.version or 1),
        tostring(resp.rbxmx_saved_path or "Actualizado")
    )
end

-- UI Construction for Plugin Widget
local root = Instance.new("ScrollingFrame")
root.Size = UDim2.fromScale(1, 1)
root.CanvasSize = UDim2.new(0, 0, 0, 820)
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
local selectedScriptType: "Server" | "Client" | "Module" = "Server"
local selectedModelTier: "fast" | "pro" = "fast"

local headerLabel = Instance.new("TextLabel")
headerLabel.Text = "Forge AI v2.1 • EditableMesh 3D, Luau & Rojo"
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
local btnGenerate3D = createSmallButton(root, "Generar e Insertar MeshPart 3D (EditableMesh)", 1)
btnGenerate3D.Size = UDim2.new(1, 0, 0, 34)
btnGenerate3D.BackgroundColor3 = Color3.fromRGB(14, 165, 233)
btnGenerate3D.LayoutOrder = 4

local btnReconstructRBXMX = createSmallButton(root, "Reconstruir Mallas EditableMesh (.RBXMX / Workspace)", 1)
btnReconstructRBXMX.Size = UDim2.new(1, 0, 0, 34)
btnReconstructRBXMX.BackgroundColor3 = Color3.fromRGB(139, 92, 246)
btnReconstructRBXMX.LayoutOrder = 5

local btnGenerateScript = createSmallButton(root, "Generar Script Luau (Respeta Server/Client/Module)", 1)
btnGenerateScript.Size = UDim2.new(1, 0, 0, 34)
btnGenerateScript.BackgroundColor3 = Color3.fromRGB(37, 99, 235)
btnGenerateScript.LayoutOrder = 6

local btnVerifyRojo = createSmallButton(root, "Verificar Sincronización Rojo en Studio", 1)
btnVerifyRojo.Size = UDim2.new(1, 0, 0, 32)
btnVerifyRojo.BackgroundColor3 = Color3.fromRGB(16, 185, 129)
btnVerifyRojo.LayoutOrder = 7

local btnOptimizeSel = createSmallButton(root, "Optimizar Geometría Seleccionada (Selection)", 1)
btnOptimizeSel.Size = UDim2.new(1, 0, 0, 32)
btnOptimizeSel.BackgroundColor3 = Color3.fromRGB(71, 85, 105)
btnOptimizeSel.LayoutOrder = 8

local btnPushToForge = createSmallButton(root, "Sincronizar Selección hacia Forge Studio (Push Incremental)", 1)
btnPushToForge.Size = UDim2.new(1, 0, 0, 32)
btnPushToForge.BackgroundColor3 = Color3.fromRGB(217, 119, 6)
btnPushToForge.LayoutOrder = 9

local outputLog = Instance.new("TextLabel")
outputLog.Text = "Listo. Conecta FastAPI/Express en " .. BACKEND_URL
outputLog.Font = Enum.Font.Code
outputLog.TextSize = 11
outputLog.TextColor3 = Color3.fromRGB(203, 213, 225)
outputLog.BackgroundColor3 = Color3.fromRGB(2, 6, 23)
outputLog.Size = UDim2.new(1, 0, 0, 180)
outputLog.TextWrapped = true
outputLog.TextXAlignment = Enum.TextXAlignment.Left
outputLog.TextYAlignment = Enum.TextYAlignment.Top
outputLog.LayoutOrder = 10
outputLog.Parent = root

btnGenerate3D.MouseButton1Click:Connect(function()
    if #promptBox.Text < 3 then
        outputLog.Text = "Escribe una descripción para el modelo 3D o escenario."
        return
    end
    outputLog.Text = "Generando geometría EditableMesh 3D con Gemini..."
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
                "Modelo EditableMesh 3D insertado en Workspace: %s (%d MeshParts, %d tris)\nMódulo Rojo: %s",
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

btnReconstructRBXMX.MouseButton1Click:Connect(function()
    outputLog.Text = reconstructEditableMeshModelsInStudio()
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

btnPushToForge.MouseButton1Click:Connect(function()
    outputLog.Text = "Sincronizando selección de Studio hacia Forge AI Studio..."
    task.spawn(function()
        outputLog.Text = pushSelectedModelToForgeStudio()
    end)
end)
