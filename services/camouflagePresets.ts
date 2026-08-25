/**
 * Android camouflage launcher presets.
 * Labels are compile-time on activity-alias; keep ASCII and ≤12 chars.
 * Preview images match the home-screen launcher icons (mipmap / adaptive vectors).
 */

import type {ImageSourcePropType} from 'react-native';

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
  /** Exact launcher artwork shown in settings and on the lock screen when camouflaged. */
  preview: ImageSourcePropType;
};

export const CAMOUFLAGE_PRESETS: CamouflagePreset[] = [
  {
    id: 'default',
    label: 'Bold Wallet',
    preview: require('../assets/camouflage/default.png'),
  },
  {
    id: 'quickcalc',
    label: 'QuickCalc',
    preview: require('../assets/camouflage/quickcalc.png'),
  },
  {
    id: 'notes',
    label: 'Notes',
    preview: require('../assets/camouflage/notes.png'),
  },
  {
    id: 'weather',
    label: 'Weather',
    preview: require('../assets/camouflage/weather.png'),
  },
  {
    id: 'files',
    label: 'Files',
    preview: require('../assets/camouflage/files.png'),
  },
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

/** True when a non-Bold launcher identity is selected. */
export function isCamouflageActive(
  raw: string | null | undefined,
): boolean {
  return normalizeCamouflagePresetId(raw) !== 'default';
}

const DEFAULT_UNLOCK_PROMPT = {
  promptMessage: 'Authenticate to access your wallet',
  fallbackPromptMessage: 'Use your device passcode to unlock',
} as const;

/** System biometric sheet copy: no wallet wording when camouflage is on. */
export function camouflageUnlockPrompt(
  raw: string | null | undefined,
): {promptMessage: string; fallbackPromptMessage: string} {
  const id = normalizeCamouflagePresetId(raw);
  if (id === 'default') {
    return {
      promptMessage: DEFAULT_UNLOCK_PROMPT.promptMessage,
      fallbackPromptMessage: DEFAULT_UNLOCK_PROMPT.fallbackPromptMessage,
    };
  }
  const label = camouflagePresetById(id).label;
  return {
    promptMessage: `Unlock ${label}`,
    fallbackPromptMessage: 'Use your device passcode',
  };
}
