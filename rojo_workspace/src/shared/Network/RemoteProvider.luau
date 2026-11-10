--!strict
--[[
    RemoteProvider.luau
    ===================
    Type-safe RemoteEvent & RemoteFunction registry for ReplicatedStorage.Shared.Network.RemoteProvider
]]

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")

local RemoteProvider = {}
local CONTAINER_NAME = "ForgeNetworkRemotes"

local function getOrCreateContainer(): Folder
    local existing = ReplicatedStorage:FindFirstChild(CONTAINER_NAME)
    if existing and existing:IsA("Folder") then
        return existing
    end

    if RunService:IsServer() then
        local folder = Instance.new("Folder")
        folder.Name = CONTAINER_NAME
        folder.Parent = ReplicatedStorage
        return folder
    else
        return ReplicatedStorage:WaitForChild(CONTAINER_NAME, 10) :: Folder
    end
end

function RemoteProvider.GetEvent(eventName: string): RemoteEvent
    local container = getOrCreateContainer()
    local existing = container:FindFirstChild(eventName)
    if existing and existing:IsA("RemoteEvent") then
        return existing
    end

    if RunService:IsServer() then
        local remote = Instance.new("RemoteEvent")
        remote.Name = eventName
        remote.Parent = container
        return remote
    else
        return container:WaitForChild(eventName, 10) :: RemoteEvent
    end
end

function RemoteProvider.GetFunction(functionName: string): RemoteFunction
    local container = getOrCreateContainer()
    local existing = container:FindFirstChild(functionName)
    if existing and existing:IsA("RemoteFunction") then
        return existing
    end

    if RunService:IsServer() then
        local remote = Instance.new("RemoteFunction")
        remote.Name = functionName
        remote.Parent = container
        return remote
    else
        return container:WaitForChild(functionName, 10) :: RemoteFunction
    end
end

return RemoteProvider
