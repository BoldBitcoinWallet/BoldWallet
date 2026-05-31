import {Buffer} from 'buffer';
import RNFS from 'react-native-fs';
import {safeUnlink} from './rnfsSafe';
import {isPsbtBytes, readPsbtBase64FromFile} from './psbtIdentity';

export type IncomingFileKind = 'psbt' | 'keyshare' | 'unknown';

export function inferFileKindFromUri(uri: string): IncomingFileKind | null {
  const lower = uri.toLowerCase();
  if (lower.includes('.psbt')) {
    return 'psbt';
  }
  if (lower.includes('.share')) {
    return 'keyshare';
  }
  return null;
}

async function readFilePeekBase64(uri: string): Promise<Buffer> {
  const normalizedUri =
    uri.startsWith('file://') || uri.startsWith('content://')
      ? uri
      : `file://${uri}`;
  const localFilePath = `${RNFS.DocumentDirectoryPath}/tempIncomingPeek.bin`;
  await safeUnlink(localFilePath);
  await RNFS.copyFile(normalizedUri, localFilePath);
  const content = await RNFS.readFile(localFilePath, 'base64');
  await safeUnlink(localFilePath);
  return Buffer.from(content, 'base64');
}

export async function classifyIncomingFile(uri: string): Promise<IncomingFileKind> {
  const hinted = inferFileKindFromUri(uri);
  if (hinted) {
    return hinted;
  }
  try {
    const bytes = await readFilePeekBase64(uri);
    if (bytes.length >= 4 && isPsbtBytes(bytes)) {
      return 'psbt';
    }
  } catch {
    // fall through
  }
  return 'keyshare';
}

export async function readPsbtBase64FromSharedUri(uri: string): Promise<string> {
  const normalizedUri =
    uri.startsWith('file://') || uri.startsWith('content://')
      ? uri
      : `file://${uri}`;
  const localFilePath = `${RNFS.DocumentDirectoryPath}/tempPsbtImport.psbt`;
  await safeUnlink(localFilePath);
  await RNFS.copyFile(normalizedUri, localFilePath);
  const readFile = (path: string, encoding: 'base64' | 'utf8') =>
    RNFS.readFile(path, encoding);
  const filePath = localFilePath.replace('file://', '');
  try {
    return await readPsbtBase64FromFile(readFile, filePath);
  } finally {
    await safeUnlink(localFilePath);
  }
}
