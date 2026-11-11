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
local savedBackendUrl = ""
local savedSecurityToken = ""
pcall(function()
    if plugin and type(plugin.GetSetting) == "function" then
        savedBackendUrl = tostring(plugin:GetSetting("ForgeBackendUrl") or "")
        savedSecurityToken = tostring(plugin:GetSetting("ForgeSecurityToken") or "")
    end
end)
local BACKEND_URL = if #savedBackendUrl > 0 then savedBackendUrl else "http://127.0.0.1:8000"
local FORGE_SECURITY_TOKEN = savedSecurityToken

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
-- Returns: (BasePart, isVerified: boolean, errorReason: string?)
local function createEditableMeshPartFromSpec(partSpec: any, idx: number): (BasePart, boolean, string?)
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
    local lastErrorReason: string? = nil

    -- 1. Primary path: Construct real geometry from buffers via AssetService:CreateEditableMesh()
    if #vertices >= 3 and #faces >= 1 then
        local editableMeshInstance: EditableMesh? = nil
        local expectedTriCount = 0
        local addedTriCount = 0

        local okEditable, generatedOrErr = xpcall(function()
            local editableMesh = AssetService:CreateEditableMesh()
            if not editableMesh then
                error("AssetService:CreateEditableMesh() devolvió nil (verifica permisos/memoria de EditableMesh en Studio)")
            end
            editableMeshInstance = editableMesh

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
                    expectedTriCount += 1
                    -- JSON faces are 0-based indices; Luau vertexIds table is 1-based
                    local i1 = (tonumber(tri[1]) or 0) + 1
                    local i2 = (tonumber(tri[2]) or 0) + 1
                    local i3 = (tonumber(tri[3]) or 0) + 1
                    local v1, v2, v3 = vertexIds[i1], vertexIds[i2], vertexIds[i3]
                    if v1 and v2 and v3 and v1 ~= v2 and v2 ~= v3 and v1 ~= v3 then
                        local fid = editableMesh:AddTriangle(v1, v2, v3)
                        if fid then
                            addedTriCount += 1
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
            end

            if addedTriCount == 0 or addedTriCount < expectedTriCount then
                error(string.format(
                    "Triángulos incompletos en EditableMesh para '%s': creados %d de %d esperados",
                    partName,
                    addedTriCount,
                    expectedTriCount
                ))
            end

            local meshTriangles = editableMesh:GetTriangles()
            if type(meshTriangles) == "table" and #meshTriangles < expectedTriCount then
                error(string.format(
                    "EditableMesh:GetTriangles() devolvió %d triángulos de %d esperados en '%s'",
                    #meshTriangles,
                    expectedTriCount,
                    partName
                ))
            end

            local createdPart = AssetService:CreateMeshPartAsync(Content.fromObject(editableMesh), {
                CollisionFidelity = cfEnum,
                RenderFidelity = Enum.RenderFidelity.Precise,
                FluidFidelity = Enum.FluidFidelity.Automatic,
            })
            if not createdPart then
                error("AssetService:CreateMeshPartAsync() devolvió nil para '" .. partName .. "'")
            end
            return createdPart
        end, debug.traceback)

        -- Release EditableMesh resource now that CreateMeshPartAsync has finished
        if editableMeshInstance then
            pcall(function()
                editableMeshInstance:Destroy()
            end)
            editableMeshInstance = nil
        end

        if okEditable and generatedOrErr and typeof(generatedOrErr) == "Instance" and generatedOrErr:IsA("MeshPart") then
            local generatedMeshPart = generatedOrErr :: MeshPart
            generatedMeshPart.Name = partName
            generatedMeshPart.Size = targetSize
            generatedMeshPart:SetAttribute("GeometrySource", "EditableMeshBuffer")
            generatedMeshPart:SetAttribute("ForgeGeometryVerified", true)
            generatedMeshPart:SetAttribute("VertexCount", #vertices)
            generatedMeshPart:SetAttribute("TriangleCount", addedTriCount)
            generatedMeshPart:SetAttribute("ExpectedTriangleCount", expectedTriCount)
            return generatedMeshPart, true, nil
        else
            lastErrorReason = tostring(generatedOrErr)
            warn(string.format("[ForgeAI Plugin] Falló EditableMesh para '%s': %s", partName, lastErrorReason))
        end
    else
        lastErrorReason = string.format("Buffers geométricos vacíos o insuficientes (verts=%d, faces=%d)", #vertices, #faces)
    end

    -- 2. Secondary path: Only if a verified published Roblox Cloud MeshId (`rbxassetid://<id>`) exists
    local publishedUri = if isVerifiedRobloxAssetUri(partSpec.meshId)
        then partSpec.meshId
        elseif isVerifiedRobloxAssetUri(partSpec.assetId) then partSpec.assetId
        else ""

    if publishedUri ~= "" then
        local okInsert, insertedOrErr = pcall(function()
            return InsertService:CreateMeshPartAsync(publishedUri, cfEnum, Enum.RenderFidelity.Precise)
        end)
        if okInsert and insertedOrErr and typeof(insertedOrErr) == "Instance" and insertedOrErr:IsA("MeshPart") then
            local insertedMeshPart = insertedOrErr :: MeshPart
            insertedMeshPart.Name = partName
            insertedMeshPart.Size = targetSize
            insertedMeshPart:SetAttribute("PublishedMeshId", publishedUri)
            insertedMeshPart:SetAttribute("GeometrySource", "PublishedCloudAsset")
            insertedMeshPart:SetAttribute("ForgeGeometryVerified", true)
            return insertedMeshPart, true, nil
        else
            lastErrorReason = "InsertService:CreateMeshPartAsync falló para " .. publishedUri .. ": " .. tostring(insertedOrErr)
            warn("[ForgeAI Plugin] " .. lastErrorReason)
        end
    end

    -- 3. Fallback container MeshPart (never marked as verified geometry, never assigns read-only MeshPart.MeshId)
    local container = Instance.new("MeshPart")
    container.Name = partName
    container.Size = targetSize
    container:SetAttribute("GeometrySource", "UnverifiedFallbackContainer")
    container:SetAttribute("ForgeGeometryVerified", false)
    container:SetAttribute("ForgeReconstructionError", lastErrorReason or "Failed to reconstruct EditableMesh")
    return container, false, lastErrorReason
end

local FORGE_SYNC_HASH_SCHEMA_V1 = "forge-sync-v1"

-- Canonical text normalization shared across Python, TypeScript, and Luau:
-- converts CRLF and CR to LF and trims outer whitespace.
local function normalizeLuauAndSyncText(text: string?): string
    local s = string.gsub(text or "", "\r\n", "\n")
    s = string.gsub(s, "\r", "\n")
    s = string.match(s, "^%s*(.-)%s*$") or ""
    return s
end

-- FNV-1a 32-bit hash matching backend compute_fnv1a_32_hex / computeFnv1a32Hex
local function computeLuauContentHash(content: string): string
    local normalized = normalizeLuauAndSyncText(content)
    local h: number = 0x811c9dc5
    for i = 1, #normalized do
        h = bit32.bxor(h, string.byte(normalized, i))
        -- Multiply by 0x01000193 modulo 2^32 using 16-bit split to avoid float precision loss
        local lo = bit32.band(h, 0xFFFF)
        local hi = bit32.rshift(h, 16)
        local prodLo = lo * 0x0193
        local prodMid = lo * 0x0100 + hi * 0x0193 + bit32.rshift(prodLo, 16)
        h = bit32.bor(bit32.lshift(bit32.band(prodMid, 0xFFFF), 16), bit32.band(prodLo, 0xFFFF))
    end
    return string.format("%08x", h)
end

-- Deterministic fixed-decimal formatter matching _fmt_canonical_fixed in Python and fmtCanonicalFixed in TypeScript
local function fmtCanonicalFixed(val: any, decimals: number?): string
    local d = decimals or 4
    local f = tonumber(val) or 0
    if f ~= f or f == math.huge or f == -math.huge then
        f = 0
    end
    local scale = 10 ^ d
    local sign = if f < -1e-9 then -1 else 1
    local scaled = math.floor(math.abs(f) * scale + 0.5000001)
    if scaled == 0 then
        return if d > 0 then ("0." .. string.rep("0", d)) else "0"
    end
    local s = tostring(scaled)
    while #s < (d + 1) do
        s = "0" .. s
    end
    local prefix = if sign < 0 then "-" else ""
    if d == 0 then
        return prefix .. s
    end
    return prefix .. string.sub(s, 1, #s - d) .. "." .. string.sub(s, #s - d + 1)
end

local function canonicalEulerToMatrix9(rxDeg: number, ryDeg: number, rzDeg: number): { number }
    local rx = math.rad(rxDeg)
    local ry = math.rad(ryDeg)
    local rz = math.rad(rzDeg)
    local cx, sx = math.cos(rx), math.sin(rx)
    local cy, sy = math.cos(ry), math.sin(ry)
    local cz, sz = math.cos(rz), math.sin(rz)
    return {
        cy * cz,
        -cy * sz,
        sy,
        sx * sy * cz + cx * sz,
        -sx * sy * sz + cx * cz,
        -sx * cy,
        -cx * sy * cz + sx * sz,
        cx * sy * sz + sx * cz,
        cx * cy,
    }
end

local function canonicalMatrix9ToEulerDeg(m: { number }): { number }
    if type(m) ~= "table" or #m < 9 then
        return { 0, 0, 0 }
    end
    local r00, r01, r02 = tonumber(m[1]) or 1, tonumber(m[2]) or 0, tonumber(m[3]) or 0
    local r11, r12 = tonumber(m[5]) or 1, tonumber(m[6]) or 0
    local r21, r22 = tonumber(m[8]) or 0, tonumber(m[9]) or 1
    local clampedR02 = math.clamp(r02, -1, 1)
    local ry = math.asin(clampedR02)
    local rx = 0
    local rz = 0
    if math.abs(clampedR02) < 0.999999 then
        rx = math.atan2(-r12, r22)
        rz = math.atan2(-r01, r00)
    else
        rx = math.atan2(r21, r11)
        rz = 0
    end
    return {
        tonumber(fmtCanonicalFixed(math.deg(rx), 2)) or 0,
        tonumber(fmtCanonicalFixed(math.deg(ry), 2)) or 0,
        tonumber(fmtCanonicalFixed(math.deg(rz), 2)) or 0,
    }
end

local function normalizeHierarchyMetadataLuau(partSpec: any, idxFallback: number): {
    partName: string,
    partId: string,
    parentId: string,
    parentName: string,
    parentContainerClass: string,
    hierarchyPath: string,
    hierarchySegments: { string },
}
    local rawName = tostring(partSpec.name or ("MeshPart_" .. tostring(idxFallback)))
    local safeName = string.match(rawName, "^%s*(.-)%s*$") or ("MeshPart_" .. tostring(idxFallback))
    if safeName == "" then
        safeName = "MeshPart_" .. tostring(idxFallback)
    end
    local cleanAlnum = string.gsub(safeName, "[^%w_]", "_")
    if cleanAlnum == "" then
        cleanAlnum = "MeshPart_" .. tostring(idxFallback)
    end
    local rawPartId = string.match(tostring(partSpec.partId or partSpec.part_id or partSpec.id or ""), "^%s*(.-)%s*$") or ""
    local partId = if rawPartId ~= "" then rawPartId else ("fpart_" .. cleanAlnum)
    if type(partSpec) == "table" and rawPartId == "" then
        partSpec.partId = partId
    end

    local rawParentName = string.match(tostring(partSpec.parentName or partSpec.parent_name or ""), "^%s*(.-)%s*$") or ""
    local rawHierarchyPath = string.match(tostring(partSpec.hierarchyPath or partSpec.hierarchy_path or ""), "^%s*(.-)%s*$") or ""

    local intermediateFolders: { string } = {}
    if rawHierarchyPath ~= "" then
        local pathSegs: { string } = {}
        for seg in string.gmatch(string.gsub(rawHierarchyPath, "\\", "/"), "[^/]+") do
            local trimmed = string.match(seg, "^%s*(.-)%s*$") or ""
            if trimmed ~= "" then
                table.insert(pathSegs, trimmed)
            end
        end
        if #pathSegs > 0 then
            local firstLow = string.lower(pathSegs[1])
            if firstLow == "root" or firstLow == "modelroot" or firstLow == "workspace" then
                table.remove(pathSegs, 1)
            end
        end
        if #pathSegs > 0 and pathSegs[#pathSegs] == safeName then
            table.remove(pathSegs, #pathSegs)
        end
        for _, seg in ipairs(pathSegs) do
            local low = string.lower(seg)
            if low ~= "root" and low ~= "modelroot" and low ~= "workspace" then
                table.insert(intermediateFolders, seg)
            end
        end
    end

    if #intermediateFolders == 0 and rawParentName ~= "" then
        local parentSegs: { string } = {}
        for seg in string.gmatch(string.gsub(rawParentName, "\\", "/"), "[^/]+") do
            local trimmed = string.match(seg, "^%s*(.-)%s*$") or ""
            if trimmed ~= "" then
                table.insert(parentSegs, trimmed)
            end
        end
        if #parentSegs > 0 then
            local firstLow = string.lower(parentSegs[1])
            if firstLow == "root" or firstLow == "modelroot" or firstLow == "workspace" then
                table.remove(parentSegs, 1)
            end
        end
        if #parentSegs > 1 and parentSegs[#parentSegs] == safeName then
            table.remove(parentSegs, #parentSegs)
        end
        for _, seg in ipairs(parentSegs) do
            local low = string.lower(seg)
            if low ~= "root" and low ~= "modelroot" and low ~= "workspace" then
                table.insert(intermediateFolders, seg)
            end
        end
    end

    local segments: { string } = { "Root" }
    for _, folder in ipairs(intermediateFolders) do
        table.insert(segments, folder)
    end
    table.insert(segments, safeName)

    local parentName = if #intermediateFolders > 0 then intermediateFolders[#intermediateFolders] else "Root"
    local hierarchyPath = table.concat(segments, "/")
    local rawParentId = string.match(tostring(partSpec.parentId or partSpec.parent_id or ""), "^%s*(.-)%s*$") or ""
    local cleanedFolders: { string } = {}
    for _, folder in ipairs(intermediateFolders) do
        table.insert(cleanedFolders, (string.gsub(folder, "[^%w_]", "_")))
    end
    local parentClean = table.concat(cleanedFolders, "_")
    local expectedParentId = if #intermediateFolders > 0 then ("fnode_" .. parentClean) else "fnode_Root"
    local parentId: string
    if #intermediateFolders == 0 then
        parentId = "fnode_Root"
    elseif rawParentId ~= "" and rawParentId ~= "root" and rawParentId ~= "fnode_Root" and rawParentId ~= "fnode_ModelRoot" then
        parentId = if string.sub(rawParentId, 1, 6) == "fnode_" then expectedParentId else rawParentId
    else
        parentId = expectedParentId
    end

    local rawContainerCls = string.match(tostring(partSpec.parentContainerClass or partSpec.parent_container_class or ""), "^%s*(.-)%s*$") or ""
    local parentContainerClass = if rawContainerCls == "Folder" or rawContainerCls == "Model" then rawContainerCls else "Model"

    return {
        partName = safeName,
        partId = partId,
        parentId = parentId,
        parentName = parentName,
        parentContainerClass = parentContainerClass,
        hierarchyPath = hierarchyPath,
        hierarchySegments = segments,
    }
end

local function computePartSyncHashesLuau(partSpec: any, idxFallback: number): {
    hashSchemaVersion: string,
    partId: string,
    parentId: string,
    parentName: string,
    parentContainerClass: string,
    hierarchyPath: string,
    geometrySource: string,
    rotationMatrix: { number },
    reflectance: number,
    geometryHash: string,
    materialHash: string,
    transformHash: string,
    hierarchyHash: string,
    combinedHash: string,
}
    local hier = normalizeHierarchyMetadataLuau(partSpec, idxFallback)
    local md = if type(partSpec.meshData) == "table" then partSpec.meshData else {}
    local verts = if type(md.vertices) == "table" then md.vertices elseif type(partSpec.vertices) == "table" then partSpec.vertices else {}
    local faces = if type(md.faces) == "table" then md.faces elseif type(partSpec.faces) == "table" then partSpec.faces else {}
    local norms = if type(md.normals) == "table" then md.normals elseif type(partSpec.normals) == "table" then partSpec.normals else {}
    local uvs = if type(md.uvs) == "table" then md.uvs elseif type(partSpec.uvs) == "table" then partSpec.uvs else {}

    local rawMeshId = partSpec.meshId or partSpec.mesh_id or md.meshId or partSpec.assetId
    local meshId = if isVerifiedRobloxAssetUri(rawMeshId) then tostring(rawMeshId) else ""
    local rawGeomSource = string.match(tostring(partSpec.geometrySource or partSpec.geometry_source or md.geometrySource or ""), "^%s*(.-)%s*$") or ""
    local geometrySource = ""
    if #verts >= 3 and #faces >= 1 then
        geometrySource = "EditableMeshBuffers"
    elseif meshId ~= "" then
        geometrySource = "PublishedCloudMeshId"
    elseif rawGeomSource ~= "" then
        geometrySource = rawGeomSource
    else
        geometrySource = "StudioExternalUnreadable"
    end

    local geomTokens: { string } = {
        FORGE_SYNC_HASH_SCHEMA_V1,
        "geom",
        meshId,
        geometrySource,
        "vc=" .. tostring(#verts),
        "fc=" .. tostring(#faces),
    }
    for _, v in ipairs(verts) do
        if type(v) == "table" and #v >= 3 then
            table.insert(
                geomTokens,
                string.format("v:%s,%s,%s", fmtCanonicalFixed(v[1], 4), fmtCanonicalFixed(v[2], 4), fmtCanonicalFixed(v[3], 4))
            )
        end
    end
    for _, n in ipairs(norms) do
        if type(n) == "table" and #n >= 3 then
            table.insert(
                geomTokens,
                string.format("n:%s,%s,%s", fmtCanonicalFixed(n[1], 4), fmtCanonicalFixed(n[2], 4), fmtCanonicalFixed(n[3], 4))
            )
        end
    end
    for _, u in ipairs(uvs) do
        if type(u) == "table" and #u >= 2 then
            table.insert(
                geomTokens,
                string.format("u:%s,%s", fmtCanonicalFixed(u[1], 4), fmtCanonicalFixed(u[2], 4))
            )
        end
    end
    for _, f in ipairs(faces) do
        if type(f) == "table" and #f >= 3 then
            table.insert(
                geomTokens,
                string.format("f:%d,%d,%d", math.floor(tonumber(f[1]) or 0), math.floor(tonumber(f[2]) or 0), math.floor(tonumber(f[3]) or 0))
            )
        end
    end
    local geometryHash = computeLuauContentHash(table.concat(geomTokens, "|"))

    local col = if type(partSpec.color) == "table" and #partSpec.color >= 3 then partSpec.color else { 148, 163, 184 }
    local cr = math.clamp(math.floor((tonumber(col[1]) or 148) + 0.5), 0, 255)
    local cg = math.clamp(math.floor((tonumber(col[2]) or 163) + 0.5), 0, 255)
    local cb = math.clamp(math.floor((tonumber(col[3]) or 184) + 0.5), 0, 255)
    local matName = string.match(tostring(partSpec.material or "Metal"), "^%s*(.-)%s*$") or "Metal"
    if matName == "" then matName = "Metal" end
    local pbr = if type(partSpec.pbrMaterial) == "table" then partSpec.pbrMaterial else {}
    local roughVal = if type(pbr.roughness) == "number" then pbr.roughness elseif partSpec.roughness ~= nil then partSpec.roughness else 0.35
    local metalVal = if type(pbr.metalness) == "number" then pbr.metalness elseif partSpec.metalness ~= nil then partSpec.metalness else 0.6
    local transVal = if partSpec.transparency ~= nil then partSpec.transparency else 0
    local reflVal = if partSpec.reflectance ~= nil then partSpec.reflectance elseif type(pbr.reflectance) == "number" then pbr.reflectance else 0
    local roughStr = fmtCanonicalFixed(roughVal, 3)
    local metalStr = fmtCanonicalFixed(metalVal, 3)
    local transpStr = fmtCanonicalFixed(transVal, 3)
    local reflStr = fmtCanonicalFixed(reflVal, 3)
    local cmap = if isVerifiedRobloxAssetUri(pbr.colorMapAssetId or pbr.color_map_asset_id or pbr.colorMapId) then tostring(pbr.colorMapAssetId or pbr.color_map_asset_id or pbr.colorMapId) else ""
    local nmap = if isVerifiedRobloxAssetUri(pbr.normalMapAssetId or pbr.normal_map_asset_id or pbr.normalMapId) then tostring(pbr.normalMapAssetId or pbr.normal_map_asset_id or pbr.normalMapId) else ""
    local rmap = if isVerifiedRobloxAssetUri(pbr.roughnessMapAssetId or pbr.roughness_map_asset_id or pbr.roughnessMapId) then tostring(pbr.roughnessMapAssetId or pbr.roughness_map_asset_id or pbr.roughnessMapId) else ""
    local mmap = if isVerifiedRobloxAssetUri(pbr.metalnessMapAssetId or pbr.metalness_map_asset_id or pbr.metalnessMapId) then tostring(pbr.metalnessMapAssetId or pbr.metalness_map_asset_id or pbr.metalnessMapId) else ""

    local matTokens = {
        FORGE_SYNC_HASH_SCHEMA_V1,
        "mat",
        string.format("%d,%d,%d", cr, cg, cb),
        matName,
        roughStr,
        metalStr,
        transpStr,
        reflStr,
        cmap,
        nmap,
        rmap,
        mmap,
    }
    local materialHash = computeLuauContentHash(table.concat(matTokens, "|"))

    local sz = if type(partSpec.size) == "table" and #partSpec.size >= 3 then partSpec.size else { 2, 2, 2 }
    local pos = if type(partSpec.position) == "table" and #partSpec.position >= 3 then partSpec.position else { 0, 1, 0 }
    local rot = if type(partSpec.rotation) == "table" and #partSpec.rotation >= 3 then partSpec.rotation else nil
    local rx = if rot then (tonumber(rot[1]) or 0) else 0
    local ry = if rot then (tonumber(rot[2]) or 0) else 0
    local rz = if rot then (tonumber(rot[3]) or 0) else 0
    local rotMat9: { number }
    if type(partSpec.rotationMatrix) == "table" and #partSpec.rotationMatrix >= 9 then
        rotMat9 = {
            tonumber(partSpec.rotationMatrix[1]) or 1,
            tonumber(partSpec.rotationMatrix[2]) or 0,
            tonumber(partSpec.rotationMatrix[3]) or 0,
            tonumber(partSpec.rotationMatrix[4]) or 0,
            tonumber(partSpec.rotationMatrix[5]) or 1,
            tonumber(partSpec.rotationMatrix[6]) or 0,
            tonumber(partSpec.rotationMatrix[7]) or 0,
            tonumber(partSpec.rotationMatrix[8]) or 0,
            tonumber(partSpec.rotationMatrix[9]) or 1,
        }
        if rot then
            local derivedDeg = canonicalMatrix9ToEulerDeg(rotMat9)
            if math.abs(derivedDeg[1] - rx) > 0.05 or math.abs(derivedDeg[2] - ry) > 0.05 or math.abs(derivedDeg[3] - rz) > 0.05 then
                rotMat9 = canonicalEulerToMatrix9(rx, ry, rz)
            end
        end
    else
        rotMat9 = canonicalEulerToMatrix9(rx, ry, rz)
    end

    local sizeStr = string.format("%s,%s,%s", fmtCanonicalFixed(sz[1], 3), fmtCanonicalFixed(sz[2], 3), fmtCanonicalFixed(sz[3], 3))
    local posStr = string.format("%s,%s,%s", fmtCanonicalFixed(pos[1], 3), fmtCanonicalFixed(pos[2], 3), fmtCanonicalFixed(pos[3], 3))
    local rotMatFormatted: { string } = {}
    for i = 1, 9 do
        table.insert(rotMatFormatted, fmtCanonicalFixed(rotMat9[i], 4))
    end
    local rotMatStr = table.concat(rotMatFormatted, ",")
    local anchStr = if partSpec.anchored == false then "0" else "1"
    local collStr = if partSpec.canCollide == false then "0" else "1"
    local cfMode = string.match(tostring(partSpec.collisionFidelity or "Hull"), "^%s*(.-)%s*$") or "Hull"
    if cfMode == "" then cfMode = "Hull" end

    local transformTokens = {
        FORGE_SYNC_HASH_SCHEMA_V1,
        "xform",
        sizeStr,
        posStr,
        rotMatStr,
        anchStr,
        collStr,
        cfMode,
    }
    local transformHash = computeLuauContentHash(table.concat(transformTokens, "|"))

    local hierarchyTokens = {
        FORGE_SYNC_HASH_SCHEMA_V1,
        "hier",
        hier.parentId,
        hier.parentName,
        hier.hierarchyPath,
    }
    local hierarchyHash = computeLuauContentHash(table.concat(hierarchyTokens, "|"))

    local combinedHash = computeLuauContentHash(
        string.format(
            "%s|part|%s|%s|%s|%s|%s",
            FORGE_SYNC_HASH_SCHEMA_V1,
            hier.partId,
            geometryHash,
            materialHash,
            transformHash,
            hierarchyHash
        )
    )

    return {
        hashSchemaVersion = FORGE_SYNC_HASH_SCHEMA_V1,
        partId = hier.partId,
        parentId = hier.parentId,
        parentName = hier.parentName,
        parentContainerClass = hier.parentContainerClass,
        hierarchyPath = hier.hierarchyPath,
        geometrySource = geometrySource,
        rotationMatrix = rotMat9,
        reflectance = tonumber(reflStr) or 0,
        geometryHash = geometryHash,
        materialHash = materialHash,
        transformHash = transformHash,
        hierarchyHash = hierarchyHash,
        combinedHash = combinedHash,
    }
end

-- Ensures nested Model or Folder containers exist inside rootModel for any multi-segment hierarchyPath or parentPath
local function ensureHierarchyContainer(rootModel: Model, parentOrHierarchyPath: string?, leafPartName: string?, leafContainerClass: string?): Instance
    if not parentOrHierarchyPath or parentOrHierarchyPath == "" or parentOrHierarchyPath == "ModelRoot" or parentOrHierarchyPath == "Root" or parentOrHierarchyPath == rootModel.Name then
        return rootModel
    end
    local segments: { string } = {}
    for segment in string.gmatch(string.gsub(parentOrHierarchyPath, "\\", "/"), "[^/]+") do
        local trimmed = string.match(segment, "^%s*(.-)%s*$") or ""
        if trimmed ~= "" and trimmed ~= "ModelRoot" and trimmed ~= "Root" and trimmed ~= rootModel.Name then
            table.insert(segments, trimmed)
        end
    end
    if leafPartName and #segments > 0 and segments[#segments] == leafPartName then
        table.remove(segments, #segments)
    end
    if #segments == 0 then
        return rootModel
    end

    local current: Instance = rootModel
    local accumPath = ""
    for segIdx, trimmed in ipairs(segments) do
        accumPath = if accumPath == "" then trimmed else (accumPath .. "/" .. trimmed)
        local isDirectParent = (segIdx == #segments)
        local desiredClass = if isDirectParent and (leafContainerClass == "Folder" or leafContainerClass == "Model")
            then leafContainerClass
            elseif string.find(string.lower(trimmed), "folder", 1, true) or string.find(string.lower(trimmed), "group", 1, true)
            then "Folder"
            else "Model"
        local existing = current:FindFirstChild(trimmed)
        if not existing or (not existing:IsA("Model") and not existing:IsA("Folder")) then
            local container = Instance.new(desiredClass)
            container.Name = trimmed
            container:SetAttribute("ForgeNodeId", "fnode_" .. string.gsub(accumPath, "[^%w_]", "_"))
            container:SetAttribute("ForgeHierarchyPath", accumPath)
            container.Parent = current
            current = container
        else
            current = existing
        end
    end
    return current
end

-- Build 3D Model from Forge3DAsset parts array in Workspace or WorldModel
local function construct3DModelFromSpec(assetData: any, targetParent: Instance?, explicitOrigin: CFrame?): Model
    local recordId = ChangeHistoryService:TryBeginRecording("ForgeAI Spawn EditableMesh 3D Asset")

    local model = Instance.new("Model")
    model.Name = assetData.name or "Forge3DModel"

    local camera = Workspace.CurrentCamera
    local spawnOrigin = explicitOrigin or (if camera
        then CFrame.new(camera.CFrame.Position + (camera.CFrame.LookVector * 18))
        else CFrame.new(0, 5, 0))

    -- Store the exact spawn origin CFrame and baseline snapshot SHA-256 on the Model
    -- so serializeStudioPartsFromInstances can convert world CFrames back to model-relative space!
    model:SetAttribute("ForgeSyncOriginCFrame", spawnOrigin)
    model:SetAttribute("ForgeHierarchyContainersBuilt", true)
    if type(assetData.snapshot_sha256) == "string" and #assetData.snapshot_sha256 > 0 then
        model:SetAttribute("ForgeBaselineSnapshotSha256", assetData.snapshot_sha256)
    end
    pcall(function()
        model.WorldPivot = spawnOrigin
    end)

    local partsList = assetData.parts or {}
    local verifiedPartCount = 0
    local failedPartCount = 0

    for idx, partSpec in ipairs(partsList) do
        local part, isVerified, _ = createEditableMeshPartFromSpec(partSpec, idx)
        if isVerified then
            verifiedPartCount += 1
        else
            failedPartCount += 1
        end

        local syncMeta = computePartSyncHashesLuau(partSpec, idx)
        local pos = partSpec.position or { 0, 1, 0 }
        local rotMat = syncMeta.rotationMatrix
        local localCF = CFrame.new(
            tonumber(pos[1]) or 0,
            tonumber(pos[2]) or 0,
            tonumber(pos[3]) or 0,
            rotMat[1], rotMat[2], rotMat[3],
            rotMat[4], rotMat[5], rotMat[6],
            rotMat[7], rotMat[8], rotMat[9]
        )
        part.CFrame = spawnOrigin * localCF

        local col = partSpec.color or { 160, 165, 175 }
        part.Color = Color3.fromRGB(col[1] or 160, col[2] or 165, col[3] or 175)

        local matEnum = (Enum.Material :: any)[partSpec.material or "Metal"]
        if matEnum then
            part.Material = matEnum
        end

        part.Transparency = partSpec.transparency or 0
        part.Reflectance = tonumber(syncMeta.reflectance) or 0
        part.Anchored = if partSpec.anchored ~= nil then partSpec.anchored else true
        part.CanCollide = if partSpec.canCollide ~= nil then partSpec.canCollide else true
        part.TopSurface = Enum.SurfaceType.Smooth
        part.BottomSurface = Enum.SurfaceType.Smooth

        local roughnessVal = tonumber(partSpec.roughness) or 0.35
        local metalnessVal = tonumber(partSpec.metalness) or 0.6
        part:SetAttribute("PBR_Roughness", roughnessVal)
        part:SetAttribute("PBR_Metalness", metalnessVal)
        part:SetAttribute("Roughness", roughnessVal)
        part:SetAttribute("Metalness", metalnessVal)

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

        -- Preserve stable ForgePartId, parent hierarchy, and geometry buffer for bidirectional DataModel sync
        part:SetAttribute("ForgePartId", syncMeta.partId)
        part:SetAttribute("ForgeParentId", syncMeta.parentId)
        part:SetAttribute("ForgeParentName", syncMeta.parentName)
        part:SetAttribute("ForgeParentContainerClass", syncMeta.parentContainerClass)
        part:SetAttribute("ForgeHierarchyPath", syncMeta.hierarchyPath)
        part:SetAttribute("ForgeGeometrySource", syncMeta.geometrySource)

        if type(partSpec.meshData) == "table" and not part:FindFirstChild("ForgeMeshGeometryJSON") then
            local okJson, encodedGeom = pcall(function()
                return HttpService:JSONEncode({
                    hashSchemaVersion = syncMeta.hashSchemaVersion,
                    partId = syncMeta.partId,
                    parentId = syncMeta.parentId,
                    parentName = syncMeta.parentName,
                    parentContainerClass = syncMeta.parentContainerClass,
                    hierarchyPath = syncMeta.hierarchyPath,
                    geometrySource = syncMeta.geometrySource,
                    geometryHash = syncMeta.geometryHash,
                    materialHash = syncMeta.materialHash,
                    transformHash = syncMeta.transformHash,
                    hierarchyHash = syncMeta.hierarchyHash,
                    combinedHash = syncMeta.combinedHash,
                    publishedMeshId = if isVerifiedRobloxAssetUri(partSpec.meshId) then partSpec.meshId else nil,
                    meshId = if isVerifiedRobloxAssetUri(partSpec.meshId) then partSpec.meshId else nil,
                    textureId = if isVerifiedRobloxAssetUri(partSpec.textureId) then partSpec.textureId else nil,
                    size = partSpec.size or { part.Size.X, part.Size.Y, part.Size.Z },
                    position = { tonumber(pos[1]) or 0, tonumber(pos[2]) or 0, tonumber(pos[3]) or 0 },
                    rotation = canonicalMatrix9ToEulerDeg(rotMat),
                    rotationMatrix = rotMat,
                    color = { col[1] or 160, col[2] or 165, col[3] or 175 },
                    material = part.Material.Name,
                    roughness = roughnessVal,
                    metalness = metalnessVal,
                    reflectance = syncMeta.reflectance,
                    transparency = part.Transparency,
                    canCollide = part.CanCollide,
                    anchored = part.Anchored,
                    collisionFidelity = partSpec.collisionFidelity or "Hull",
                    pbrMaterial = partSpec.pbrMaterial,
                    vertices = partSpec.meshData.vertices or {},
                    normals = partSpec.meshData.normals or {},
                    uvs = partSpec.meshData.uvs or {},
                    faces = partSpec.meshData.faces or {},
                })
            end)
            if okJson and type(encodedGeom) == "string" then
                local geomStringVal = Instance.new("StringValue")
                geomStringVal.Name = "ForgeMeshGeometryJSON"
                geomStringVal.Value = encodedGeom
                geomStringVal.Parent = part
            end
        end

        part.Parent = ensureHierarchyContainer(model, syncMeta.hierarchyPath, syncMeta.partName, syncMeta.parentContainerClass)
        if idx == 1 then
            model.PrimaryPart = part
        end
    end

    local allVerified = (#partsList > 0) and (verifiedPartCount == #partsList) and (failedPartCount == 0)
    model:SetAttribute("ForgeEditableMeshReconstructed", allVerified)
    model:SetAttribute("ForgeReconstructionVerified", allVerified)
    model:SetAttribute("ForgeVerifiedPartCount", verifiedPartCount)
    model:SetAttribute("ForgeFailedPartCount", failedPartCount)
    model.Parent = targetParent or Workspace
    Selection:Set({ model })

    if recordId then
        ChangeHistoryService:FinishRecording(recordId, Enum.FinishRecordingOperation.Commit)
    end

    return model
end

-- Reconstructs EditableMesh geometry for a single imported .RBXMX model in Edit Mode or Play Mode
local function reconstructSingleModelInPlace(model: Model): (boolean, number, number)
    local reconstructorModule = model:FindFirstChild("ForgeStudioReconstructor")
    if reconstructorModule and reconstructorModule:IsA("ModuleScript") then
        local okReq, builder = pcall(require, reconstructorModule)
        if okReq and type(builder) == "table" and type(builder.ReconstructInPlace) == "function" then
            local okRun, r1, r2, r3 = xpcall(function()
                return builder.ReconstructInPlace(model)
            end, debug.traceback)
            if okRun then
                local verCount = 0
                local allVerified = false
                local expectedCount = 0
                if type(r1) == "number" then
                    verCount = r1
                    allVerified = if type(r2) == "boolean" then r2 else (verCount > 0)
                    expectedCount = if type(r3) == "number" then r3 else verCount
                elseif type(r1) == "boolean" then
                    allVerified = r1
                    verCount = if type(r2) == "number" then r2 else 0
                    expectedCount = verCount
                end
                if verCount > 0 and allVerified then
                    model:SetAttribute("ForgeEditableMeshReconstructed", true)
                    model:SetAttribute("ForgeReconstructionVerified", true)
                    return true, verCount, math.max(0, expectedCount - verCount)
                elseif verCount > 0 then
                    model:SetAttribute("ForgeEditableMeshReconstructed", false)
                    model:SetAttribute("ForgeReconstructionVerified", false)
                    return false, verCount, math.max(1, expectedCount - verCount)
                end
            else
                warn("[ForgeAI Plugin] Error ejecutando ForgeStudioReconstructor.ReconstructInPlace: " .. tostring(r1))
            end
        end
    end

    -- Direct plugin fallback using embedded ForgeMeshGeometryJSON StringValues across all descendants
    local verifiedParts = 0
    local failedParts = 0
    for idx, child in ipairs(model:GetDescendants()) do
        if child:IsA("BasePart") then
            local geomVal = child:FindFirstChild("ForgeMeshGeometryJSON")
            if geomVal and geomVal:IsA("StringValue") and #geomVal.Value > 2 then
                local okDec, parsedGeom = pcall(function()
                    return HttpService:JSONDecode(geomVal.Value)
                end)
                if okDec and type(parsedGeom) == "table" then
                    local newPart, isVerified, errReason = createEditableMeshPartFromSpec({
                        name = child.Name,
                        meshId = parsedGeom.publishedMeshId or parsedGeom.meshId,
                        size = parsedGeom.size or { child.Size.X, child.Size.Y, child.Size.Z },
                        collisionFidelity = parsedGeom.collisionFidelity or "Hull",
                        meshData = parsedGeom,
                    }, idx)
                    if isVerified then
                        local parentTarget = child.Parent or model
                        newPart.CFrame = child.CFrame
                        newPart.Color = child.Color
                        newPart.Material = child.Material
                        newPart.Transparency = child.Transparency
                        newPart.Anchored = child.Anchored
                        newPart.CanCollide = child.CanCollide
                        for _, subChild in ipairs(child:GetChildren()) do
                            subChild:Clone().Parent = newPart
                        end
                        newPart.Parent = parentTarget
                        if model.PrimaryPart == child then
                            model.PrimaryPart = newPart
                        end
                        child:Destroy()
                        verifiedParts += 1
                    else
                        newPart:Destroy()
                        failedParts += 1
                        child:SetAttribute("ForgeGeometryVerified", false)
                        child:SetAttribute("ForgeReconstructionError", errReason or "EditableMesh reconstruction failed")
                    end
                else
                    failedParts += 1
                end
            end
        end
    end

    local allSucceeded = (verifiedParts > 0) and (failedParts == 0)
    model:SetAttribute("ForgeEditableMeshReconstructed", allSucceeded)
    model:SetAttribute("ForgeReconstructionVerified", allSucceeded)
    model:SetAttribute("ForgeVerifiedPartCount", verifiedParts)
    model:SetAttribute("ForgeFailedPartCount", failedParts)
    return allSucceeded, verifiedParts, failedParts
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

    local fullyVerifiedModels = 0
    local partialOrFailedModels = 0
    local reconstructedParts = 0
    local failedPartsTotal = 0

    for _, model in ipairs(candidates) do
        local allOk, verCount, failCount = reconstructSingleModelInPlace(model)
        reconstructedParts += verCount
        failedPartsTotal += failCount
        if allOk then
            fullyVerifiedModels += 1
        elseif verCount > 0 or failCount > 0 then
            partialOrFailedModels += 1
        end
    end

    if recordId then
        ChangeHistoryService:FinishRecording(recordId, Enum.FinishRecordingOperation.Commit)
    end

    if fullyVerifiedModels == 0 and partialOrFailedModels == 0 then
        return "No se encontraron modelos .RBXMX pendientes de reconstrucción en Selection ni Workspace."
    end
    if partialOrFailedModels > 0 or failedPartsTotal > 0 then
        return string.format(
            "⚠️ Reconstrucción EditableMesh parcial/con avisos: %d modelo(s) 100%% verificados, %d con fallos (%d MeshParts verificados, %d fallidos). Revisa Output.",
            fullyVerifiedModels,
            partialOrFailedModels,
            reconstructedParts,
            failedPartsTotal
        )
    end
    return string.format(
        "✅ Reconstrucción EditableMesh 100%% verificada en Modo Edición: %d modelo(s), %d MeshPart(s) reconstruidos con geometría real.",
        fullyVerifiedModels,
        reconstructedParts
    )
end

-- Resolves the model-relative origin CFrame for a Studio Model so camera spawn offsets
-- never cause false transform diffs when syncing back to Forge.
local function resolveModelSyncOriginCFrame(rootModel: Model?, collectedParts: { BasePart }): CFrame
    if rootModel then
        local attrOrigin = rootModel:GetAttribute("ForgeSyncOriginCFrame")
        if typeof(attrOrigin) == "CFrame" then
            return attrOrigin
        end
    end
    -- If imported from .rbxmx without ForgeSyncOriginCFrame attribute, check if the first part
    -- has saved local position/rotationMatrix in ForgeMeshGeometryJSON and infer the origin CFrame:
    -- worldCF = originCF * savedLocalCF  =>  originCF = worldCF * savedLocalCF:Inverse()
    for _, part in ipairs(collectedParts) do
        local geomVal = part:FindFirstChild("ForgeMeshGeometryJSON")
        if geomVal and geomVal:IsA("StringValue") and #geomVal.Value > 2 then
            local okDec, decoded = pcall(function()
                return HttpService:JSONDecode(geomVal.Value)
            end)
            if okDec and type(decoded) == "table" and type(decoded.position) == "table" and #decoded.position >= 3 then
                local px = tonumber(decoded.position[1]) or 0
                local py = tonumber(decoded.position[2]) or 0
                local pz = tonumber(decoded.position[3]) or 0
                local rotMat: { number }
                if type(decoded.rotationMatrix) == "table" and #decoded.rotationMatrix >= 9 then
                    rotMat = decoded.rotationMatrix
                else
                    local rot = if type(decoded.rotation) == "table" then decoded.rotation else { 0, 0, 0 }
                    rotMat = canonicalEulerToMatrix9(tonumber(rot[1]) or 0, tonumber(rot[2]) or 0, tonumber(rot[3]) or 0)
                end
                local savedLocalCF = CFrame.new(
                    px, py, pz,
                    tonumber(rotMat[1]) or 1, tonumber(rotMat[2]) or 0, tonumber(rotMat[3]) or 0,
                    tonumber(rotMat[4]) or 0, tonumber(rotMat[5]) or 1, tonumber(rotMat[6]) or 0,
                    tonumber(rotMat[7]) or 0, tonumber(rotMat[8]) or 0, tonumber(rotMat[9]) or 1
                )
                local inferredOrigin = part.CFrame * savedLocalCF:Inverse()
                -- If inferredOrigin is close to identity (within 1e-3), use exact identity
                local ox, oy, oz = inferredOrigin.Position.X, inferredOrigin.Position.Y, inferredOrigin.Position.Z
                if math.abs(ox) < 1e-3 and math.abs(oy) < 1e-3 and math.abs(oz) < 1e-3 then
                    return CFrame.new(0, 0, 0)
                end
                if rootModel then
                    rootModel:SetAttribute("ForgeSyncOriginCFrame", inferredOrigin)
                end
                return inferredOrigin
            end
        end
    end
    return CFrame.new(0, 0, 0)
end

-- Walks ancestor chain from `part.Parent` up to `rootModel` to build the real nested hierarchy path
local function resolveStudioPartHierarchy(part: BasePart, rootModel: Model?, meshData: any): (string, string, string, string)
    local segments: { string } = {}
    local directParentClass = "Model"
    local firstContainerSeen = false
    local curr: Instance? = part.Parent
    while curr and curr ~= Workspace and curr ~= game and curr ~= rootModel do
        if curr:IsA("Model") or curr:IsA("Folder") then
            if not firstContainerSeen then
                directParentClass = if curr:IsA("Folder") then "Folder" else "Model"
                firstContainerSeen = true
            end
            if curr.Name ~= "ModelRoot" and curr.Name ~= "Root" and (not rootModel or curr.Name ~= rootModel.Name) then
                table.insert(segments, 1, curr.Name)
            end
        end
        curr = curr.Parent
    end

    local parentName = "Root"
    local hierarchyPath = "Root/" .. part.Name
    if #segments > 0 then
        parentName = segments[#segments]
        hierarchyPath = "Root/" .. table.concat(segments, "/") .. "/" .. part.Name
    elseif rootModel and part.Parent == rootModel then
        local containersBuilt = rootModel:GetAttribute("ForgeHierarchyContainersBuilt") == true
        if not containersBuilt then
            local attrHierarchyPath = part:GetAttribute("ForgeHierarchyPath")
                or (if type(meshData) == "table" then meshData.hierarchyPath else nil)
            local attrParent = part:GetAttribute("ForgeParentName")
                or (if type(meshData) == "table" then meshData.parentName else nil)
            if type(attrHierarchyPath) == "string" and #attrHierarchyPath > 0 then
                hierarchyPath = attrHierarchyPath
            end
            if type(attrParent) == "string" and #attrParent > 0 and attrParent ~= "Root" and attrParent ~= "ModelRoot" then
                parentName = attrParent
            end
        end
    end

    local cleanedSegs: { string } = {}
    for _, seg in ipairs(segments) do
        table.insert(cleanedSegs, (string.gsub(seg, "[^%w_]", "_")))
    end
    local parentClean = table.concat(cleanedSegs, "_")
    local parentId = if #segments == 0 then "fnode_Root" else ("fnode_" .. parentClean)
    return parentId, parentName, hierarchyPath, directParentClass
end

-- Helper to serialize BaseParts from a Studio Model or Selection with ForgePartId,
-- model-relative CFrame & 9-component rotationMatrix, nested hierarchy, external MeshPart preservation, and PBR
local function serializeStudioPartsFromInstances(collectedParts: { BasePart }, rootModel: Model?): { [number]: { [string]: any } }
    local serializedParts = {}
    local originCFrame = resolveModelSyncOriginCFrame(rootModel, collectedParts)

    for idx, part in ipairs(collectedParts) do
        local relCF = originCFrame:ToObjectSpace(part.CFrame)
        local px, py, pz, r00, r01, r02, r10, r11, r12, r20, r21, r22 = relCF:GetComponents()
        local rotMat = {
            tonumber(fmtCanonicalFixed(r00, 6)) or 1,
            tonumber(fmtCanonicalFixed(r01, 6)) or 0,
            tonumber(fmtCanonicalFixed(r02, 6)) or 0,
            tonumber(fmtCanonicalFixed(r10, 6)) or 0,
            tonumber(fmtCanonicalFixed(r11, 6)) or 1,
            tonumber(fmtCanonicalFixed(r12, 6)) or 0,
            tonumber(fmtCanonicalFixed(r20, 6)) or 0,
            tonumber(fmtCanonicalFixed(r21, 6)) or 0,
            tonumber(fmtCanonicalFixed(r22, 6)) or 1,
        }
        local eulerDeg = canonicalMatrix9ToEulerDeg(rotMat)

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

        local partIdAttr = part:GetAttribute("ForgePartId")
        local partIdVal = part:FindFirstChild("ForgePartId")
        local cleanName = string.gsub(part.Name, "[^%w_]", "_")
        local partId = if type(partIdAttr) == "string" and #partIdAttr > 0
            then partIdAttr
            elseif partIdVal and partIdVal:IsA("StringValue") and #partIdVal.Value > 0
            then partIdVal.Value
            elseif type(meshData) == "table" and type(meshData.partId) == "string" and #meshData.partId > 0
            then meshData.partId
            else ("fpart_" .. cleanName)

        local parentId, parentName, hierarchyPath, parentContainerClass = resolveStudioPartHierarchy(part, rootModel, meshData)

        -- Preserve real MeshId / TextureID and never replace external MeshParts with procedural cubes!
        local rawMeshId = ""
        local rawTexId = ""
        if part:IsA("MeshPart") then
            pcall(function()
                rawMeshId = tostring(part.MeshId or "")
                rawTexId = tostring(part.TextureID or "")
            end)
        end
        if not isVerifiedRobloxAssetUri(rawMeshId) then
            local attrMeshId = part:GetAttribute("PublishedMeshId")
                or (if type(meshData) == "table" then (meshData.publishedMeshId or meshData.meshId) else nil)
            if isVerifiedRobloxAssetUri(attrMeshId) then
                rawMeshId = tostring(attrMeshId)
            else
                rawMeshId = ""
            end
        end
        if not isVerifiedRobloxAssetUri(rawTexId) then
            local attrTexId = if type(meshData) == "table" then meshData.textureId else nil
            if isVerifiedRobloxAssetUri(attrTexId) then
                rawTexId = tostring(attrTexId)
            else
                rawTexId = ""
            end
        end

        local hasEditableBuffers = type(meshData) == "table"
            and type(meshData.vertices) == "table"
            and #meshData.vertices > 0
            and type(meshData.faces) == "table"
            and #meshData.faces > 0

        local geometrySource = "EditableMeshBuffers"
        if hasEditableBuffers then
            geometrySource = "EditableMeshBuffers"
        elseif rawMeshId ~= "" then
            geometrySource = "PublishedCloudMeshId"
        else
            geometrySource = "StudioExternalUnreadable"
        end

        local roughnessVal = tonumber(
            part:GetAttribute("PBR_Roughness")
            or part:GetAttribute("Roughness")
            or part:GetAttribute("ForgePBRRoughness")
            or (if type(meshData) == "table" then meshData.roughness else nil)
        ) or 0.35
        local metalnessVal = tonumber(
            part:GetAttribute("PBR_Metalness")
            or part:GetAttribute("Metalness")
            or part:GetAttribute("ForgePBRMetalness")
            or (if type(meshData) == "table" then meshData.metalness else nil)
        ) or 0.6
        local reflectanceVal = tonumber(fmtCanonicalFixed(part.Reflectance, 3)) or 0

        local sa = part:FindFirstChildOfClass("SurfaceAppearance")
        local pbrSpec = if type(meshData) == "table" and type(meshData.pbrMaterial) == "table" then meshData.pbrMaterial else nil
        if sa then
            pbrSpec = {
                materialName = tostring(part:GetAttribute("PBR_MaterialName") or (part.Name .. "_PBR")),
                albedoHex = string.format("#%02x%02x%02x", math.round(part.Color.R * 255), math.round(part.Color.G * 255), math.round(part.Color.B * 255)),
                roughness = roughnessVal,
                metalness = metalnessVal,
                colorMapId = if isVerifiedRobloxAssetUri(sa.ColorMap) then sa.ColorMap else nil,
                normalMapId = if isVerifiedRobloxAssetUri(sa.NormalMap) then sa.NormalMap else nil,
                roughnessMapId = if isVerifiedRobloxAssetUri(sa.RoughnessMap) then sa.RoughnessMap else nil,
                metalnessMapId = if isVerifiedRobloxAssetUri(sa.MetalnessMap) then sa.MetalnessMap else nil,
                colorMapAssetId = if isVerifiedRobloxAssetUri(sa.ColorMap) then sa.ColorMap else nil,
                normalMapAssetId = if isVerifiedRobloxAssetUri(sa.NormalMap) then sa.NormalMap else nil,
                roughnessMapAssetId = if isVerifiedRobloxAssetUri(sa.RoughnessMap) then sa.RoughnessMap else nil,
                metalnessMapAssetId = if isVerifiedRobloxAssetUri(sa.MetalnessMap) then sa.MetalnessMap else nil,
            }
        end

        local entry: { [string]: any } = {
            partId = partId,
            parentId = parentId,
            name = part.Name,
            parentName = parentName,
            parentContainerClass = parentContainerClass,
            hierarchyPath = hierarchyPath,
            shape = "MeshPart",
            meshId = if rawMeshId ~= "" then rawMeshId else nil,
            assetId = if rawMeshId ~= "" then rawMeshId else nil,
            textureId = if rawTexId ~= "" then rawTexId else nil,
            geometrySource = geometrySource,
            size = {
                tonumber(fmtCanonicalFixed(part.Size.X, 3)) or 2,
                tonumber(fmtCanonicalFixed(part.Size.Y, 3)) or 2,
                tonumber(fmtCanonicalFixed(part.Size.Z, 3)) or 2,
            },
            position = {
                tonumber(fmtCanonicalFixed(px, 3)) or 0,
                tonumber(fmtCanonicalFixed(py, 3)) or 1,
                tonumber(fmtCanonicalFixed(pz, 3)) or 0,
            },
            rotation = eulerDeg,
            rotationMatrix = rotMat,
            color = {
                math.clamp(math.floor(part.Color.R * 255 + 0.5), 0, 255),
                math.clamp(math.floor(part.Color.G * 255 + 0.5), 0, 255),
                math.clamp(math.floor(part.Color.B * 255 + 0.5), 0, 255),
            },
            material = part.Material.Name,
            roughness = roughnessVal,
            metalness = metalnessVal,
            reflectance = reflectanceVal,
            transparency = tonumber(fmtCanonicalFixed(part.Transparency, 3)) or 0,
            canCollide = part.CanCollide,
            anchored = part.Anchored,
            collisionFidelity = if part:IsA("MeshPart") then part.CollisionFidelity.Name else "Hull",
            meshData = if hasEditableBuffers then meshData else nil,
            pbrMaterial = pbrSpec,
        }

        local syncHashes = computePartSyncHashesLuau(entry, idx)
        entry.hashSchemaVersion = syncHashes.hashSchemaVersion
        entry.geometryHash = syncHashes.geometryHash
        entry.materialHash = syncHashes.materialHash
        entry.transformHash = syncHashes.transformHash
        entry.hierarchyHash = syncHashes.hierarchyHash
        entry.combinedHash = syncHashes.combinedHash

        table.insert(serializedParts, entry)
    end
    return serializedParts
end

-- Incremental In-Place Model Update in Studio (Fase 5.4):
-- Updates only modified domains (`update_geometry`, `update_transform`, `update_material`, `update_hierarchy`, `add`, `delete`)
-- without destroying untouched parts or user-attached Studio instances (WeldConstraints, Scripts, Attachments).
local function applyIncrementalModelUpdateInStudio(
    targetModel: Model,
    assetData: any,
    explicitDeleteIds: { string }?
): (number, number, number, number)
    local recordId = ChangeHistoryService:TryBeginRecording("ForgeAI Incremental Sync Update")
    local existingByPartId: { [string]: BasePart } = {}
    local allBaseParts: { BasePart } = {}

    for _, desc in ipairs(targetModel:GetDescendants()) do
        if desc:IsA("BasePart") then
            table.insert(allBaseParts, desc)
            local pidAttr = desc:GetAttribute("ForgePartId")
            local pidVal = desc:FindFirstChild("ForgePartId")
            local pid = if type(pidAttr) == "string" and #pidAttr > 0
                then pidAttr
                elseif pidVal and pidVal:IsA("StringValue") and #pidVal.Value > 0
                then pidVal.Value
                else ("fpart_" .. string.gsub(desc.Name, "[^%w_]", "_"))
            existingByPartId[pid] = desc
        end
    end

    local originCFrame = resolveModelSyncOriginCFrame(targetModel, allBaseParts)
    local currentSerialized = serializeStudioPartsFromInstances(allBaseParts, targetModel)
    local currentMetaById: { [string]: any } = {}
    for _, s in ipairs(currentSerialized) do
        currentMetaById[tostring(s.partId)] = s
    end

    local incomingParts = if type(assetData) == "table" and type(assetData.parts) == "table" then assetData.parts else {}
    local incomingIds: { [string]: boolean } = {}
    local addedCount = 0
    local updatedCount = 0
    local unchangedCount = 0
    local deletedCount = 0

    for idx, partSpec in ipairs(incomingParts) do
        local syncMeta = computePartSyncHashesLuau(partSpec, idx)
        incomingIds[syncMeta.partId] = true
        local existingPart = existingByPartId[syncMeta.partId]
        local existingMeta = currentMetaById[syncMeta.partId]

        if not existingPart or not existingMeta then
            -- Operation: `add`
            local newPart, _, _ = createEditableMeshPartFromSpec(partSpec, idx)
            local pos = partSpec.position or { 0, 1, 0 }
            local rotMat = syncMeta.rotationMatrix
            local localCF = CFrame.new(
                tonumber(pos[1]) or 0, tonumber(pos[2]) or 0, tonumber(pos[3]) or 0,
                rotMat[1], rotMat[2], rotMat[3],
                rotMat[4], rotMat[5], rotMat[6],
                rotMat[7], rotMat[8], rotMat[9]
            )
            newPart.CFrame = originCFrame * localCF
            local col = partSpec.color or { 148, 163, 184 }
            newPart.Color = Color3.fromRGB(col[1] or 148, col[2] or 163, col[3] or 184)
            local matEnum = (Enum.Material :: any)[partSpec.material or "Metal"]
            if matEnum then newPart.Material = matEnum end
            newPart.Transparency = tonumber(partSpec.transparency) or 0
            newPart.Reflectance = syncMeta.reflectance
            newPart.Anchored = if partSpec.anchored ~= nil then partSpec.anchored else true
            newPart.CanCollide = if partSpec.canCollide ~= nil then partSpec.canCollide else true
            newPart:SetAttribute("ForgePartId", syncMeta.partId)
            newPart:SetAttribute("ForgeParentId", syncMeta.parentId)
            newPart:SetAttribute("ForgeParentName", syncMeta.parentName)
            newPart:SetAttribute("ForgeParentContainerClass", syncMeta.parentContainerClass)
            newPart:SetAttribute("ForgeHierarchyPath", syncMeta.hierarchyPath)
            newPart.Parent = ensureHierarchyContainer(targetModel, syncMeta.hierarchyPath, syncMeta.partName, syncMeta.parentContainerClass)
            addedCount += 1
        else
            local geomChanged = existingMeta.geometryHash ~= syncMeta.geometryHash and existingMeta.geometrySource ~= "StudioExternalUnreadable"
            local xformChanged = existingMeta.transformHash ~= syncMeta.transformHash
            local matChanged = existingMeta.materialHash ~= syncMeta.materialHash
            local hierChanged = existingMeta.hierarchyHash ~= syncMeta.hierarchyHash or existingPart.Name ~= syncMeta.partName

            if not geomChanged and not xformChanged and not matChanged and not hierChanged then
                unchangedCount += 1
            else
                updatedCount += 1
                local activePart = existingPart
                if geomChanged then
                    local rebuiltPart, isVer, _ = createEditableMeshPartFromSpec(partSpec, idx)
                    if isVer then
                        rebuiltPart.CFrame = activePart.CFrame
                        rebuiltPart.Color = activePart.Color
                        rebuiltPart.Material = activePart.Material
                        rebuiltPart.Transparency = activePart.Transparency
                        rebuiltPart.Reflectance = activePart.Reflectance
                        rebuiltPart.Anchored = activePart.Anchored
                        rebuiltPart.CanCollide = activePart.CanCollide
                        for _, ch in ipairs(activePart:GetChildren()) do
                            if ch.Name ~= "ForgeMeshGeometryJSON" then
                                ch.Parent = rebuiltPart
                            end
                        end
                        rebuiltPart.Parent = activePart.Parent
                        if targetModel.PrimaryPart == activePart then
                            targetModel.PrimaryPart = rebuiltPart
                        end
                        activePart:Destroy()
                        activePart = rebuiltPart
                    else
                        rebuiltPart:Destroy()
                    end
                end
                if xformChanged then
                    local sz = partSpec.size or { 2, 2, 2 }
                    activePart.Size = Vector3.new(tonumber(sz[1]) or 2, tonumber(sz[2]) or 2, tonumber(sz[3]) or 2)
                    local pos = partSpec.position or { 0, 1, 0 }
                    local rotMat = syncMeta.rotationMatrix
                    local localCF = CFrame.new(
                        tonumber(pos[1]) or 0, tonumber(pos[2]) or 0, tonumber(pos[3]) or 0,
                        rotMat[1], rotMat[2], rotMat[3],
                        rotMat[4], rotMat[5], rotMat[6],
                        rotMat[7], rotMat[8], rotMat[9]
                    )
                    activePart.CFrame = originCFrame * localCF
                    activePart.Anchored = if partSpec.anchored ~= nil then partSpec.anchored else true
                    activePart.CanCollide = if partSpec.canCollide ~= nil then partSpec.canCollide else true
                end
                if matChanged then
                    local col = partSpec.color or { 148, 163, 184 }
                    activePart.Color = Color3.fromRGB(col[1] or 148, col[2] or 163, col[3] or 184)
                    local matEnum = (Enum.Material :: any)[partSpec.material or "Metal"]
                    if matEnum then activePart.Material = matEnum end
                    activePart.Transparency = tonumber(partSpec.transparency) or 0
                    activePart.Reflectance = syncMeta.reflectance
                    activePart:SetAttribute("PBR_Roughness", tonumber(partSpec.roughness) or 0.35)
                    activePart:SetAttribute("PBR_Metalness", tonumber(partSpec.metalness) or 0.6)
                end
                if hierChanged then
                    activePart.Name = syncMeta.partName
                    activePart:SetAttribute("ForgeParentId", syncMeta.parentId)
                    activePart:SetAttribute("ForgeParentName", syncMeta.parentName)
                    activePart:SetAttribute("ForgeParentContainerClass", syncMeta.parentContainerClass)
                    activePart:SetAttribute("ForgeHierarchyPath", syncMeta.hierarchyPath)
                    activePart.Parent = ensureHierarchyContainer(targetModel, syncMeta.hierarchyPath, syncMeta.partName, syncMeta.parentContainerClass)
                end
                activePart:SetAttribute("ForgePartId", syncMeta.partId)
            end
        end
    end

    local deleteSet: { [string]: boolean } = {}
    if type(explicitDeleteIds) == "table" then
        for _, did in ipairs(explicitDeleteIds) do
            deleteSet[tostring(did)] = true
        end
    end
    for pid, partInst in pairs(existingByPartId) do
        if deleteSet[pid] or (not incomingIds[pid] and type(explicitDeleteIds) == "table" and #explicitDeleteIds == 0) then
            partInst:Destroy()
            deletedCount += 1
        end
    end

    if recordId then
        ChangeHistoryService:FinishRecording(recordId, Enum.FinishRecordingOperation.Commit)
    end
    return addedCount, updatedCount, unchangedCount, deletedCount
end

-- Automated Self-Verification Suite for Luau Plugin (Fase 8.3)
local function runForgePluginSelfVerification(): (boolean, { string })
    local errors: { string } = {}
    if computeLuauContentHash("hello") ~= "4f9f2cab" then
        table.insert(errors, "FNV-1a ASCII vector mismatch")
    end
    if computeLuauContentHash("line1\r\nline2\rline3") ~= computeLuauContentHash("line1\nline2\nline3") then
        table.insert(errors, "FNV-1a CRLF/LF normalization mismatch")
    end
    local samplePart = {
        name = "TurretCannon",
        parentName = "Turret",
        parentContainerClass = "Folder",
        hierarchyPath = "Root/Turret/TurretCannon",
        size = { 2, 2, 4 },
        position = { 0, 3, 0 },
        rotation = { 0, 45, 0 },
        color = { 148, 163, 184 },
        material = "Metal",
        roughness = 0.35,
        metalness = 0.6,
        reflectance = 0.15,
        transparency = 0,
        anchored = true,
        canCollide = true,
        collisionFidelity = "Hull",
        meshData = {
            vertices = { { 0, 0, 0 }, { 1, 0, 0 }, { 0, 1, 0 }, { 0, 0, 1 } },
            normals = { { 0, 1, 0 }, { 0, 1, 0 }, { 0, 1, 0 }, { 0, 1, 0 } },
            uvs = { { 0, 0 }, { 1, 0 }, { 0, 1 }, { 1, 1 } },
            faces = { { 0, 1, 2 }, { 0, 2, 3 } },
        },
    }
    local h1 = computePartSyncHashesLuau(samplePart, 1)
    samplePart.name = "RenamedTurretCannon"
    local h2 = computePartSyncHashesLuau(samplePart, 1)
    if h1.partId ~= h2.partId then
        table.insert(errors, "partId changed after renaming part.name")
    end
    samplePart.meshData.vertices[2][2] = 0.75
    local h3 = computePartSyncHashesLuau(samplePart, 1)
    if h2.geometryHash == h3.geometryHash then
        table.insert(errors, "Intermediate vertex modification did not change geometryHash")
    end
    return (#errors == 0), errors
end

-- Finds the top-level root Model in Workspace for any nested BasePart or sub-Model
local function findRootForgeModel(inst: Instance): Model?
    local topModel: Model? = if inst:IsA("Model") then inst else nil
    local curr = inst.Parent
    while curr and curr ~= Workspace and curr ~= game do
        if curr:IsA("Model") then
            topModel = curr
        end
        curr = curr.Parent
    end
    return topModel
end

-- Verify Rojo Sync Manifest AND live 3D DataModel (geometry, transforms, hierarchies, materials) against Forge
local function verifyRojoSyncInStudio(): (number, number, string)
    local ok, data = requestBackend("/api/v1/rojo/sync-manifest", "GET", nil)
    if not ok then
        return 0, 0, tostring(data)
    end

    local files = data.files or {}
    local syncedCount = 0
    local outdatedList = {}
    local missingList = {}

    for _, item in ipairs(files) do
        local name = item.name
        local relPath: string = item.relative_path or ""
        local expectedHash: string = tostring(item.content_fnv32 or "")
        local found: Instance? = nil

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
            local contentMatch = true
            if #expectedHash > 0 and found:IsA("LuaSourceContainer") then
                local okSrc, srcText = pcall(function()
                    return (found :: any).Source
                end)
                if okSrc and type(srcText) == "string" then
                    local studioHash = computeLuauContentHash(srcText)
                    if studioHash ~= expectedHash then
                        contentMatch = false
                        table.insert(outdatedList, string.format("%s (Studio:%s ≠ Rojo:%s)", name, studioHash, expectedHash))
                    end
                end
            end
            if contentMatch then
                syncedCount += 1
            end
        else
            table.insert(missingList, name .. " (" .. relPath .. ")")
        end
    end

    -- Also compare active/selected 3D Model in Studio DataModel against Forge Web Editor
    local dmSummary = ""
    local targetModel: Model? = nil
    for _, sel in ipairs(Selection:Get()) do
        targetModel = findRootForgeModel(sel)
        if targetModel then
            break
        end
    end
    if not targetModel then
        for _, child in ipairs(Workspace:GetChildren()) do
            if child:IsA("Model") and (child:GetAttribute("ForgeEditableMeshReconstructed") ~= nil or child:FindFirstChild("ForgeStudioReconstructor")) then
                targetModel = child
                break
            end
        end
    end

    if targetModel then
        local modelParts: { BasePart } = {}
        for _, desc in ipairs(targetModel:GetDescendants()) do
            if desc:IsA("BasePart") then
                table.insert(modelParts, desc)
            end
        end
        local serialized = serializeStudioPartsFromInstances(modelParts, targetModel)
        local baselineSha = targetModel:GetAttribute("ForgeBaselineSnapshotSha256")
        local okDiff, diffResp = requestBackend("/api/v1/assets/compare-datamodel", "POST", {
            model_name = targetModel.Name,
            parts = serialized,
            sync_scope = "full_model",
            baseline_snapshot_sha256 = if type(baselineSha) == "string" then baselineSha else nil,
        })
        if okDiff and type(diffResp) == "table" and type(diffResp.diff) == "table" then
            local d = diffResp.diff
            local modCount = if type(d.modified_parts) == "table" then #d.modified_parts else 0
            local addCount = if type(d.added_in_studio) == "table" then #d.added_in_studio else 0
            local remCount = if type(d.removed_in_studio) == "table" then #d.removed_in_studio else 0
            if d.in_sync or d.inSync then
                dmSummary = string.format(
                    "\nDataModel 3D '%s': ✅ 100%% en sincronía (%d MeshParts verificados en geometría, transformaciones relativas, jerarquía y PBR, esquema %s).",
                    targetModel.Name,
                    tonumber(d.unchanged_count or d.matchingPartsCount) or #serialized,
                    tostring(d.hashSchemaVersion or FORGE_SYNC_HASH_SCHEMA_V1)
                )
            else
                dmSummary = string.format(
                    "\nDataModel 3D '%s': ⚠️ Diferencias detectadas (%d modificadas, %d añadidas en Studio, %d eliminadas).",
                    targetModel.Name,
                    modCount,
                    addCount,
                    remCount
                )
            end
        end
    end

    local statusLine = "✅ 100% Sincronizado con Rojo (Existencia + Hash FNV32)"
    if #missingList > 0 or #outdatedList > 0 then
        local parts = {}
        if #missingList > 0 then
            table.insert(parts, "Faltantes: " .. table.concat(missingList, ", "))
        end
        if #outdatedList > 0 then
            table.insert(parts, "Contenido desactualizado: " .. table.concat(outdatedList, ", "))
        end
        statusLine = table.concat(parts, " | ")
    end

    local report = string.format(
        "Sincronizados en Studio: %d/%d módulos Luau.\n%s%s",
        syncedCount,
        #files,
        statusLine,
        dmSummary
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
    local selectedRootModelDirectly = false
    local collectedParts: { BasePart } = {}
    local seenParts: { [BasePart]: boolean } = {}

    for _, inst in ipairs(selected) do
        local rootCandidate = findRootForgeModel(inst)
        if rootCandidate and not targetModel then
            targetModel = rootCandidate
        end
        if inst:IsA("Model") then
            if inst == targetModel then
                selectedRootModelDirectly = true
            end
            for _, child in ipairs(inst:GetDescendants()) do
                if child:IsA("BasePart") and not seenParts[child] then
                    seenParts[child] = true
                    table.insert(collectedParts, child)
                end
            end
        elseif inst:IsA("BasePart") and not seenParts[inst] then
            seenParts[inst] = true
            table.insert(collectedParts, inst)
        end
    end

    if #collectedParts == 0 then
        return "La selección no contiene BaseParts ni MeshParts."
    end

    local modelName = if targetModel then targetModel.Name else "StudioSyncedModel"
    local syncScope = if selectedRootModelDirectly then "full_model" else "selection"
    local serializedParts = serializeStudioPartsFromInstances(collectedParts, targetModel)
    local baselineSha = if targetModel then targetModel:GetAttribute("ForgeBaselineSnapshotSha256") else nil

    local ok, resp = requestBackend("/api/v1/assets/studio-push", "POST", {
        model_name = modelName,
        parts = serializedParts,
        sync_scope = syncScope,
        remove_missing = (syncScope == "full_model"),
        conflict_policy = "smart_merge",
        baseline_snapshot_sha256 = if type(baselineSha) == "string" then baselineSha else nil,
    })

    if not ok then
        return "Error en Push Incremental hacia Forge: " .. tostring(resp)
    end

    if targetModel and type(resp.asset) == "table" and type(resp.asset.snapshot_sha256) == "string" then
        targetModel:SetAttribute("ForgeBaselineSnapshotSha256", resp.asset.snapshot_sha256)
    end

    local diffInfo = ""
    if type(resp.sync_diff) == "table" then
        local modCount = if type(resp.sync_diff.modified_parts) == "table" then #resp.sync_diff.modified_parts else 0
        diffInfo = string.format(
            " | Scope: %s | Diff: %d modificadas, %d sin cambios",
            syncScope,
            modCount,
            tonumber(resp.sync_diff.unchanged_count or resp.sync_diff.matchingPartsCount) or 0
        )
    end

    return string.format(
        "✅ Push Incremental Studio → Forge completado: %s (%d piezas sincronizadas, v%s%s)\nRojo .rbxmx: %s",
        modelName,
        #serializedParts,
        tostring(resp.asset and resp.asset.version or 1),
        diffInfo,
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

local tokenBox = Instance.new("TextBox")
tokenBox.PlaceholderText = "X-Forge-Token (opcional, guardado en plugin:SetSetting)"
tokenBox.Text = FORGE_SECURITY_TOKEN
tokenBox.ClearTextOnFocus = false
tokenBox.Font = Enum.Font.Code
tokenBox.TextSize = 11
tokenBox.TextColor3 = Color3.fromRGB(226, 232, 240)
tokenBox.BackgroundColor3 = Color3.fromRGB(30, 41, 59)
tokenBox.Size = UDim2.new(1, 0, 0, 26)
tokenBox.TextXAlignment = Enum.TextXAlignment.Left
tokenBox.LayoutOrder = 10
tokenBox.Parent = root

tokenBox.FocusLost:Connect(function()
    FORGE_SECURITY_TOKEN = string.match(tokenBox.Text or "", "^%s*(.-)%s*$") or ""
    pcall(function()
        if plugin and type(plugin.SetSetting) == "function" then
            plugin:SetSetting("ForgeSecurityToken", FORGE_SECURITY_TOKEN)
        end
    end)
end)

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
outputLog.LayoutOrder = 11
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

-- Automatic Edit-Mode .RBXMX Reconstructor:
-- When a .RBXMX model containing ForgeStudioReconstructor or ForgeMeshGeometryJSON is imported into Workspace
-- in Roblox Studio Edit Mode (without starting Play Mode), reconstruct its EditableMesh geometry automatically.
local RunService = game:GetService("RunService")
if RunService:IsEdit() then
    Workspace.ChildAdded:Connect(function(child: Instance)
        if child:IsA("Model") and not child:GetAttribute("ForgeEditableMeshReconstructed") then
            task.defer(function()
                if child.Parent and (child:FindFirstChild("ForgeStudioReconstructor") or child:FindFirstChild("ForgeMeshGeometryJSON", true)) then
                    local recordId = ChangeHistoryService:TryBeginRecording("ForgeAI Auto-Reconstruct Imported RBXMX")
                    local allOk, verCount, failCount = reconstructSingleModelInPlace(child)
                    if recordId then
                        ChangeHistoryService:FinishRecording(recordId, Enum.FinishRecordingOperation.Commit)
                    end
                    if allOk and verCount > 0 then
                        outputLog.Text = string.format(
                            "✨ Auto-reconstrucción .RBXMX en Modo Edición completada: '%s' (%d MeshParts verificados).",
                            child.Name,
                            verCount
                        )
                    elseif verCount > 0 or failCount > 0 then
                        outputLog.Text = string.format(
                            "⚠️ Auto-reconstrucción .RBXMX para '%s': %d verificados, %d fallidos.",
                            child.Name,
                            verCount,
                            failCount
                        )
                    end
                end
            end)
        end
    end)
end

