jest.mock('react-native-fs', () => ({
  DocumentDirectoryPath: '/tmp',
  copyFile: jest.fn(async () => undefined),
  readFile: jest.fn(),
}));

jest.mock('../services/rnfsSafe', () => ({
  safeUnlink: jest.fn(async () => undefined),
}));

import {Buffer} from 'buffer';
import RNFS from 'react-native-fs';
import {isPsbtBytes} from '../services/psbtIdentity';
import {
  classifyIncomingFile,
  inferFileKindFromUri,
  looksLikeNonWalletBytes,
} from '../services/incomingFileClassifier';

const mockedReadFile = RNFS.readFile as jest.Mock;

function mockPeekBytes(bytes: Buffer) {
  mockedReadFile.mockResolvedValue(bytes.toString('base64'));
}

describe('incomingFileClassifier', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('infers PSBT from .psbt extension', () => {
    expect(inferFileKindFromUri('content://downloads/tx.psbt')).toBe('psbt');
  });

  it('infers keyshare from .share extension', () => {
    expect(inferFileKindFromUri('file:///tmp/a6trK1.share')).toBe('keyshare');
  });

  it('infers keyshare from provider content URI displayName', () => {
    expect(
      inferFileKindFromUri(
        'content://org.telegram.messenger.provider/media/42?displayName=wallet.share',
      ),
    ).toBe('keyshare');
    expect(
      inferFileKindFromUri(
        'content://com.whatsapp.provider.media/item/7?displayName=backup.share',
      ),
    ).toBe('keyshare');
    expect(
      inferFileKindFromUri(
        'content://com.android.externalstorage.documents/document/primary%3ADownload%2Fkey.share',
      ),
    ).toBe('keyshare');
  });

  it('detects PSBT magic bytes', () => {
    const psbtBytes = Buffer.from([0x70, 0x73, 0x62, 0x74, 0x00]);
    expect(isPsbtBytes(psbtBytes)).toBe(true);
  });

  it('classifies JPEG/MP4 peeks as unknown', async () => {
    mockPeekBytes(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]));
    await expect(classifyIncomingFile('file:///tmp/photo.jpg')).resolves.toBe(
      'unknown',
    );
    expect(looksLikeNonWalletBytes(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe(
      true,
    );

    mockPeekBytes(
      Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]),
    );
    await expect(classifyIncomingFile('file:///tmp/video.mp4')).resolves.toBe(
      'unknown',
    );
  });

  it('classifies opaque WhatsApp content URIs as keyshare', async () => {
    mockPeekBytes(Buffer.from([0xa6, 0x11, 0x22, 0x33, 0x44, 0x55]));
    await expect(
      classifyIncomingFile('content://com.whatsapp.provider.media/item/7'),
    ).resolves.toBe('keyshare');
  });

  it('classifies PSBT magic before URI hint', async () => {
    mockPeekBytes(Buffer.from([0x70, 0x73, 0x62, 0x74, 0x00]));
    await expect(
      classifyIncomingFile('content://org.telegram.messenger.provider/media/9'),
    ).resolves.toBe('psbt');
  });
});
