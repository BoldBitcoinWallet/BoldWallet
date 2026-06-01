export type ParsedIncomingUrl =
  | {kind: 'bitcoin-pay'; address: string; amountBtc?: string}
  | {kind: 'boldwallet-import-keyshare'}
  | {kind: 'unknown'};

function parseQueryAmount(params: URLSearchParams): string | undefined {
  const amount = params.get('amount');
  return amount && amount.trim() ? amount.trim() : undefined;
}

export function parseBitcoinUri(url: string): ParsedIncomingUrl {
  const trimmed = url.trim();
  if (!/^bitcoin:/i.test(trimmed)) {
    return {kind: 'unknown'};
  }
  const withoutScheme = trimmed.replace(/^bitcoin:/i, '');
  const [addressPart, queryPart = ''] = withoutScheme.split('?');
  const address = decodeURIComponent(addressPart.trim());
  if (!address) {
    return {kind: 'unknown'};
  }
  const params = new URLSearchParams(queryPart);
  const amountBtc = parseQueryAmount(params);
  return {kind: 'bitcoin-pay', address, amountBtc};
}

export function parseBoldwalletUri(url: string): ParsedIncomingUrl {
  const trimmed = url.trim();
  if (!/^boldwallet:/i.test(trimmed)) {
    return {kind: 'unknown'};
  }
  const href = /^boldwallet:\/\//i.test(trimmed)
    ? trimmed
    : trimmed.replace(/^boldwallet:/i, 'boldwallet://');
  try {
    const parsed = new URL(href);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase().replace(/\/$/, '') || '';
    const legacyPath = trimmed
      .replace(/^boldwallet:\/\/?/i, '')
      .split('?')[0]
      .toLowerCase()
      .replace(/\/$/, '');

    if (
      host === 'import-keyshare' ||
      path === '/import-keyshare' ||
      path === 'import-keyshare' ||
      legacyPath === 'import-keyshare'
    ) {
      return {kind: 'boldwallet-import-keyshare'};
    }
  } catch {
    // fall through to legacy parsing
  }

  const legacyPath = trimmed
    .replace(/^boldwallet:\/\/?/i, '')
    .split('?')[0]
    .toLowerCase()
    .replace(/\/$/, '');
  if (legacyPath === 'import-keyshare') {
    return {kind: 'boldwallet-import-keyshare'};
  }
  return {kind: 'unknown'};
}

export function parseIncomingUrl(url: string): ParsedIncomingUrl {
  const trimmed = url.trim();
  if (!trimmed) {
    return {kind: 'unknown'};
  }
  if (/^bitcoin:/i.test(trimmed)) {
    return parseBitcoinUri(trimmed);
  }
  if (/^boldwallet:/i.test(trimmed)) {
    return parseBoldwalletUri(trimmed);
  }
  return {kind: 'unknown'};
}

export function extractBitcoinAddressFromPaymentInput(
  input: string,
): string | null {
  const trimmed = input.trim();
  if (/^bitcoin:/i.test(trimmed)) {
    const parsed = parseBitcoinUri(trimmed);
    if (parsed.kind === 'bitcoin-pay') {
      return parsed.address;
    }
  }
  if (trimmed.startsWith('bitcoin:')) {
    return trimmed.replace(/^bitcoin:/i, '').split('?')[0].trim();
  }
  return trimmed;
}
