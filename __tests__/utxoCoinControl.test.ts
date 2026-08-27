import {
  canPersistUtxoTag,
  filterTagSuggestions,
  filterUtxosByOutpoints,
  formatUtxoCoinId,
  formatUtxoPickerLabel,
  isValidUtxoTag,
  outpointKey,
  parseOutpointKey,
  sanitizeUtxoTag,
  sanitizeUtxoTagDraft,
  selectionFeeKey,
  sortCoinControlUtxos,
  spendableSats,
  sumSelectedSats,
  UTXO_TAG_MAX_LEN,
  UTXO_TAG_MIN_LEN,
  type CoinControlUtxo,
} from '../services/utxoCoinControl';

const TXID = 'a1b2c3d4e5f678901234567890abcdef1234567890abcdef1234567890abcd';

describe('utxoCoinControl', () => {
  test('outpointKey and parseOutpointKey round-trip', () => {
    const key = outpointKey(TXID, 3);
    expect(key).toBe(`${TXID}:3`);
    expect(parseOutpointKey(key)).toEqual({txid: TXID, vout: 3});
    expect(parseOutpointKey('bad')).toBeNull();
    expect(parseOutpointKey(':0')).toBeNull();
  });

  test('formatUtxoCoinId uses first4~last4@vout', () => {
    expect(formatUtxoCoinId(TXID, 0)).toBe('a1b2~abcd@0');
    expect(formatUtxoCoinId(TXID, 12)).toBe('a1b2~abcd@12');
    expect(formatUtxoCoinId('abcd', 1)).toBe('abcd@1');
  });

  test('formatUtxoPickerLabel includes tag when present', () => {
    const addr = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
    expect(
      formatUtxoPickerLabel({txid: TXID, vout: 0, address: addr}),
    ).toBe('a1b2~abcd@0 / bc1q...f3t4');
    expect(
      formatUtxoPickerLabel({
        tag: 'savings',
        txid: TXID,
        vout: 0,
        address: addr,
      }),
    ).toBe('savings a1b2~abcd@0 / bc1q...f3t4');
  });

  test('sanitizeUtxoTagDraft filters to ASCII letters, digits, _ and -', () => {
    expect(sanitizeUtxoTagDraft('  hello  ')).toBe('hello');
    expect(sanitizeUtxoTagDraft('save-for_later')).toBe('save-for_later');
    expect(sanitizeUtxoTagDraft('a\nb\rc')).toBe('abc');
    expect(sanitizeUtxoTagDraft('café')).toBe('caf');
    expect(sanitizeUtxoTagDraft('')).toBe('');
    const long = 'x'.repeat(80);
    expect(sanitizeUtxoTagDraft(long)).toHaveLength(UTXO_TAG_MAX_LEN);
  });

  test('isValidUtxoTag requires 2–64 allowed ASCII chars', () => {
    expect(isValidUtxoTag('')).toBe(false);
    expect(isValidUtxoTag('a')).toBe(false);
    expect(isValidUtxoTag('ab')).toBe(true);
    expect(isValidUtxoTag('save-for_later')).toBe(true);
    expect(isValidUtxoTag('x'.repeat(UTXO_TAG_MAX_LEN))).toBe(true);
    expect(isValidUtxoTag('bad tag')).toBe(true);
  });

  test('sanitizeUtxoTag drops invalid and legacy tags', () => {
    expect(sanitizeUtxoTag('savings')).toBe('savings');
    expect(sanitizeUtxoTag('a')).toBe('');
    expect(sanitizeUtxoTag('   ')).toBe('');
    expect(sanitizeUtxoTag('hello world')).toBe('helloworld');
  });

  test('canPersistUtxoTag allows empty clear or valid tag', () => {
    expect(canPersistUtxoTag('')).toBe(true);
    expect(canPersistUtxoTag('a')).toBe(false);
    expect(canPersistUtxoTag('ok')).toBe(true);
  });

  test('spendableSats uses wallet when selection is null', () => {
    expect(spendableSats(100_000, null)).toBe(100_000);
    expect(spendableSats(100_000, 40_000)).toBe(40_000);
  });

  test('sumSelectedSats and filterUtxosByOutpoints', () => {
    const utxos = [
      {txid: 'aa', vout: 0, valueSats: 10},
      {txid: 'bb', vout: 1, valueSats: 20},
      {txid: 'cc', vout: 2, valueSats: 30},
    ];
    expect(sumSelectedSats(utxos, null)).toBeNull();
    const keys = new Set([outpointKey('aa', 0), outpointKey('cc', 2)]);
    expect(sumSelectedSats(utxos, keys)).toBe(40);
    expect(filterUtxosByOutpoints(utxos, keys)).toEqual([
      utxos[0],
      utxos[2],
    ]);
    expect(filterUtxosByOutpoints(utxos, null)).toEqual(utxos);
  });

  test('selectionFeeKey is stable', () => {
    expect(selectionFeeKey(null)).toBe('*');
    expect(
      selectionFeeKey(new Set(['bb:1', 'aa:0'])),
    ).toBe('aa:0,bb:1');
  });

  test('sortCoinControlUtxos puts tagged coins first A→Z, then untagged', () => {
    const base = {
      valueSats: 1000,
      address: 'bc1qtest',
      derivationPath: "m/84'/0'/0'/0/0",
      isConfirmed: true,
    };
    const utxos: CoinControlUtxo[] = [
      {txid: 'zz', vout: 0, tag: null, ...base},
      {txid: 'aa', vout: 0, tag: 'savings', ...base},
      {txid: 'bb', vout: 0, tag: 'cold', ...base},
      {txid: 'cc', vout: 0, tag: 'savings', ...base, valueSats: 2000},
    ];
    const sorted = sortCoinControlUtxos(utxos);
    expect(sorted.map(u => u.tag)).toEqual([
      'cold',
      'savings',
      'savings',
      null,
    ]);
    expect(sorted[1].txid).toBe('cc');
    expect(sorted[3].txid).toBe('zz');
  });

  test('filterTagSuggestions prefers prefix then substring; empty draft is quiet', () => {
    const tags = ['cold', 'savings', 'save-for-later', 'vault'];
    expect(filterTagSuggestions('sa', tags)).toEqual([
      'savings',
      'save-for-later',
    ]);
    expect(filterTagSuggestions('old', tags)).toEqual(['cold']);
    expect(filterTagSuggestions('savings', tags)).toEqual([]);
    expect(filterTagSuggestions('vau', tags)).toEqual(['vault']);
    expect(filterTagSuggestions('lat', tags)).toEqual(['save-for-later']);
    expect(filterTagSuggestions('', tags)).toEqual([]);
  });
});
