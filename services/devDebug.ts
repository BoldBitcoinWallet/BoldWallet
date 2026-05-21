import EncryptedStorage from 'react-native-encrypted-storage';

/** True when Wallet Settings developer mode is enabled (7× build number tap). */
export async function isDevDebugEnabled(): Promise<boolean> {
  try {
    const raw = await EncryptedStorage.getItem('devDebugEnabled');
    return raw === 'true';
  } catch {
    return false;
  }
}
