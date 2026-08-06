export function canonicalizeSigningNpubsCSV(partiesNpubsCSV: string): string {
  const canonical = String(partiesNpubsCSV || '')
    .split(',')
    .map(n => n.trim())
    .filter(Boolean)
    .sort();
  return canonical.join(',');
}

export function deriveDklsSendTxIntentKey(input: {
  signingNpubsCSV: string;
  amountSats: string | number;
  toAddress: string;
}): string {
  const signingNpubsSorted = canonicalizeSigningNpubsCSV(input.signingNpubsCSV);
  const amount = Number(input.amountSats);
  const normalizedAmount = Number.isFinite(amount) ? amount : 0;
  const toAddress = String(input.toAddress || '').trim();
  return `${signingNpubsSorted},${normalizedAmount},${toAddress}`;
}

export function deriveDklsPsbtIntentKey(input: {
  signingNpubsCSV: string;
  psbtIdentity: string;
}): string {
  const signingNpubsSorted = canonicalizeSigningNpubsCSV(input.signingNpubsCSV);
  const identity = String(input.psbtIdentity || '').trim();
  return `${signingNpubsSorted},${identity}`;
}
