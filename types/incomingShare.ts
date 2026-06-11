export const INCOMING_SHARED_FILE_EVENT = 'keyshareSharedFile';

export type IncomingShareModuleType = {
  getInitialSharedKeyshareUri(): Promise<string | null>;
  clearPendingSharedKeyshare(): Promise<void>;
};

// Legacy export name used by phase-1 native bridge.
export const KEYSHARE_SHARED_FILE_EVENT = INCOMING_SHARED_FILE_EVENT;
