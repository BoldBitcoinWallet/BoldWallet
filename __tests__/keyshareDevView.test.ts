import {
  parseKeyshareJsonForDevView,
  prettyPrintKeyshareJson,
  quoteOversizedJsonIntegers,
} from '../utils/keyshareDevView';

describe('keyshareDevView', () => {
  it('parseKeyshareJsonForDevView rejects empty', () => {
    expect(parseKeyshareJsonForDevView(null)).toEqual({
      error: 'No keyshare in secure storage',
    });
    expect(parseKeyshareJsonForDevView('  ')).toEqual({
      error: 'No keyshare in secure storage',
    });
  });

  it('parseKeyshareJsonForDevView parses object', () => {
    const raw = JSON.stringify({
      tss_backend: 'dkls23',
      share_b64: 'abc',
      nsec: 'deadbeef',
    });
    const r = parseKeyshareJsonForDevView(raw);
    expect('data' in r).toBe(true);
    if ('data' in r) {
      expect(r.data.tss_backend).toBe('dkls23');
      expect(r.data.share_b64).toBe('abc');
    }
  });

  it('prettyPrintKeyshareJson formats with indentation', () => {
    const out = prettyPrintKeyshareJson({a: 1});
    expect(out).toBe('{\n  "a": 1\n}');
  });

  it('prettyPrintKeyshareJson preserves non-JSON numbers', () => {
    expect(prettyPrintKeyshareJson({x: Infinity})).toBe('{\n  "x": "Infinity"\n}');
    expect(prettyPrintKeyshareJson({x: -Infinity})).toBe(
      '{\n  "x": "-Infinity"\n}',
    );
    expect(prettyPrintKeyshareJson({x: NaN})).toBe('{\n  "x": "NaN"\n}');
  });

  it('quoteOversizedJsonIntegers preserves GG18-scale big.Int fields', () => {
    const huge = '9'.repeat(400);
    const raw = `{"ecdsa_local_data":{"Alpha":${huge}},"created_at":1779458846762}`;
    const quoted = quoteOversizedJsonIntegers(raw);
    expect(quoted).toContain(`"Alpha":"${huge}"`);
    const parsed = JSON.parse(quoted) as {
      ecdsa_local_data: {Alpha: string};
      created_at: number;
    };
    expect(parsed.ecdsa_local_data.Alpha).toBe(huge);
    expect(parsed.created_at).toBe(1779458846762);
  });

  it('parseKeyshareJsonForDevView keeps ecdsa_local_data.Alpha as string', () => {
    const huge = '8'.repeat(350);
    const raw = JSON.stringify({
      tss_backend: 'gg18',
      ecdsa_local_data: {Alpha: huge},
    }).replace(`"Alpha":"${huge}"`, `"Alpha":${huge}`);
    const r = parseKeyshareJsonForDevView(raw);
    expect('data' in r).toBe(true);
    if ('data' in r) {
      const alpha = (r.data.ecdsa_local_data as {Alpha: unknown}).Alpha;
      expect(alpha).toBe(huge);
      expect(alpha).not.toBe(Infinity);
    }
  });
});
