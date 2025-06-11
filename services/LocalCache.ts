import RNFS from 'react-native-fs';

class LocalCache {
  static baseDir = RNFS.DocumentDirectoryPath;

  static hex(key: string) {
    return Array.from(new TextEncoder().encode(key))
      .map(byte => byte.toString(16).padStart(2, '0'))
      .join('');
  }

  static getFilePath(key: string) {
    return `${this.baseDir}/${LocalCache.hex(key)}.txt`;
  }

  static async setItem(key: string, value: string) {
    const path = this.getFilePath(LocalCache.hex(key));
    try {
      await RNFS.writeFile(path, value, 'utf8');
    } catch (err) {
      console.error(`LocalCache setItem error [${key}]:`, err);
    }
  }

  static async getItem(key: string) {
    const path = this.getFilePath(LocalCache.hex(key));
    try {
      const exists = await RNFS.exists(path);
      if (!exists) {
        return null;
      }
      return await RNFS.readFile(path, 'utf8');
    } catch (err) {
      console.error(`LocalCache getItem error [${key}]:`, err);
      return null;
    }
  }

  static async removeItem(key: string) {
    const path = this.getFilePath(LocalCache.hex(key));
    try {
      const exists = await RNFS.exists(path);
      if (exists) {
        await RNFS.unlink(path);
      }
    } catch (err) {
      console.error(`LocalCache removeItem error [${key}]:`, err);
    }
  }
}

export default LocalCache;
