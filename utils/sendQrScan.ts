/**
 * Send-bitcoin QR scan decisions shared by Wallet Home (iOS + Android).
 * Android ZXing emits junk frames; those must not abort an in-progress UR scan.
 */
export function isUrFrame(qrData: string): boolean {
  return qrData.trim().toLowerCase().startsWith('ur:');
}

/** Ignore non-UR camera noise while assembling an animated send QR. */
export function shouldIgnoreNonUrDuringSendScan(
  qrData: string,
  collectingUr: boolean,
): boolean {
  return collectingUr && !isUrFrame(qrData);
}
