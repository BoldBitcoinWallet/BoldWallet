export const KEYSHARE_SHARED_FILE_EVENT = 'keyshareSharedFile';

export type KeyshareShareModuleType = {
  getInitialSharedKeyshareUri(): Promise<string | null>;
  clearPendingSharedKeyshare(): Promise<void>;
};
