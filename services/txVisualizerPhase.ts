export type VisualizerPhase =
  | 'idle'
  | 'signing'
  | 'broadcasting'
  | 'mempool'
  | 'confirmed';

/** Parent details chip is source of truth; do not infer confirmed from a truthy string/number. */
export function isApiTxConfirmed(
  data: {confirmed?: unknown} | null | undefined,
): boolean {
  return data?.confirmed === true;
}

export function phaseFromParentConfirmed(
  parentConfirmed: boolean,
  hasTxid: boolean,
): VisualizerPhase {
  if (parentConfirmed) {
    return 'confirmed';
  }
  return hasTxid ? 'mempool' : 'idle';
}
