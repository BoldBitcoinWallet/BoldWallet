import RNFS from 'react-native-fs';
import {BBMTLibNativeModule} from '../native_modules';
import {
  getTssBackendDisplayLabel,
  resolveTssBackendForKeygen,
  type SetupMode,
  type TssBackend,
} from './tssBackend';
import {TssProvider} from './TssProvider';

export type {SetupMode};

export type PrepareModalCopy = {
  title: string;
  subtitle: string;
  statusLine: string;
  successLine: string;
};

export function getPrepareModalCopy(backend: TssBackend): PrepareModalCopy {
  if (backend === 'dkls23') {
    return {
      title: 'Preparing wallet',
      subtitle: 'Verifying the DKLs23 MPC stack on this device.',
      statusLine: 'Verifying DKLs23 readiness',
      successLine: 'Device preparation done',
    };
  }
  return {
    title: 'Preparing Device',
    subtitle: 'Could take a while, given device specs.',
    statusLine: 'Computing cryptographic params',
    successLine: 'Device Preparation Done',
  };
}

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
): Promise<TssBackend> {
  const backend = await resolveTssBackendForKeygen(setupMode);
  if (!skipDeletePpm) {
    await deletePreparamsFile(ppmFile);
  }
  if (backend === 'dkls23') {
    await TssProvider.helloDkg(setupMode);
  } else {
    await BBMTLibNativeModule.preparams(ppmFile, String(timeoutMinutes));
  }
  return backend;
}

export {getTssBackendDisplayLabel};
