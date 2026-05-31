import {safeUnlink} from '../services/rnfsSafe';

const mockUnlink = jest.fn();
const mockExists = jest.fn();

jest.mock('react-native-fs', () => ({
  __esModule: true,
  default: {
    unlink: (...args: unknown[]) => mockUnlink(...args),
    exists: (...args: unknown[]) => mockExists(...args),
  },
}));

describe('safeUnlink', () => {
  beforeEach(() => {
    mockUnlink.mockReset();
    mockExists.mockReset();
    mockExists.mockResolvedValue(true);
  });

  it('resolves when unlink succeeds', async () => {
    mockUnlink.mockResolvedValue(undefined);
    await expect(safeUnlink('/tmp/foo')).resolves.toBeUndefined();
    expect(mockUnlink).toHaveBeenCalledWith('/tmp/foo');
  });

  it('resolves when unlink rejects (missing file)', async () => {
    mockUnlink.mockRejectedValue(new Error('ENOENT'));
    await expect(safeUnlink('/tmp/missing')).resolves.toBeUndefined();
  });

  it('skips unlink when file does not exist', async () => {
    mockExists.mockResolvedValue(false);
    await expect(safeUnlink('/tmp/missing')).resolves.toBeUndefined();
    expect(mockUnlink).not.toHaveBeenCalled();
  });
});
