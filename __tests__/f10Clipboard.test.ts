import fs from 'fs';
import path from 'path';
import {formatKeyshareMetadataForCopy} from '../utils/keyshareDevView';

const DKLS_FIXTURE: Record<string, unknown> = {
  tss_backend: 'dkls23',
  suite: 1,
  pub_key:
    '03a564e4ccc8210102812f4337de203853cb945910e6863b2b5b4b01fd9fbc37b6',
  chain_code_hex: 'aa'.repeat(32),
  local_party_key: 'KeyShare1',
  keygen_committee_keys: ['KeyShare1', 'KeyShare2'],
  share_b64: 'F10SECRET-share-bytes-marker',
  created_at: 1720000000000,
  nostr_npub: 'npub1f10test0000000000000000000000000000000000000000',
  nsec: '6e736563317365637265742d6e7365632d6d61726b6572',
};

const GG18_FIXTURE: Record<string, unknown> = {
  tss_backend: 'gg18',
  pub_key:
    '02b0bd634fabc2d4b3e9e2a7a41048c5f2a0e1d4f7c8a9b0c1d2e3f4a5b6c7d8',
  local_party_key: 'party1',
  ecdsa_local_data: {Alpha: 'F10SECRET-gg18-share-marker'},
};

describe('F10-clipboard: metadata-only copy', () => {
  it('copies npub/pub_key/suite and no secrets (DKLs)', () => {
    const out = formatKeyshareMetadataForCopy(DKLS_FIXTURE);
    const parsed = JSON.parse(out) as Record<string, unknown>;
    expect(parsed.npub).toBe(DKLS_FIXTURE.nostr_npub);
    expect(parsed.pub_key).toBe(DKLS_FIXTURE.pub_key);
    expect(parsed.suite).toBe(1);
    for (const secret of [
      'share_b64',
      'F10SECRET-share-bytes-marker',
      'nsec',
      'nsec1',
      'chain_code_hex',
      'ecdsa_local_data',
    ]) {
      expect(out).not.toContain(secret);
    }
    expect(Object.keys(parsed).sort()).toEqual(
      ['npub', 'pub_key', 'suite'].sort(),
    );
  });

  it('copies pub_key + backend label and no secrets (GG18)', () => {
    const out = formatKeyshareMetadataForCopy(GG18_FIXTURE);
    const parsed = JSON.parse(out) as Record<string, unknown>;
    expect(parsed.pub_key).toBe(GG18_FIXTURE.pub_key);
    expect(parsed.tss_backend).toBe('gg18');
    expect(out).not.toContain('ecdsa_local_data');
    expect(out).not.toContain('F10SECRET-gg18-share-marker');
  });

  it('emits valid JSON for empty input', () => {
    expect(() =>
      JSON.parse(formatKeyshareMetadataForCopy({})),
    ).not.toThrow();
  });
});

describe('F10-clipboard: source guardrails', () => {
  const root = path.join(__dirname, '..');
  const read = (rel: string) =>
    fs.readFileSync(path.join(root, rel), 'utf8');

  it('DiceEntropySheet has no clipboard writes', () => {
    const src = read('components/DiceEntropySheet.tsx');
    expect(src).not.toContain('Clipboard.setString');
    // Paste-INTO-app (getString) is inbound and stays allowed.
    expect(src).toContain('Clipboard.getString');
  });

  it('KeyshareInfoContent never copies pretty-printed full JSON', () => {
    const src = read('components/KeyshareInfoContent.tsx');
    expect(src).not.toContain(
      'Clipboard.setString(prettyPrintKeyshareJson',
    );
    expect(src).toContain('formatKeyshareMetadataForCopy');
  });
});
