import {Alert, NativeModules, Text, TextInput} from 'react-native';
import TestRenderer, {act} from 'react-test-renderer';

jest.mock('../components/GlassModalOverlay', () => {
  const React = require('react');
  return {
    __esModule: true,
    default: (props: any) =>
      React.createElement(React.Fragment, null, props.children),
  };
});
jest.mock('../components/AppPressable', () => {
  const React = require('react');
  return {
    __esModule: true,
    default: (props: any) =>
      React.createElement('MockPressable', props, props.children),
  };
});
jest.mock('../components/Styles', () => ({createStyles: () => ({} as any)}));
jest.mock('../theme', () => ({
  useTheme: () => ({
    theme: {
      colors: {
        danger: '#000',
        warning: '#000',
        warningLight: '#000',
        received: '#000',
        disabled: '#000',
        border: '#000',
        disabledText: '#000',
        textSecondary: '#000',
        text: '#000',
        primary: '#000',
        card: '#000',
        background: '#000',
      },
    },
  }),
}));
jest.mock('../utils', () => ({
  dbg: jest.fn(),
  getKeyshareMetadata: jest.fn(),
  getKeyshareLabel: jest.fn(),
}));
jest.mock('react-native-share', () => ({
  __esModule: true,
  default: {open: jest.fn()},
}));
jest.mock('react-native-fs', () => ({
  TemporaryDirectoryPath: '/tmp',
  CachesDirectoryPath: '/tmp',
  DocumentDirectoryPath: '/tmp',
  writeFile: jest.fn(),
  stat: jest.fn(),
}));
jest.mock('../services/rnfsSafe', () => ({safeUnlink: jest.fn()}));
// 3b-3 A12: export routes via TssProvider (token plumbing pinned
// in tssExportTokenGating; this suite pins modal opacity).
jest.mock('../services/TssProvider', () => ({
  TssProvider: {backupEncryptStoredKeyshare: jest.fn()},
}));
jest.mock('../services/backupNudge', () => ({
  clearBackupNudge: jest.fn(),
}));

import {getKeyshareLabel, getKeyshareMetadata} from '../utils';
import RNFS from 'react-native-fs';
import Share from 'react-native-share';
import {TssProvider} from '../services/TssProvider';
import {clearBackupNudge} from '../services/backupNudge';

const nativeMocks = {
  aesEncryptStoredKeyshare: jest.fn(),
  sha256: jest.fn(),
};
(NativeModules as any).BBMTLibNativeModule = nativeMocks;
const exportEncrypt = TssProvider.backupEncryptStoredKeyshare as jest.Mock;

const BackupKeyshareModal = require('../components/BackupKeyshareModal').default;

const META = {
  pub_key:
    '03a564e4ccc8210102812f4337de203853cb945910e6863b2b5b4b01fd9fbc37b6',
  local_party_key: 'KeyShare1',
  keygen_committee_keys: ['KeyShare1', 'KeyShare2'],
};
const V2_BLOB = 'BW2$mock-ciphertext-bytes-no-share-here';

describe('BackupKeyshareModal export opacity (F15)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    (getKeyshareMetadata as jest.Mock).mockResolvedValue(META);
    (getKeyshareLabel as jest.Mock).mockReturnValue('KeyShare1');
    exportEncrypt.mockResolvedValue(V2_BLOB);
    nativeMocks.sha256.mockResolvedValue('abcdef123456');
    (RNFS.writeFile as jest.Mock).mockResolvedValue(undefined);
    (RNFS.stat as jest.Mock).mockResolvedValue({size: V2_BLOB.length});
    (Share.open as jest.Mock).mockResolvedValue(undefined);
  });

  async function renderAndExport(password: string) {
    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        (require('react') as typeof import('react')).createElement(
          BackupKeyshareModal,
          {visible: true, onClose: jest.fn()} as any,
        ) as any,
      );
    });
    const inputs = renderer!.root.findAllByType(TextInput as any);
    expect(inputs.length).toBe(2);
    await act(async () => {
      inputs[0].props.onChangeText(password);
      inputs[1].props.onChangeText(password);
    });
    const labels = renderer!.root
      .findAllByType(Text as any)
      .filter(n => n.props.children === 'Backup');
    expect(labels.length).toBe(1);
    let exportBtn: any = labels[0];
    while (exportBtn && exportBtn.type !== 'MockPressable') {
      exportBtn = exportBtn.parent;
    }
    expect(exportBtn).toBeTruthy();
    expect(exportBtn.props.disabled).toBe(false);
    await act(async () => {
      await exportBtn.props.onPress();
    });
    return renderer!;
  }

  it('F15: export passes the password to native, never a derived key', async () => {
    await renderAndExport('Correct-Horse-12!');
    expect(exportEncrypt).toHaveBeenCalledTimes(1);
    expect(exportEncrypt).toHaveBeenCalledWith('Correct-Horse-12!');
    expect(nativeMocks.aesEncryptStoredKeyshare).not.toHaveBeenCalled();
  });

  it('F15: exported blob is written opaquely, never parsed in JS', async () => {
    await renderAndExport('Correct-Horse-12!');
    expect(RNFS.writeFile).toHaveBeenCalledTimes(1);
    const [, blob, encoding] = (RNFS.writeFile as jest.Mock).mock.calls[0];
    expect(blob).toBe(V2_BLOB);
    // 3b-6d (F23): ASCII "BW2$..." envelope MUST be written utf8.
    // 'base64' decodes first — "$" is not base64, so iOS wrote
    // silent empty files (nil data resolves success).
    expect(encoding).toBe('utf8');
    expect(Share.open).toHaveBeenCalledTimes(1);
  });

  it('3b-6e: successful export clears the backup nudge', async () => {
    await renderAndExport('Correct-Horse-12!');
    expect(clearBackupNudge).toHaveBeenCalledTimes(1);
  });

  it('F23: empty backup file is never shared (fail-closed stat guard)', async () => {
    (RNFS.stat as jest.Mock).mockResolvedValueOnce({size: 0});
    await renderAndExport('Correct-Horse-12!');
    expect(Share.open).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalledWith(
      'Error',
      expect.stringContaining('could not be written'),
    );
    expect(clearBackupNudge).not.toHaveBeenCalled();
  });

  it('F15: no share bytes cross any JS-handled value on export', async () => {
    await renderAndExport('Correct-Horse-12!');
    const seen: string[] = [];
    const collect = (v: unknown) => {
      if (typeof v === 'string') {
        seen.push(v);
      } else if (Array.isArray(v)) {
        v.forEach(collect);
      } else if (v && typeof v === 'object') {
        Object.values(v).forEach(collect);
      }
    };
    [
      exportEncrypt.mock.calls,
      nativeMocks.sha256.mock.calls,
      (RNFS.writeFile as jest.Mock).mock.calls,
      (Share.open as jest.Mock).mock.calls,
    ].forEach(collect);
    for (const s of seen) {
      expect(s).not.toContain('share_b64');
      expect(s).not.toContain('nsec1');
    }
  });
});
