import {Alert} from 'react-native';
import {CommonActions} from '@react-navigation/native';
import RNFS from 'react-native-fs';
import {safeUnlink} from './rnfsSafe';
import {persistStagedKeyshare} from './walletSetupOrchestrator';
import appConfigRepository, {CONFIG_KEYS} from './repositories/AppConfigRepository';
import LocalCache from './LocalCache';
import {BBMTLibNativeModule} from '../native_modules';
import {
  dbg,
  detectKeyshareTssBackend,
  resolveUseLegacyDerivationPaths,
} from '../utils';
import {
  assertNoExistingWallet,
  WalletAlreadyLoadedError,
} from './walletGuard';

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

export async function readKeyshareBase64FromUri(uri: string): Promise<string> {
  const normalizedUri = uri.startsWith('file://') || uri.startsWith('content://')
    ? uri
    : `file://${uri}`;
  const localFilePath = `${RNFS.DocumentDirectoryPath}/tempKeyshareImport.share`;
  await safeUnlink(localFilePath);
  await RNFS.copyFile(normalizedUri, localFilePath);
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
): Promise<{handle: string; parsed: ParsedKeyshare; legacy: boolean}> {
  // F15b-1: decrypt (B1) + verify (F2) + stage run natively (A6). JS
  // passes the password, receives {handle, metadata, legacy} — the
  // plaintext keyshare never crosses the bridge. Error TEXT mapping
  // preserves B1 semantics (format vs wrong-password).
  let raw: string;
  try {
    raw = await BBMTLibNativeModule.importBackupToStagedHandle(
      base64Content,
      password,
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
): Promise<void> {
  await persistStagedKeyshare(handle);
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
  const {handle, parsed, legacy} = await decryptAndValidateKeyshare(
    base64Content,
    password,
  );
  await finalizeKeyshareImport(handle, parsed, options);
  if (legacy) {
    Alert.alert(
      'Legacy Backup Imported',
      'This backup uses an older, less secure encryption format. ' +
        'Please create a new backup from Settings to re-encrypt it with the current format.',
    );
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
