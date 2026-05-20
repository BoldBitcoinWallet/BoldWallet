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

describe('processMpcHookMessage', () => {
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
