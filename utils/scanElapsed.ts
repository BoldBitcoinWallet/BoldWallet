export function formatElapsedScanSeconds(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  if (s < 60) {
    return `${s}s`;
  }
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${rem.toString().padStart(2, '0')}`;
}

/** Wall-clock elapsed. Use this for Android ZXing — JS timers pause behind the capture activity. */
export function elapsedScanSecondsSince(
  startedAtMs: number | null | undefined,
): number {
  if (startedAtMs == null || startedAtMs <= 0) {
    return 0;
  }
  return Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000));
}

export function withElapsedScanLabel(
  label: string,
  elapsedSeconds: number,
): string {
  const elapsed = formatElapsedScanSeconds(elapsedSeconds);
  const trimmed = (label || '').trim();
  if (!trimmed) {
    return `Elapsed ${elapsed}`;
  }
  return `${trimmed} · ${elapsed}`;
}

export type ScanProgressLike = {
  received: number;
  total: number;
  percentage?: number;
};

/** Compact two-line status for the native ZXing overlay (recovered frames + elapsed). */
export function formatAndroidZxingProgressLabel(opts: {
  title?: string | null;
  subtitle?: string | null;
  progress?: ScanProgressLike | null;
  elapsedSeconds: number;
}): string {
  const title = (opts.title || '').trim();
  const subtitle = (opts.subtitle || '').trim();
  const p = opts.progress;
  if (p && p.total > 1) {
    const pct = Math.min(
      100,
      p.percentage ?? Math.round((p.received / p.total) * 100),
    );
    const frames =
      p.received >= p.total
        ? 'Processing…'
        : `${p.received} / ${p.total} (${pct}%)`;
    return withElapsedScanLabel(
      `${title || 'Scanning QR…'}\n${frames}`,
      opts.elapsedSeconds,
    );
  }
  return withElapsedScanLabel(
    subtitle || title || 'Scanning QR…',
    opts.elapsedSeconds,
  );
}
