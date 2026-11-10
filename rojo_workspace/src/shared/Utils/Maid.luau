--!strict
--[[
    Maid.luau
    =========
    Standard memory management and task cleanup utility for Roblox Luau.
    Verified local module at ReplicatedStorage.Shared.Utils.Maid
]]

local Maid = {}
Maid.__index = Maid

export type MaidTask =
    RBXScriptConnection
    | Instance
    | Tween
    | (() -> ())
    | { Destroy: (any) -> () }
    | { disconnect: (any) -> () }

export type Maid = typeof(setmetatable(
    {} :: {
        _tasks: { [any]: MaidTask },
    },
    Maid
))

function Maid.new(): Maid
    local self = setmetatable({
        _tasks = {},
    }, Maid)
    return self
end

function Maid.isMaid(value: any): boolean
    return typeof(value) == "table" and getmetatable(value) == Maid
end

function Maid:GiveTask(taskItem: MaidTask): number
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
        elseif typeof(taskItem) == "table" then
            if typeof((taskItem :: any).Destroy) == "function" then
                (taskItem :: any):Destroy()
            elseif typeof((taskItem :: any).Cancel) == "function" then
                (taskItem :: any):Cancel()
            elseif typeof((taskItem :: any).disconnect) == "function" then
                (taskItem :: any):disconnect()
            end
        end
        tasks[key] = nil
    end
end

function Maid:Destroy()
    self:DoCleaning()
end

return Maid
