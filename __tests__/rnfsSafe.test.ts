import {safeUnlink} from '../services/rnfsSafe';

const mockUnlink = jest.fn();

jest.mock('react-native-fs', () => ({
  __esModule: true,
  default: {
    unlink: (...args: unknown[]) => mockUnlink(...args),
  },
}));

describe('safeUnlink', () => {
  beforeEach(() => {
    mockUnlink.mockReset();
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
});
