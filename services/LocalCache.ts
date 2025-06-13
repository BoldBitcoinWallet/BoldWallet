import RNFS from 'react-native-fs';
import {dbg} from '../utils';

class LocalCache {
  static baseDir = `${RNFS.DocumentDirectoryPath}/.cache`;

  // Ensure .cache directory exists
  static async ensureCacheDir() {
    try {
      const exists = await RNFS.exists(this.baseDir);
      if (!exists) {
        await RNFS.mkdir(this.baseDir, {
          NSURLIsExcludedFromBackupKey: true, // iOS only
        });
      }
    } catch (err) {
      dbg('LocalCache ensureCacheDir error:', err);
      // Try to create parent directory if it doesn't exist
      try {
        const parentDir = this.baseDir.substring(
          0,
          this.baseDir.lastIndexOf('/'),
        );
        await RNFS.mkdir(parentDir);
        await RNFS.mkdir(this.baseDir);
      } catch (parentErr) {
        dbg('LocalCache ensureCacheDir parent directory error:', parentErr);
        throw err; // Re-throw original error if we can't create parent
      }
    }
  }

  // Encode key to hex for safe filenames
  static hex(key: string) {
    return Array.from(new TextEncoder().encode(key))
      .map(byte => byte.toString(16).padStart(2, '0'))
      .join('');
  }

  // Always ensure dir exists before returning path
  static async getFilePath(key: string): Promise<string> {
    try {
      await this.ensureCacheDir();
      return `${this.baseDir}/${this.hex(key)}.txt`;
    } catch (err) {
      dbg('LocalCache getFilePath error:', err);
      throw err; // Re-throw to handle in calling methods
    }
  }

  static async setItem(key: string, value: string) {
    try {
      const path = await this.getFilePath(key);
      await RNFS.writeFile(path, value, 'utf8');
    } catch (err) {
      dbg(`LocalCache setItem error [${key}]:`, err);
    }
  }

  static async getItem(key: string) {
    try {
      const path = await this.getFilePath(key);
      const exists = await RNFS.exists(path);
      if (!exists) {
        return null;
      }
      return await RNFS.readFile(path, 'utf8');
    } catch (err) {
      dbg(`LocalCache getItem error [${key}]:`, err);
      return null;
    }
  }

  static async removeItem(key: string) {
    try {
      const path = await this.getFilePath(key);
      const exists = await RNFS.exists(path);
      if (exists) {
        await RNFS.unlink(path);
      }
    } catch (err) {
      dbg(`LocalCache removeItem error [${key}]:`, err);
    }
  }

  static async clear() {
    try {
      const exists = await RNFS.exists(this.baseDir);
      if (exists) {
        await RNFS.unlink(this.baseDir);
      }
      await RNFS.mkdir(this.baseDir); // Recreate
    } catch (err) {
      dbg('LocalCache clear error:', err);
    }
  }
}

export default LocalCache;
