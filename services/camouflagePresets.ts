/**
 * Android camouflage launcher presets.
 * Labels are compile-time on activity-alias; keep ASCII and ≤12 chars.
 */

export const CAMOUFLAGE_LABEL_MAX_LEN = 12;

export type CamouflagePresetId =
  | 'default'
  | 'quickcalc'
  | 'notes'
  | 'weather'
  | 'files';

export type CamouflagePreset = {
  id: CamouflagePresetId;
  label: string;
  /** Tile color in settings (not the Play listing icon). */
  swatch: string;
  glyph: string;
};

export const CAMOUFLAGE_PRESETS: CamouflagePreset[] = [
  {id: 'default', label: 'Bold Wallet', swatch: '#1A2B3C', glyph: 'B'},
  {id: 'quickcalc', label: 'QuickCalc', swatch: '#3D3D3D', glyph: '='},
  {id: 'notes', label: 'Notes', swatch: '#C4B8A5', glyph: 'N'},
  {id: 'weather', label: 'Weather', swatch: '#4BA3C7', glyph: 'W'},
  {id: 'files', label: 'Files', swatch: '#F5C542', glyph: 'F'},
];

const VALID_IDS = new Set<string>(CAMOUFLAGE_PRESETS.map(p => p.id));

export function isValidCamouflageLabel(label: string): boolean {
  return (
    label.length > 0 &&
    label.length <= CAMOUFLAGE_LABEL_MAX_LEN &&
    /^[A-Za-z0-9 ]+$/.test(label)
  );
}

/** Legacy EncryptedStorage value `alternative` maps to QuickCalc. */
export function normalizeCamouflagePresetId(
  raw: string | null | undefined,
): CamouflagePresetId {
  if (raw === 'alternative' || raw === 'calc') {
    return 'quickcalc';
  }
  if (raw && VALID_IDS.has(raw)) {
    return raw as CamouflagePresetId;
  }
  return 'default';
}

export function camouflagePresetById(
  id: CamouflagePresetId,
): CamouflagePreset {
  return CAMOUFLAGE_PRESETS.find(p => p.id === id) ?? CAMOUFLAGE_PRESETS[0];
}
