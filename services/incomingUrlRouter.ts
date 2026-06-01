const UNIVERSAL_PAY_HOSTS = new Set(['boldbitcoinwallet.com', 'www.boldbitcoinwallet.com']);

export type ParsedIncomingUrl =
  | {kind: 'bitcoin-pay'; address: string; amountBtc?: string}
  | {kind: 'universal-pay'; address: string; amountBtc?: string}
  | {kind: 'boldwallet-pay'; address: string; amountBtc?: string}
  | {kind: 'boldwallet-import-keyshare'}
  | {kind: 'unknown'};

function parsePayQueryParams(params: URLSearchParams): {
  address: string;
  amountBtc?: string;
} | null {
  const address =
    params.get('address')?.trim() || params.get('bitcoin')?.trim() || '';
  if (!address) {
    return null;
  }
  return {address, amountBtc: parseQueryAmount(params)};
}

/** Build a custom-scheme pay link that opens Bold Wallet from an in-browser /pay page. */
export function buildBoldwalletPayUri(
  address: string,
  amountBtc?: string,
  label?: string,
): string {
  const params = new URLSearchParams();
  params.set('address', address.trim());
  if (amountBtc?.trim()) {
    params.set('amount', amountBtc.trim());
  }
  if (label?.trim()) {
    params.set('label', label.trim());
  }
  return `boldwallet://pay?${params.toString()}`;
}

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

    const isPay =
      host === 'pay' ||
      path === '/pay' ||
      path === 'pay' ||
      legacyPath === 'pay';
    if (isPay) {
      const payParams = parsePayQueryParams(parsed.searchParams);
      if (payParams) {
        return {kind: 'boldwallet-pay', ...payParams};
      }
      return {kind: 'unknown'};
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

export function parseUniversalPayLink(url: string): ParsedIncomingUrl {
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== 'https:') {
      return {kind: 'unknown'};
    }
    if (!UNIVERSAL_PAY_HOSTS.has(parsed.hostname.toLowerCase())) {
      return {kind: 'unknown'};
    }
    if (!parsed.pathname.startsWith('/pay')) {
      return {kind: 'unknown'};
    }
    const payParams = parsePayQueryParams(parsed.searchParams);
    if (!payParams) {
      return {kind: 'unknown'};
    }
    return {kind: 'universal-pay', ...payParams};
  } catch {
    return {kind: 'unknown'};
  }
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
  if (/^https:/i.test(trimmed)) {
    return parseUniversalPayLink(trimmed);
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
  if (/^https:/i.test(trimmed)) {
    const parsed = parseUniversalPayLink(trimmed);
    if (parsed.kind === 'universal-pay') {
      return parsed.address;
    }
  }
  if (trimmed.startsWith('bitcoin:')) {
    return trimmed.replace(/^bitcoin:/i, '').split('?')[0].trim();
  }
  return trimmed;
}
