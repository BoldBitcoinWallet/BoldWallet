jest.mock('../services/tssBackend', () => ({
  resolveHookProgressBackend: jest.fn(
    (opts: {
      isSpendFlow: boolean;
      spendBackend: string | null;
      keygenBackend: string | null;
    }) =>
      opts.isSpendFlow ? opts.spendBackend : opts.keygenBackend,
  ),
  resolveTssBackendFromCachedMeta: jest.fn(() => null),
  getKeygenTssBackendPreference: jest.fn(() => 'dkls23'),
}));

import {
  formatMpcPhaseLabel,
  mpcSessionShortLabel,
  processMpcHookMessage,
  resolveMpcHookBackend,
} from '../services/mpcProgressUi';
import {emptyMpcUtxoState} from '../services/mpcProgress';

describe('formatMpcPhaseLabel', () => {
  it('labels DKG waiting and rounds for keygen', () => {
    expect(
      formatMpcPhaseLabel(
        {type: 'keygen', step: 1, info: 'waiting parties'},
        {isSendBitcoin: false, utxo: emptyMpcUtxoState()},
      ),
    ).toBe('Waiting for all devices…');
    expect(
      formatMpcPhaseLabel(
        {type: 'keygen', step: 5, info: 'DKG round 5'},
        {isSendBitcoin: false, utxo: emptyMpcUtxoState()},
      ),
    ).toBe('Key generation · round 5');
    expect(
      formatMpcPhaseLabel(
        {type: 'keygen', step: 4, info: 'keygen round 4'},
        {isSendBitcoin: false, utxo: emptyMpcUtxoState()},
      ),
    ).toBe('Key generation · round 4');
  });

  it('labels PSBT coarse hooks', () => {
    expect(
      formatMpcPhaseLabel(
        {type: 'psbt', info: 'pre-agreement phase'},
        {isSendBitcoin: false, utxo: emptyMpcUtxoState()},
      ),
    ).toBe('Connecting co-signers for PSBT…');
    expect(
      formatMpcPhaseLabel(
        {type: 'psbt', info: 'joining keysign (nostr)'},
        {
          isSendBitcoin: false,
          utxo: {utxoIndex: 1, utxoCount: 2, utxoRange: 50},
        },
      ),
    ).toBe('Signing PSBT · input 1 of 2');
  });

  it('labels multi-UTXO keysign for send', () => {
    expect(
      formatMpcPhaseLabel(
        {type: 'keysign', step: 4, info: 'keysign round 2'},
        {
          isSendBitcoin: true,
          utxo: {utxoIndex: 2, utxoCount: 3, utxoRange: 33},
        },
      ),
    ).toBe('Signing · input 2 of 3');
  });
});

describe('mpcSessionShortLabel', () => {
  it('returns first four chars of session id', () => {
    expect(mpcSessionShortLabel('eff7381eabcd')).toBe('eff7');
    expect(mpcSessionShortLabel('ab')).toBeNull();
    expect(mpcSessionShortLabel(null)).toBeNull();
  });
});

describe('processMpcHookMessage', () => {
  it('maps DKLS trio keygen step 4 higher than GG18 at same step', () => {
    const dklsRefs = {
      progressRef: {current: 0},
      utxoRef: {current: emptyMpcUtxoState()},
    };
    const gg18Refs = {
      progressRef: {current: 0},
      utxoRef: {current: emptyMpcUtxoState()},
    };
    const dkls = processMpcHookMessage(
      JSON.stringify({type: 'keygen', step: 4, info: 'keygen round'}),
      'dkls23',
      {isTrio: true, isSendBitcoin: false, refs: dklsRefs},
    );
    const gg18 = processMpcHookMessage(
      JSON.stringify({type: 'keygen', step: 4, info: 'keygen round'}),
      'gg18',
      {isTrio: true, isSendBitcoin: false, refs: gg18Refs},
    );
    expect(dkls?.percent).toBe(38);
    expect(gg18?.percent).toBe(29);
    expect(dkls?.statusLabel).toBe('Key generation · round 2');
  });

  it('labels DKLS receive heartbeat with Nostr hint', () => {
    expect(
      formatMpcPhaseLabel(
        {type: 'keygen', step: 5, info: 'keygen round (receiving 2)'},
        {isSendBitcoin: false, utxo: emptyMpcUtxoState(), isNostrTransport: true},
      ),
    ).toBe('Key generation · round 3 (over Nostr…)');
  });

  it('labels DKLS receive heartbeat with LAN hint', () => {
    expect(
      formatMpcPhaseLabel(
        {type: 'keygen', step: 5, info: 'keygen round (receiving 2)'},
        {isSendBitcoin: false, utxo: emptyMpcUtxoState(), isNostrTransport: false},
      ),
    ).toBe('Key generation · round 3 (from peers…)');
  });

  it('sets transportLiveness on recv heartbeat hooks', () => {
    const progressRef = {current: 46};
    const r = processMpcHookMessage(
      JSON.stringify({
        type: 'keygen',
        step: 5,
        info: 'keygen round (receiving 3)',
      }),
      'dkls23',
      {
        isTrio: true,
        isSendBitcoin: false,
        isNostrTransport: true,
        refs: {progressRef, utxoRef: {current: emptyMpcUtxoState()}},
      },
    );
    expect(r?.transportLiveness).toBe(true);
    expect(r?.percent).toBeGreaterThan(46);
    expect(r?.percent).toBeLessThanOrEqual(54);
  });

  it('ignores hooks for a different session id', () => {
    const progressRef = {current: 0};
    const utxoRef = {current: emptyMpcUtxoState()};
    const activeSessionRef = {current: 'session-a'};
    const r = processMpcHookMessage(
      JSON.stringify({
        session: 'session-b',
        type: 'keygen',
        step: 7,
      }),
      'dkls23',
      {
        isTrio: false,
        isSendBitcoin: false,
        refs: {progressRef, utxoRef, activeSessionRef},
      },
    );
    expect(r).toBeNull();
    expect(progressRef.current).toBe(0);
  });

  it('accepts per-UTXO keysign session suffix', () => {
    const progressRef = {current: 0};
    const utxoRef = {current: emptyMpcUtxoState()};
    const activeSessionRef = {current: 'session-a'};
    const r = processMpcHookMessage(
      JSON.stringify({
        session: 'session-a0',
        type: 'keysign',
        step: 5,
        info: 'DKLs keysign round',
      }),
      'dkls23',
      {
        isTrio: false,
        isSendBitcoin: true,
        refs: {progressRef, utxoRef, activeSessionRef},
      },
    );
    expect(r).not.toBeNull();
    expect(r?.percent).toBeGreaterThan(0);
    expect(r?.sessionShort).toBe('sess');
  });

  it('exposes sessionShort from hook when active session unset', () => {
    const progressRef = {current: 0};
    const utxoRef = {current: emptyMpcUtxoState()};
    const activeSessionRef = {current: null as string | null};
    const r = processMpcHookMessage(
      JSON.stringify({
        session: '11b9d1c4deadbeef',
        type: 'psbt',
        info: 'pre-agreement',
      }),
      'gg18',
      {
        isTrio: false,
        isSendBitcoin: false,
        isSignPSBT: true,
        refs: {progressRef, utxoRef, activeSessionRef},
      },
    );
    expect(r?.sessionShort).toBe('11b9');
    expect(activeSessionRef.current).toBe('11b9d1c4deadbeef');
  });

  it('accepts Nostr keysign after pre-agreement sessionFlag', () => {
    const progressRef = {current: 5};
    const utxoRef = {current: emptyMpcUtxoState()};
    const activeSessionRef = {current: 'c2a972d2406a511cdbdf23465fe15d1f369dcdc93723a3dee583f088cb9918bf'};
    const r = processMpcHookMessage(
      JSON.stringify({
        session: 'f9487f081592611ab0b4a5c176f5e8a6fdf12478ea3e31157e3e5177a002a1bf0',
        type: 'keysign',
        step: 10,
        info: 'Received new message 1',
        done: false,
      }),
      'gg18',
      {
        isTrio: true,
        isSendBitcoin: true,
        refs: {progressRef, utxoRef, activeSessionRef},
      },
    );
    expect(r).not.toBeNull();
    expect(r?.percent).toBeGreaterThan(5);
    expect(activeSessionRef.current).toBe(
      'f9487f081592611ab0b4a5c176f5e8a6fdf12478ea3e31157e3e5177a002a1bf',
    );
  });

  it('keeps progress monotonic across hooks', () => {
    const progressRef = {current: 50};
    const utxoRef = {current: emptyMpcUtxoState()};
    const r = processMpcHookMessage(
      JSON.stringify({type: 'keygen', step: 3}),
      'dkls23',
      {
        isTrio: false,
        isSendBitcoin: false,
        refs: {progressRef, utxoRef},
      },
    );
    expect(r?.percent).toBe(50);
  });
});

describe('resolveMpcHookBackend', () => {
  it('falls back while MPC is active', () => {
    expect(
      resolveMpcHookBackend({
        isSpendFlow: false,
        spendBackend: null,
        keygenBackend: null,
        mpcActive: true,
      }),
    ).toBe('dkls23');
  });

  it('returns null when MPC inactive and backends unset', () => {
    expect(
      resolveMpcHookBackend({
        isSpendFlow: false,
        spendBackend: null,
        keygenBackend: null,
        mpcActive: false,
      }),
    ).toBeNull();
  });
});
