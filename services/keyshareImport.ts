import {Alert} from 'react-native';
import {CommonActions} from '@react-navigation/native';
import RNFS from 'react-native-fs';
import {safeUnlink} from './rnfsSafe';
import {persistStagedKeyshare} from './walletSetupOrchestrator';
import appConfigRepository, {CONFIG_KEYS} from './repositories/AppConfigRepository';
import LocalCache from './LocalCache';
import {
  completeCeremonyToken,
  newCeremonySessionID,
  releaseCeremonyToken,
  requestImportCeremonyToken,
} from './ceremonyAuth';
import {TssProvider} from './TssProvider';
import {setBackupNudgeActive} from './backupNudge';
import {
  dbg,
  detectKeyshareTssBackend,
  resolveUseLegacyDerivationPaths,
} from '../utils';
import {WalletAlreadyLoadedError} from './walletGuard';

export {WalletAlreadyLoadedError, assertNoExistingWallet} from './walletGuard';

export class InvalidKeyshareError extends Error {
  constructor(message = 'Invalid keyshare') {
    super(message);
    this.name = 'InvalidKeyshareError';
  }
}

export class WrongKeysharePasswordError extends Error {
  constructor(message = 'Wrong password') {
    super(message);
    this.name = 'WrongKeysharePasswordError';
  }
}

export type ParsedKeyshare = {
  pub_key: string;
  created_at?: number | null;
  tss_backend?: unknown;
  ecdsa_local_data?: unknown;
  share_b64?: unknown;
  local_party_key?: string;
  keygen_committee_keys?: string[];
  chain_code_hex?: string;
  nostr_npub?: string | null;
  [key: string]: unknown;
};

/**
 * 3b-6d (F23): read a backup file into the blob string the native
 * import expects. Fixed v2 files hold the ASCII "BW2$..." envelope
 * (written utf8) — pass through verbatim. Legacy files hold raw
 * bytes (written base64-decoded) — re-encode to base64. Empty files
 * (the B1-era iOS silent-empty bug wrote 0-byte v2 "backups") fail
 * here with InvalidKeyshareError, never as a wrong-password.
 */
export async function readBackupBlobFromUri(uri: string): Promise<string> {
  const normalizedUri = uri.startsWith('file://') || uri.startsWith('content://')
    ? uri
    : `file://${uri}`;
  const localFilePath = `${RNFS.DocumentDirectoryPath}/tempKeyshareImport.share`;
  await safeUnlink(localFilePath);
  await RNFS.copyFile(normalizedUri, localFilePath);
  try {
    const text = await RNFS.readFile(localFilePath, 'utf8');
    const trimmed = String(text ?? '').trim();
    if (trimmed.startsWith('BW2$')) {
      await safeUnlink(localFilePath);
      return trimmed;
    }
  } catch {
    // Binary (legacy raw bytes) — fall through to base64.
  }
  const content = await RNFS.readFile(localFilePath, 'base64');
  await safeUnlink(localFilePath);
  if (!content || !String(content).trim()) {
    throw new InvalidKeyshareError('Could not read keyshare file');
  }
  return content;
}

export async function decryptAndValidateKeyshare(
  base64Content: string,
  password: string,
  // 3b-2e B17: owner import ceremony (both-or-neither); absent =
  // wrapper mints a single-call ceremony. Error TEXT mapping
  // preserves B1 semantics (format vs wrong-password).
  ceremonyToken?: string,
  ceremonySessionID?: string,
): Promise<{handle: string; parsed: ParsedKeyshare; legacy: boolean}> {
  // F15b-1: decrypt (B1) + verify (F2) + stage run natively (A6). JS
  // passes the password, receives {handle, metadata, legacy} — the
  // plaintext keyshare never crosses the bridge.
  let raw: string;
  try {
    raw = await TssProvider.importBackupToStagedHandle(
      base64Content,
      password,
      ceremonyToken,
      ceremonySessionID,
    );
  } catch (error) {
    if (!(error instanceof Error)) {
      throw new WrongKeysharePasswordError();
    }
    if (error.message.indexOf('not a recognized backup format') >= 0) {
      throw new InvalidKeyshareError();
    }
    if (error.message.indexOf('wrong password or corrupted backup') >= 0) {
      throw new WrongKeysharePasswordError(
        'Wrong password or corrupted backup',
      );
    }
    throw new WrongKeysharePasswordError();
  }
  let staged: {handle?: unknown; metadata?: unknown; legacy?: unknown};
  try {
    staged = JSON.parse(raw);
  } catch (error) {
    dbg('decryptAndValidateKeyshare: staged parse error', error);
    throw new InvalidKeyshareError();
  }
  if (
    typeof staged !== 'object' ||
    staged === null ||
    typeof staged.handle !== 'string' ||
    !staged.handle ||
    typeof staged.metadata !== 'object' ||
    staged.metadata === null
  ) {
    throw new InvalidKeyshareError();
  }
  const parsed = staged.metadata as ParsedKeyshare;
  if (!parsed.pub_key) {
    throw new InvalidKeyshareError();
  }
  return {handle: staged.handle, parsed, legacy: staged.legacy === true};
}

export type FinalizeKeyshareImportOptions = {
  setActiveNetwork: (network: string) => Promise<void>;
  navigate: (action: ReturnType<typeof CommonActions.reset>) => void;
};

export async function finalizeKeyshareImport(
  handle: string,
  parsed: ParsedKeyshare,
  options: FinalizeKeyshareImportOptions,
  // 3b-2e B18: owner import ceremony (both-or-neither); absent =
  // persist mints its own save ceremony.
  ceremonyToken?: string,
  ceremonySessionID?: string,
): Promise<void> {
  const persistOpts =
    ceremonyToken !== undefined && ceremonySessionID !== undefined
      ? {ceremonyToken, ceremonySessionID}
      : undefined;
  await persistStagedKeyshare(handle, persistOpts);
  await LocalCache.clear();
  appConfigRepository.remove(CONFIG_KEYS.CURRENT_ADDRESS);
  const isLegacyPath = resolveUseLegacyDerivationPaths({
    created_at: parsed.created_at ?? null,
    tss_backend: detectKeyshareTssBackend(parsed),
    local_party_key: parsed.local_party_key ?? '',
    keygen_committee_keys: parsed.keygen_committee_keys ?? [],
    pub_key: parsed.pub_key ?? '',
    chain_code_hex: parsed.chain_code_hex ?? '',
    nostr_npub: parsed.nostr_npub ?? null,
  });
  appConfigRepository.set(
    CONFIG_KEYS.LEGACY_WALLET_DO_NOT_REMIND,
    isLegacyPath ? 'no' : 'yes',
  );
  dbg('=== Keyshare imported: Resetting network to mainnet');
  await options.setActiveNetwork('mainnet');
  options.navigate(
    CommonActions.reset({
      index: 0,
      routes: [{name: 'User Preferences', params: {pendingRestore: true}}],
    }),
  );
}

export async function importKeyshareFromBase64(
  base64Content: string,
  password: string,
  options: FinalizeKeyshareImportOptions,
): Promise<void> {
  // 3b-2e B17/B18: one `import` ceremony covers stage+persist
  // (adjacent, no user action between): mint here, thread the
  // owner pair through both, complete at the end.
  const sessionID = await newCeremonySessionID('import');
  const token = await requestImportCeremonyToken(sessionID);
  try {
    const {handle, parsed, legacy} = await decryptAndValidateKeyshare(
      base64Content,
      password,
      token,
      sessionID,
    );
    await finalizeKeyshareImport(handle, parsed, options, token, sessionID);
    try {
      await completeCeremonyToken(token);
    } catch {
      /* logged in ceremonyAuth; import stands */
    }
    if (legacy) {
      // 3b-6e: silent import — no blocking alert. The persistent
      // "backup recommended" nudge (Wallet home + Settings) carries
      // the re-export reminder until a fresh backup is made.
      dbg('keyshareImport: legacy backup imported, nudge set');
      setBackupNudgeActive();
    }
    return;
  } catch (error) {
    try {
      await releaseCeremonyToken(token);
    } catch {
      /* logged in ceremonyAuth */
    }
    throw error;
  }
}

export function showWalletAlreadyLoadedAlert(
  onOpenSettings?: () => void,
): void {
  const buttons: Array<{text: string; onPress?: () => void; style?: 'cancel'}> =
    [{text: 'OK', style: 'cancel'}];
  if (onOpenSettings) {
    buttons.unshift({text: 'Open Settings', onPress: onOpenSettings});
  }
  Alert.alert(
    'Wallet already set up',
    'A keyshare is already loaded. Delete the wallet keyshare from Settings before importing a new one.',
    buttons,
  );
}

export function showKeyshareImportError(error: unknown): void {
  if (error instanceof WalletAlreadyLoadedError) {
    showWalletAlreadyLoadedAlert();
    return;
  }
  if (error instanceof WrongKeysharePasswordError) {
    Alert.alert('Wrong Password', 'Could not import keyshare');
    return;
  }
  if (error instanceof InvalidKeyshareError) {
    Alert.alert('Error', 'Failed to import the file');
    return;
  }
  Alert.alert('Error', 'Failed to import the file');
}
