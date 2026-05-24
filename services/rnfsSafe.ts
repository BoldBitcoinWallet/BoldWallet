import RNFS from 'react-native-fs';

/**
 * Best-effort file delete. Never rejects when the file is already gone
 * (react-native-fs unlink throws if the path does not exist).
 */
export async function safeUnlink(filePath: string): Promise<void> {
  if (await RNFS.exists(filePath)) {
    await RNFS.unlink(filePath).catch(() => {});
  }
  return Promise.resolve();
}
