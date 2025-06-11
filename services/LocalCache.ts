import RNFS from 'react-native-fs';

class LocalCache {
  static baseDir = `${RNFS.DocumentDirectoryPath}/.cache`;

  static hex(str: string) {
    return Array.from(new TextEncoder().encode(str))
      .map(byte => byte.toString(16).padStart(2, '0'))
      .join('');
  }

  static getFilePath(key: string) {
    return `${this.baseDir}/${this.hex(key)}.txt`;
  }

  static async setItem(key: string, value: string) {
    try {
      await RNFS.mkdir(this.baseDir);
      const path = this.getFilePath(key);
      await RNFS.writeFile(path, value, 'utf8');
    } catch (err) {
      console.error(`LocalCache setItem error [${key}]:`, err);
    }
  }

  static async getItem(key: string) {
    try {
      const path = this.getFilePath(key);
      const exists = await RNFS.exists(path);
      return exists ? await RNFS.readFile(path, 'utf8') : null;
    } catch (err) {
      console.error(`LocalCache getItem error [${key}]:`, err);
      return null;
    }
  }

  static async removeItem(key: string) {
    try {
      const path = this.getFilePath(key);
      const exists = await RNFS.exists(path);
      if (exists) {
        await RNFS.unlink(path);
      }
    } catch (err) {
      console.error(`LocalCache removeItem error [${key}]:`, err);
    }
  }

  static async clear() {
    try {
      const exists = await RNFS.exists(this.baseDir);
      if (exists) {
        await RNFS.unlink(this.baseDir);
      }
      await RNFS.mkdir(this.baseDir);
    } catch (err) {
      console.error('LocalCache clear error:', err);
    }
  }
}

export default LocalCache;
