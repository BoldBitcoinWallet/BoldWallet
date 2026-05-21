import {
  parseKeyshareJsonForDevView,
  prettyPrintKeyshareJson,
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
});
