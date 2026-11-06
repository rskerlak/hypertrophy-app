// Perfiles de gimnasio (A4.5): "Principal", "Casa", "Hotel"… cada uno con su
// inventario. `settings.equipment` sigue siendo el inventario ACTIVO (lo leen
// el motor y la sesión); los perfiles guardan copias. Puro y testeable.

import type { Equipment } from "@/domain/types";

export interface EquipmentProfile {
  id: string;
  name: string;
  equipment: Equipment;
}

export interface ProfilesState {
  equipment: Equipment;
  equipmentProfiles?: EquipmentProfile[];
  activeEquipmentProfileId?: string;
}

export const MAIN_PROFILE_ID = "main";

const clone = (e: Equipment): Equipment => JSON.parse(JSON.stringify(e)) as Equipment;

/** Migración: sin perfiles, el inventario actual pasa a ser "Principal". */
export function normalizeProfiles(s: ProfilesState): { profiles: EquipmentProfile[]; activeId: string } {
  const profiles = s.equipmentProfiles?.length
    ? s.equipmentProfiles
    : [{ id: MAIN_PROFILE_ID, name: "Principal", equipment: clone(s.equipment) }];
  const activeId = profiles.some((p) => p.id === s.activeEquipmentProfileId) ? s.activeEquipmentProfileId! : profiles[0].id;
  return { profiles, activeId };
}

/** Guarda el inventario activo dentro de su perfil (tras editarlo en Ajustes). */
function syncActive(s: ProfilesState): EquipmentProfile[] {
  const { profiles, activeId } = normalizeProfiles(s);
  return profiles.map((p) => (p.id === activeId ? { ...p, equipment: clone(s.equipment) } : p));
}

/** Patch de settings al editar el inventario activo. */
export function editActiveEquipment(s: ProfilesState, equipment: Equipment): Required<ProfilesState> {
  const { activeId } = normalizeProfiles(s);
  return { equipment, equipmentProfiles: syncActive({ ...s, equipment }), activeEquipmentProfileId: activeId };
}

/** Patch de settings al cambiar de perfil. */
export function switchProfile(s: ProfilesState, id: string): Required<ProfilesState> {
  const profiles = syncActive(s);
  const target = profiles.find((p) => p.id === id);
  if (!target) throw new Error("Perfil de equipamiento no encontrado.");
  return { equipment: clone(target.equipment), equipmentProfiles: profiles, activeEquipmentProfileId: id };
}

/** Patch de settings al crear un perfil (copia del activo) y pasar a usarlo. */
export function addProfile(s: ProfilesState, name: string, id: string): Required<ProfilesState> {
  const profiles = syncActive(s);
  const p: EquipmentProfile = { id, name: name.trim() || "Nuevo", equipment: clone(s.equipment) };
  return { equipment: clone(p.equipment), equipmentProfiles: [...profiles, p], activeEquipmentProfileId: id };
}

export function renameProfile(s: ProfilesState, id: string, name: string): Required<ProfilesState> {
  const { activeId } = normalizeProfiles(s);
  const profiles = syncActive(s).map((p) => (p.id === id ? { ...p, name: name.trim() || p.name } : p));
  return { equipment: s.equipment, equipmentProfiles: profiles, activeEquipmentProfileId: activeId };
}

/** Borra un perfil (nunca el último). Si era el activo, pasa al primero que quede. */
export function removeProfile(s: ProfilesState, id: string): Required<ProfilesState> {
  const { activeId } = normalizeProfiles(s);
  const profiles = syncActive(s);
  if (profiles.length <= 1) throw new Error("Tiene que quedar al menos un perfil.");
  const rest = profiles.filter((p) => p.id !== id);
  if (id !== activeId) return { equipment: s.equipment, equipmentProfiles: rest, activeEquipmentProfileId: activeId };
  return { equipment: clone(rest[0].equipment), equipmentProfiles: rest, activeEquipmentProfileId: rest[0].id };
}
