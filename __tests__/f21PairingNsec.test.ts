/**
 * F21: pairing nsec must not outlive finalize in JS state.
 * Source guardrail (screen-level behavior, repo precedent):
 * ensureNostrKeyshareStored — the single choke point both
 * success paths share — drops both JS references after the
 * persisted flag is set. Honesty note: JS strings are
 * immutable, so this dereferences (GC-reclaimable) rather
 * than wiping heap bytes.
 */
import * as fs from 'fs';
import * as path from 'path';

const src = fs.readFileSync(
  path.join(__dirname, '..', 'screens', 'MobileNostrPairing.tsx'),
  'utf8',
);

function finalizeBody(): string {
  const start = src.indexOf('const ensureNostrKeyshareStored');
  const end = src.indexOf('const commitNostrWalletSetup');
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return src.slice(start, end);
}

describe('F21 pairing-nsec JS retention', () => {
  test('localNsec state is cleared after persist succeeds', () => {
    const body = finalizeBody();
    expect(body).toContain('keysharePersistedRef.current = true');
    const cleared = body.indexOf("setLocalNsec('')");
    expect(cleared).toBeGreaterThan(-1);
    // Clear happens after the persisted flag, inside the same block.
    expect(cleared).toBeGreaterThan(
      body.indexOf('keysharePersistedRef.current = true'),
    );
  });

  test('pending ref partyNsec is nulled after persist succeeds', () => {
    const body = finalizeBody();
    expect(body).toContain('partyNsec: undefined');
  });

  test('signing takes no nsec (nothing to retain it for)', () => {
    // nostrMpcSignPSBT call site passes relays/npubs/psbt only.
    const callIdx = src.indexOf('TssProvider.nostrMpcSignPSBT(');
    expect(callIdx).toBeGreaterThan(-1);
    const callEnd = src.indexOf('.then(', callIdx);
    const callText = src.slice(callIdx, callEnd);
    expect(callText).not.toContain('Nsec');
    expect(callText).not.toContain('nsec');
  });
});
