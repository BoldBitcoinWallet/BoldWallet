import RNFS from 'react-native-fs';
import {BBMTLibNativeModule} from '../native_modules';
import {
  getTssBackendDisplayLabel,
  resolveTssBackendForKeygen,
  type SetupMode,
  type TssBackend,
} from './tssBackend';
import {TssProvider} from './TssProvider';
import {
  getPrepareModalCopy,
  type PrepareModalCopy,
} from './walletSetupUi';

export type {SetupMode, PrepareModalCopy};
export {getPrepareModalCopy, getWalletSetupKeygenModalCopy} from './walletSetupUi';

export {getKeygenStepCount} from './mpcProgress';

async function deletePreparamsFile(ppmFile: string): Promise<void> {
  try {
    const exists = await RNFS.exists(ppmFile);
    if (exists) {
      await RNFS.unlink(ppmFile);
    }
  } catch {
    // ignore missing file
  }
}

/**
 * Prepare device before MPC keygen: DKLs23 smoke test or GG18 preparams.
 */
export async function prepareDeviceForKeygen(
  ppmFile: string,
  timeoutMinutes: number,
  setupMode?: SetupMode,
  skipDeletePpm = __DEV__,
  explicitBackend?: TssBackend | null,
): Promise<TssBackend> {
  const backend = await resolveTssBackendForKeygen(setupMode, explicitBackend);
  if (!skipDeletePpm) {
    await deletePreparamsFile(ppmFile);
  }
  if (backend === 'dkls23') {
    await TssProvider.helloDkg(setupMode, backend);
  } else {
    await BBMTLibNativeModule.preparams(ppmFile, String(timeoutMinutes));
  }
  return backend;
}

export {getTssBackendDisplayLabel};
