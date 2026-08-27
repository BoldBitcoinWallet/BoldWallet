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

/** Images and docs WhatsApp may share as any MIME — do not open the keyshare password modal. */
export function looksLikeNonWalletBytes(bytes: Buffer): boolean {
  if (bytes.length < 4) {
    return false;
  }
  const b0 = bytes[0];
  const b1 = bytes[1];
  const b2 = bytes[2];
  const b3 = bytes[3];
  // JPEG
  if (b0 === 0xff && b1 === 0xd8 && b2 === 0xff) {
    return true;
  }
  // PNG
  if (b0 === 0x89 && b1 === 0x50 && b2 === 0x4e && b3 === 0x47) {
    return true;
  }
  // GIF
  if (b0 === 0x47 && b1 === 0x49 && b2 === 0x46) {
    return true;
  }
  // PDF
  if (b0 === 0x25 && b1 === 0x50 && b2 === 0x44 && b3 === 0x46) {
    return true;
  }
  // ZIP / APK / many Office docs
  if (b0 === 0x50 && b1 === 0x4b && (b2 === 0x03 || b2 === 0x05 || b2 === 0x07)) {
    return true;
  }
  // WebP / WAV RIFF
  if (bytes.length >= 12 && b0 === 0x52 && b1 === 0x49 && b2 === 0x46 && b3 === 0x46) {
    return true;
  }
  // MP4 / MOV ftyp
  if (
    bytes.length >= 8 &&
    bytes[4] === 0x66 &&
    bytes[5] === 0x74 &&
    bytes[6] === 0x79 &&
    bytes[7] === 0x70
  ) {
    return true;
  }
  return false;
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
  try {
    const bytes = await readFilePeekBase64(uri);
    if (bytes.length >= 4 && isPsbtBytes(bytes)) {
      return 'psbt';
    }
    if (looksLikeNonWalletBytes(bytes)) {
      return 'unknown';
    }
  } catch {
    // fall through to URI hint
  }
  const hinted = inferFileKindFromUri(uri);
  if (hinted) {
    return hinted;
  }
  // Chat content:// URIs often have no .share in the path. Opaque non-media
  // bytes from SEND/VIEW are treated as a keyshare so the import modal opens.
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
