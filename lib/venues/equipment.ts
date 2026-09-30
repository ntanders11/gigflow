export const EQUIPMENT_OPTIONS = [
  { key: "pa", label: "PA / sound system" },
  { key: "engineer", label: "Sound engineer" },
  { key: "mics", label: "Microphones & stands" },
  { key: "monitors", label: "Stage monitors" },
  { key: "di", label: "DI boxes & cables" },
  { key: "lighting", label: "Stage lighting" },
  { key: "drums", label: "Drum kit" },
  { key: "bass_amp", label: "Bass amp" },
  { key: "guitar_amps", label: "Guitar amps" },
  { key: "keys", label: "Keyboard / piano" },
  { key: "stage", label: "Raised stage / riser" },
] as const;

const KNOWN_KEYS = new Set<string>(EQUIPMENT_OPTIONS.map((o) => o.key));

export function equipmentLabel(key: string): string {
  return EQUIPMENT_OPTIONS.find((o) => o.key === key)?.label ?? key;
}

export function sanitizeEquipmentKeys(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((k): k is string => typeof k === "string" && KNOWN_KEYS.has(k));
}
