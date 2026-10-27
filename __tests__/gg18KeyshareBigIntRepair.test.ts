import {
  detectGg18BigIntJsonIssue,
  isGg18BigIntIssueFixable,
  repairGg18QuotedBigIntsInJson,
  repairGg18QuotedBigIntsInStorage,
  repairGg18QuotedBigIntsViaNative,
} from '../services/gg18KeyshareBigIntRepair';
import {
  buildGoShapedGg18KeyshareJson,
  GG18_HUGE_ALPHA,
  GG18_HUGE_PAILLIER_D,
} from './fixtures/mpcKeyshareFixtures';
import {quoteOversizedJsonIntegers} from '../utils/keyshareDevView';

jest.mock('react-native-encrypted-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(),
    setItem: jest.fn(() => Promise.resolve()),
  },
}));

jest.mock('../native_modules', () => ({
  BBMTLibNativeModule: {
    repairGg18KeyshareBigInts: jest.fn(),
  },
}));

jest.mock('../utils', () => ({
  KEYSHARE_STORAGE_KEY: 'keyshare',
  dbg: jest.fn(),
}));

import EncryptedStorage from 'react-native-encrypted-storage';
import {BBMTLibNativeModule} from '../native_modules';

describe('gg18KeyshareBigIntRepair detect+fix', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('detects quoted_oversized_ints as fixable', () => {
    const huge = '9'.repeat(40);
    const quoted = `{"ecdsa_local_data":{"Alpha":"${huge}"}}`;
    expect(detectGg18BigIntJsonIssue(quoted)).toBe('quoted_oversized_ints');
    expect(isGg18BigIntIssueFixable('quoted_oversized_ints')).toBe(true);
  });

  it('detects scientific_float as unrecoverable', () => {
    const sci = `{"ecdsa_local_data":{"Alpha":1.43042430941967e+308}}`;
    expect(detectGg18BigIntJsonIssue(sci)).toBe('scientific_float');
    expect(isGg18BigIntIssueFixable('scientific_float')).toBe(false);
    const {changed} = repairGg18QuotedBigIntsInJson(sci);
    expect(changed).toBe(false);
  });

  it('detect → repair → none for device quoted-string failure shape', () => {
    const huge =
      '26893305167438869507242425359767166369233987274303420242495511149696884729747841813548088012878879179233727698513499955254799757527173233003315689631672002477944423547352868608415250323378851109598652578430584596972217995497273980546130042500062474392804746924231727553543805931316537768243054357333659240921388524105744092824083299557201163365972824867187955735755208326115903020045984935482872354464336303027833354620273175336686744274522303756130307858314669065160507995227828297277841038050145113931647827799594924786229280415337149413311775209480301815155637134936477226536572919243427989850416493729714233150837';
    const quoted = `{"ecdsa_local_data":{"Alpha":"${huge}"},"pub_key":"ab"}`;
    expect(detectGg18BigIntJsonIssue(quoted)).toBe('quoted_oversized_ints');
    const {repaired, changed, fixable} = repairGg18QuotedBigIntsInJson(quoted);
    expect(fixable).toBe(true);
    expect(changed).toBe(true);
    expect(detectGg18BigIntJsonIssue(repaired)).toBe('none');
    expect(repaired).toContain(`"Alpha":${huge}`);
  });

  it('repairs finalize quote→stringify output back to Go marshal shape', () => {
    const goShaped = buildGoShapedGg18KeyshareJson();
    expect(detectGg18BigIntJsonIssue(goShaped)).toBe('none');
    const afterJs = JSON.stringify(
      JSON.parse(quoteOversizedJsonIntegers(goShaped)),
    );
    expect(detectGg18BigIntJsonIssue(afterJs)).toBe('quoted_oversized_ints');
    const {repaired, changed} = repairGg18QuotedBigIntsInJson(afterJs);
    expect(changed).toBe(true);
    expect(detectGg18BigIntJsonIssue(repaired)).toBe('none');
    expect(repaired).toContain(GG18_HUGE_PAILLIER_D);
    expect(repaired).not.toContain(`"${GG18_HUGE_PAILLIER_D}"`);
    expect(repaired).toContain(`"Alpha":${GG18_HUGE_ALPHA}`);
  });

  it('classifies envelope / empty / not_gg18 without mutating', () => {
    expect(detectGg18BigIntJsonIssue('v1:YWJj:ZGVm')).toBe('envelope');
    expect(detectGg18BigIntJsonIssue(null)).toBe('empty');
    expect(detectGg18BigIntJsonIssue('{"share_b64":"x"}')).toBe('not_gg18');
    expect(repairGg18QuotedBigIntsInJson('v1:YWJj:ZGVm').changed).toBe(false);
  });

  it('rewrites plaintext RNES when quoted ints are present', async () => {
    const quoted = `{"ecdsa_local_data":{"Alpha":"${'9'.repeat(40)}"}}`;
    (EncryptedStorage.getItem as jest.Mock).mockResolvedValue(quoted);
    const out = await repairGg18QuotedBigIntsInStorage();
    expect(out).toEqual({issue: 'quoted_oversized_ints', repaired: true});
    expect(EncryptedStorage.setItem).toHaveBeenCalledWith(
      'keyshare',
      expect.stringContaining(`"Alpha":${'9'.repeat(40)}`),
    );
  });

  it('logs envelope deferral and does not rewrite ciphertext', async () => {
    (EncryptedStorage.getItem as jest.Mock).mockResolvedValue('v1:aa:bb');
    await expect(repairGg18QuotedBigIntsInStorage()).resolves.toEqual({
      issue: 'envelope',
      repaired: false,
    });
    expect(EncryptedStorage.setItem).not.toHaveBeenCalled();
  });

  it('native bridge surfaces detect+repair without share bytes', async () => {
    (BBMTLibNativeModule.repairGg18KeyshareBigInts as jest.Mock).mockResolvedValue({
      detected: true,
      repaired: true,
      issue: 'quoted_oversized_ints',
    });
    await expect(repairGg18QuotedBigIntsViaNative()).resolves.toEqual({
      detected: true,
      repaired: true,
      issue: 'quoted_oversized_ints',
    });
  });
});
