import {Alert} from 'react-native';
import {CommonActions} from '@react-navigation/native';
import RNFS from 'react-native-fs';
import {safeUnlink} from './rnfsSafe';
import {persistWalletKeyshare} from './walletSetupOrchestrator';
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
  constructor() {
    super('Wrong password');
    this.name = 'WrongKeysharePasswordError';
  }
}

export type ParsedKeyshare = {
  pub_key: string;
  created_at?: number | null;
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
): Promise<{decryptedKeyshare: string; parsed: ParsedKeyshare}> {
  const decryptedKeyshare = await BBMTLibNativeModule.aesDecrypt(
    base64Content,
    await BBMTLibNativeModule.sha256(password),
  );
  if (decryptedKeyshare.indexOf('pub_key') < 0) {
    throw new WrongKeysharePasswordError();
  }
  let parsed: ParsedKeyshare;
  try {
    parsed = JSON.parse(decryptedKeyshare);
    if (!parsed.pub_key) {
      throw new InvalidKeyshareError();
    }
  } catch (error) {
    dbg('decryptAndValidateKeyshare: parse error', error);
    throw new InvalidKeyshareError();
  }
  return {decryptedKeyshare, parsed};
}

export type FinalizeKeyshareImportOptions = {
  setActiveNetwork: (network: string) => Promise<void>;
  navigate: (action: ReturnType<typeof CommonActions.reset>) => void;
};

export async function finalizeKeyshareImport(
  decryptedKeyshare: string,
  parsed: ParsedKeyshare,
  options: FinalizeKeyshareImportOptions,
): Promise<void> {
  await persistWalletKeyshare(decryptedKeyshare);
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
  const {decryptedKeyshare, parsed} = await decryptAndValidateKeyshare(
    base64Content,
    password,
  );
  await finalizeKeyshareImport(decryptedKeyshare, parsed, options);
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
