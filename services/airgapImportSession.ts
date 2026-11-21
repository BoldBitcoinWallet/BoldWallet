/**
 * The airgap camera is a separate Android activity, so the app looks
 * backgrounded. Auto-lock must not replace a finished import with the
 * lock screen.
 */
let holders = 0;

export function beginAirgapImportSession(): void {
  holders += 1;
}

export function endAirgapImportSession(): void {
  holders = Math.max(0, holders - 1);
}

export function isAirgapImportSessionActive(): boolean {
  return holders > 0;
}

export function resetAirgapImportSessionForTests(): void {
  holders = 0;
}
