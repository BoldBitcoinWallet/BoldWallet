jest.mock('react-native-fs', () => ({
  DocumentDirectoryPath: '/tmp',
  copyFile: jest.fn(),
  readFile: jest.fn(),
}));

import {Buffer} from 'buffer';
import {isPsbtBytes} from '../services/psbtIdentity';
import {inferFileKindFromUri} from '../services/incomingFileClassifier';

describe('incomingFileClassifier', () => {
  it('infers PSBT from .psbt extension', () => {
    expect(inferFileKindFromUri('content://downloads/tx.psbt')).toBe('psbt');
  });

  it('infers keyshare from .share extension', () => {
    expect(inferFileKindFromUri('file:///tmp/a6trK1.share')).toBe('keyshare');
  });

  it('detects PSBT magic bytes', () => {
    const psbtBytes = Buffer.from([0x70, 0x73, 0x62, 0x74, 0x00]);
    expect(isPsbtBytes(psbtBytes)).toBe(true);
  });
});
