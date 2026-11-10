--!strict
--[[
    GameTypes.luau
    ==============
    Shared static Luau types for Forge AI Roblox architecture.
]]

export type Vector3Data = { x: number, y: number, z: number }

export type PBRSurfaceConfig = {
    colorHex: string,
    metalness: number,
    roughness: number,
    emissiveHex: string?,
    emissiveIntensity: number?,
    robloxMaterial: string,
}

export type MeshPartSpec = {
    name: string,
    shape: "Block" | "Cylinder" | "Ball" | "Wedge" | "CornerWedge" | "Torso" | "BevelExtrude",
    size: { number },
    position: { number },
    rotation: { number },
    color: { number },
    material: string,
    roughness: number,
    metalness: number,
    transparency: number?,
    canCollide: boolean,
    anchored: boolean,
    collisionFidelity: "Default" | "Box" | "Hull" | "PreciseConvexDecomposition",
}

export type InventoryItem = {
    id: string,
    name: string,
    rarity: "Common" | "Rare" | "Epic" | "Legendary",
    quantity: number,
}

export type PlayerData = {
    credits: number,
    level: number,
    experience: number,
    inventory: { InventoryItem },
}

return {}
