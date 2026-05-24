import {BBMTLibNativeModule} from '../native_modules';
import {safeUnlink} from './rnfsSafe';
import {
  getTssBackendDisplayLabel,
  resolveTssBackendForKeygen,
  type SetupMode,
  type TssBackend,
} from './tssBackend';
import {TssProvider} from './TssProvider';
import {type PrepareModalCopy} from './walletSetupUi';

export type {SetupMode, PrepareModalCopy};
export {
  getPrepareModalCopy,
  getWalletSetupKeygenModalCopy,
  getWalletSetupPrepCardCopy,
} from './walletSetupUi';

export {getKeygenStepCount} from './mpcProgress';

async function deletePreparamsFile(ppmFile: string): Promise<void> {
  await safeUnlink(ppmFile);
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
