import { describe, expect, it } from "vitest";
import { addProfile, editActiveEquipment, normalizeProfiles, removeProfile, renameProfile, switchProfile } from "../equipmentProfiles";
import type { Equipment } from "@/domain/types";

const gym: Equipment = { barWeightKg: 20, platesKg: [1.25, 2.5, 5, 10, 20], dumbbellsKg: [10, 12.5, 15], machineStepKg: 5 };
const legacy = { equipment: gym };

describe("perfiles de equipamiento (A4.5)", () => {
  it("migración: el inventario actual pasa a ser el perfil Principal activo", () => {
    const { profiles, activeId } = normalizeProfiles(legacy);
    expect(profiles).toHaveLength(1);
    expect(profiles[0]).toMatchObject({ id: "main", name: "Principal", equipment: gym });
    expect(activeId).toBe("main");
  });
  it("crear un perfil copia el activo y lo activa; cambiar trae su inventario", () => {
    let s = addProfile(legacy, "Casa", "home");
    expect(s.activeEquipmentProfileId).toBe("home");
    s = editActiveEquipment(s, { ...s.equipment, platesKg: [5, 10], dumbbellsKg: [] });
    s = switchProfile(s, "main");
    expect(s.equipment.platesKg).toEqual(gym.platesKg);
    s = switchProfile(s, "home");
    expect(s.equipment.platesKg).toEqual([5, 10]);
    expect(s.equipment.dumbbellsKg).toEqual([]);
  });
  it("editar el inventario solo cambia el perfil activo", () => {
    const s = editActiveEquipment(addProfile(legacy, "Casa", "home"), { ...gym, machineStepKg: 2.5 });
    expect(s.equipmentProfiles.find((p) => p.id === "home")!.equipment.machineStepKg).toBe(2.5);
    expect(s.equipmentProfiles.find((p) => p.id === "main")!.equipment.machineStepKg).toBe(5);
  });
  it("no se borra el último; borrar el activo pasa al que queda", () => {
    expect(() => removeProfile(legacy, "main")).toThrow();
    const s = removeProfile(addProfile(legacy, "Casa", "home"), "home");
    expect(s.activeEquipmentProfileId).toBe("main");
    expect(s.equipment).toEqual(gym);
  });
  it("renombrar conserva el activo y no acepta nombre vacío", () => {
    const s = renameProfile(legacy, "main", "  ");
    expect(s.equipmentProfiles[0].name).toBe("Principal");
    expect(renameProfile(legacy, "main", "Gym centro").equipmentProfiles[0].name).toBe("Gym centro");
  });
});
