import {
  dklsKeygenPercent,
  dklsKeysignPercent,
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
  it('uses DKLs duo/trio denominators', () => {
    expect(getKeygenStepCount('dkls23', false)).toBe(14);
    expect(getKeygenStepCount('dkls23', true)).toBe(22);
  });
  it('uses GG18 duo/trio denominators', () => {
    expect(getKeygenStepCount('gg18', false)).toBe(18);
    expect(getKeygenStepCount('gg18', true)).toBe(29);
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
    expect(dklsKeygenPercent(3, false)).toBe(27);
    expect(dklsKeygenPercent(7, false)).toBe(56);
    expect(dklsKeygenPercent(13, false)).toBe(99);
    expect(dklsKeygenPercent(99, false)).toBe(100);
  });

  it('uses longer round span for trio', () => {
    expect(dklsKeygenPercent(7, true)).toBe(41);
    expect(dklsKeygenPercent(21, true)).toBe(99);
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
    it('maps early steps without hitting 100', () => {
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
      ).toBe(20);
      expect(
        mapMpcHookToPercent(
          {type: 'keygen', step: 7},
          'dkls23',
          {isTrio: false, utxo: emptyUtxo, currentProgress: 0},
        ).percent,
      ).toBe(56);
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
        {isTrio: false, utxo: emptyUtxo, currentProgress: 0},
      );
      expect(r.percent).toBeNull();
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
      // prgUTXO=50, + (50 * 18) / 36 = 75
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
});
