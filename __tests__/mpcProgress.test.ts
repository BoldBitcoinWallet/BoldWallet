import {
  buildKeygenProgressTrace,
  dklsKeygenPercent,
  dklsKeysignPercent,
  gg18KeygenPercent,
  keygenPercentForUi,
  getKeygenStepCount,
  getKeysignStepCount,
  mapMpcHookToPercent,
  type MpcProgressUtxoState,
} from '../services/mpcProgress';

const emptyUtxo: MpcProgressUtxoState = {
  utxoIndex: 0,
  utxoCount: 0,
  utxoRange: 0,
};

describe('getKeygenStepCount', () => {
  it('documents legacy linear caps (DKLs/GG18 use phased mappers at runtime)', () => {
    expect(getKeygenStepCount('dkls23', false)).toBe(10);
    expect(getKeygenStepCount('dkls23', true)).toBe(14);
    expect(getKeygenStepCount('gg18', false)).toBe(10);
    expect(getKeygenStepCount('gg18', true)).toBe(16);
  });
});

describe('getKeysignStepCount', () => {
  it('uses 12 for DKLs and 36 for GG18', () => {
    expect(getKeysignStepCount('dkls23')).toBe(12);
    expect(getKeysignStepCount('gg18')).toBe(36);
  });
});

describe('dklsKeygenPercent', () => {
  it('allocates prep steps 1–2 then ramps rounds (duo)', () => {
    expect(dklsKeygenPercent(0, false)).toBe(0);
    expect(dklsKeygenPercent(1, false)).toBe(10);
    expect(dklsKeygenPercent(2, false)).toBe(20);
    expect(dklsKeygenPercent(3, false)).toBe(31);
    expect(dklsKeygenPercent(7, false)).toBeGreaterThanOrEqual(75);
    expect(dklsKeygenPercent(8, false)).toBeGreaterThanOrEqual(85);
    expect(dklsKeygenPercent(9, false)).toBe(99);
    expect(dklsKeygenPercent(99, false)).toBe(100);
  });

  it('uses longer round span for trio', () => {
    expect(dklsKeygenPercent(6, true)).toBeGreaterThanOrEqual(55);
    expect(dklsKeygenPercent(9, true)).toBeGreaterThanOrEqual(80);
    expect(dklsKeygenPercent(11, true)).toBe(99);
  });

  it('late duo rounds are not stuck near 37% before done', () => {
    expect(dklsKeygenPercent(6, false)).toBeGreaterThanOrEqual(60);
    expect(dklsKeygenPercent(7, false)).toBeGreaterThanOrEqual(70);
  });
});

describe('gg18KeygenPercent', () => {
  it('ramps prep then rounds for duo', () => {
    expect(gg18KeygenPercent(0, false)).toBe(0);
    expect(gg18KeygenPercent(2, false)).toBe(15);
    expect(gg18KeygenPercent(6, false)).toBeGreaterThanOrEqual(60);
    expect(gg18KeygenPercent(8, false)).toBeGreaterThanOrEqual(80);
    expect(gg18KeygenPercent(9, false)).toBe(99);
  });

  it('late steps map high enough before sentinel', () => {
    expect(gg18KeygenPercent(7, false)).toBeGreaterThanOrEqual(70);
    expect(gg18KeygenPercent(12, true)).toBeGreaterThanOrEqual(85);
  });
});

describe('buildKeygenProgressTrace', () => {
  it('produces monotonic DKLs duo curve', () => {
    const trace = buildKeygenProgressTrace('dkls23', false, 99);
    for (let i = 1; i < trace.length; i += 1) {
      expect(trace[i].percent).toBeGreaterThanOrEqual(trace[i - 1].percent);
    }
    expect(trace[trace.length - 1].percent).toBe(100);
  });
});

describe('dklsKeysignPercent', () => {
  it('uses prep band then rounds within UTXO slice', () => {
    const utxo: MpcProgressUtxoState = {
      utxoCount: 2,
      utxoIndex: 2,
      utxoRange: 50,
    };
    expect(dklsKeysignPercent(1, utxo)).toBe(54);
    expect(dklsKeysignPercent(3, utxo)).toBe(62);
    expect(dklsKeysignPercent(12, utxo)).toBe(100);
  });
});

describe('mapMpcHookToPercent', () => {
  describe('DKLs keygen', () => {
    it('maps early steps without hitting 100 (GG18-analog UI curve)', () => {
      expect(
        mapMpcHookToPercent(
          {type: 'keygen', step: 0},
          'dkls23',
          {isTrio: false, utxo: emptyUtxo, currentProgress: 0},
        ).percent,
      ).toBe(0);
      expect(
        mapMpcHookToPercent(
          {type: 'keygen', step: 2},
          'dkls23',
          {isTrio: false, utxo: emptyUtxo, currentProgress: 0},
        ).percent,
      ).toBe(keygenPercentForUi(2, false));
      expect(
        mapMpcHookToPercent(
          {type: 'keygen', step: 7},
          'dkls23',
          {isTrio: false, utxo: emptyUtxo, currentProgress: 0},
        ).percent,
      ).toBeGreaterThanOrEqual(75);
    });

    it('treats sentinel step 99 as 100 without done flag', () => {
      expect(
        mapMpcHookToPercent(
          {type: 'keygen', step: 99},
          'dkls23',
          {isTrio: false, utxo: emptyUtxo, currentProgress: 0},
        ).percent,
      ).toBe(100);
    });

    it('sets mpcDone on done', () => {
      const r = mapMpcHookToPercent(
        {type: 'keygen', done: true},
        'dkls23',
        {isTrio: false, utxo: emptyUtxo, currentProgress: 50},
      );
      expect(r.percent).toBe(100);
      expect(r.mpcDone).toBe(true);
    });

    it('does not decrease progress', () => {
      expect(
        mapMpcHookToPercent(
          {type: 'keygen', step: 3},
          'dkls23',
          {isTrio: false, utxo: emptyUtxo, currentProgress: 80},
        ).percent,
      ).toBe(80);
    });
  });

  describe('GG18 keygen', () => {
    it('uses same phased curve as DKLS UI mapping', () => {
      expect(
        mapMpcHookToPercent(
          {type: 'keygen', step: 7},
          'gg18',
          {isTrio: false, utxo: emptyUtxo, currentProgress: 0},
        ).percent,
      ).toBe(keygenPercentForUi(7, false));
    });
  });

  describe('GG18 keysign', () => {
    it('maps step 18 toward 50%', () => {
      expect(
        mapMpcHookToPercent(
          {type: 'keysign', step: 18},
          'gg18',
          {isTrio: false, utxo: emptyUtxo, currentProgress: 0},
        ).percent,
      ).toBe(50);
    });
  });

  describe('send_btc UTXO bands', () => {
    it('updates utxo state from btc_send', () => {
      const r = mapMpcHookToPercent(
        {type: 'btc_send', utxo_total: 2, utxo_current: 1},
        'dkls23',
        {
          isTrio: false,
          isSendBitcoin: true,
          utxo: emptyUtxo,
          currentProgress: 0,
        },
      );
      expect(r.percent).toBe(8);
      expect(r.utxoState).toEqual({
        utxoCount: 2,
        utxoIndex: 1,
        utxoRange: 50,
      });
    });

    it('bands keysign progress across two UTXOs for GG18', () => {
      const utxo: MpcProgressUtxoState = {
        utxoCount: 2,
        utxoIndex: 2,
        utxoRange: 50,
      };
      const r = mapMpcHookToPercent(
        {type: 'keysign', step: 18},
        'gg18',
        {isTrio: false, utxo, currentProgress: 0},
      );
      expect(r.percent).toBe(75);
    });

    it('bands keysign progress across two UTXOs for DKLs', () => {
      const utxo: MpcProgressUtxoState = {
        utxoCount: 2,
        utxoIndex: 2,
        utxoRange: 50,
      };
      const r = mapMpcHookToPercent(
        {type: 'keysign', step: 8},
        'dkls23',
        {isTrio: false, utxo, currentProgress: 0},
      );
      expect(r.percent).toBe(83);
    });
  });

  describe('keysign edge cases', () => {
    it('returns null for step 0', () => {
      expect(
        mapMpcHookToPercent(
          {type: 'keysign', step: 0},
          'dkls23',
          {isTrio: false, utxo: emptyUtxo, currentProgress: 0},
        ).percent,
      ).toBeNull();
    });

    it('clears utxo state on keysign done', () => {
      const r = mapMpcHookToPercent(
        {type: 'keysign', done: true},
        'dkls23',
        {
          isTrio: false,
          utxo: {utxoCount: 2, utxoIndex: 2, utxoRange: 50},
          currentProgress: 40,
        },
      );
      expect(r.percent).toBe(100);
      expect(r.mpcDone).toBe(true);
      expect(r.utxoState).toEqual(emptyUtxo);
    });
  });

  describe('PSBT signing (native type psbt)', () => {
    it('maps pre-agreement to early progress', () => {
      const r = mapMpcHookToPercent(
        {
          type: 'psbt',
          info: 'pre-agreement phase',
          utxo_total: 0,
          utxo_current: 0,
        },
        'dkls23',
        {isTrio: false, utxo: emptyUtxo, currentProgress: 0},
      );
      expect(r.percent).toBe(5);
    });

    it('bands per-input PSBT hooks across full progress range', () => {
      const r = mapMpcHookToPercent(
        {
          type: 'psbt',
          info: 'signing psbt input (nostr)',
          utxo_total: 2,
          utxo_current: 1,
        },
        'dkls23',
        {isTrio: false, utxo: emptyUtxo, currentProgress: 0},
      );
      expect(r.utxoState).toEqual({
        utxoCount: 2,
        utxoIndex: 1,
        utxoRange: 50,
      });
      expect(r.percent).toBe(4);
    });

    it('marks done on psbt signing complete', () => {
      const r = mapMpcHookToPercent(
        {type: 'psbt', done: true},
        'dkls23',
        {isTrio: false, utxo: emptyUtxo, currentProgress: 50},
      );
      expect(r.percent).toBe(100);
      expect(r.mpcDone).toBeUndefined();
    });
  });
});
