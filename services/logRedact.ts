/**
 * Log redaction guard (Spec v2.1 leak hardening).
 * NEVER log: canonical dice strings, raw rolls, final chaincode, xpubs.
 * Pairing QR, handshake, and Nostr events must not carry dice rolls or chaincode.
 * An 8-character commitment prefix is safe to show on this phone.
 */
const HEX64_RE = /^[0-9a-f]{64}$/i;

export function redactForLog(value: unknown): string {
  if (value == null) return '<nil>';
  const s = String(value);
  if (s.startsWith('BOLD-DICE-v1|')) return '<dice-canonical-redacted>';
  if (s.startsWith('BOLD-DICE-COMMIT-v1')) return '<dice-commit-domain-redacted>';
  if (s.startsWith('BOLD-DICE-CHAINCODE-v1')) return '<dice-chaincode-domain-redacted>';
  if (HEX64_RE.test(s.trim())) return `<hex64:${s.trim().slice(0, 8)}…redacted>`;
  if (s.startsWith('xpub') || s.startsWith('xprv')) return '<xkey-redacted>';
  if (/wpkh\(|sh\(|pkh\(/i.test(s)) return '<descriptor-redacted>';
  // Long hex blobs (chaincode/xpub fragments) — keep prefix only.
  if (/^[0-9a-fA-F]{48,}$/.test(s.trim())) {
    return `<hexblob:${s.trim().slice(0, 8)}…redacted>`;
  }
  return s.length > 96 ? `${s.slice(0, 48)}…<truncated>` : s;
}

export function commitmentPrefixForDisplay(commitHex: string): string {
  const t = String(commitHex || '').trim().toLowerCase();
  if (!HEX64_RE.test(t)) return '<invalid-commit>';
  return `${t.slice(0, 8)}…${t.slice(-4)}`;
}

export function isCommitmentHex(s: string): boolean {
  return HEX64_RE.test(String(s || '').trim());
}

/** Leak guard: handshake must carry commitments only, never canonical dice. */
export function assertCommitmentsOnlyPayload(payload: string): boolean {
  if (!payload) return true;
  if (payload.includes('BOLD-DICE-v1|')) return false;
  return true;
}
