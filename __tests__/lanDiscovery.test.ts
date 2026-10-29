/**
 * @format
 */

const mockPins: string[] = [];
const mockInstances: Array<{
  publishService: jest.Mock;
  unpublishService: jest.Mock;
  stop: jest.Mock;
  scan: jest.Mock;
  removeAllListeners: jest.Mock;
  on: jest.Mock;
  handlers: Record<string, (service: unknown) => void>;
}> = [];

jest.mock('react-native-zeroconf', () => ({
  __esModule: true,
  ImplType: {NSD: 'NSD'},
  default: jest.fn().mockImplementation(() => {
    const handlers: Record<string, (service: unknown) => void> = {};
    const inst = {
      publishService: jest.fn(),
      unpublishService: jest.fn(),
      stop: jest.fn(),
      scan: jest.fn(),
      removeAllListeners: jest.fn(),
      on: jest.fn((event: string, cb: (service: unknown) => void) => {
        handlers[event] = cb;
      }),
      handlers,
    };
    mockInstances.push(inst);
    return inst;
  }),
}));

jest.mock('../services/lanDiscoveryPermissions', () => ({
  ensureLanDiscoveryPermission: jest.fn(async () => true),
}));

jest.mock('../utils', () => ({
  dbg: jest.fn(),
  pinRemoteIP: (addr: string) => {
    if (
      typeof addr === 'string' &&
      addr.split('.').length === 4 &&
      !mockPins.includes(addr)
    ) {
      mockPins.push(addr);
    }
  },
  clearPinnedRemoteIPs: () => {
    mockPins.splice(0, mockPins.length);
  },
  getPinnedRemoteIPs: () => [...mockPins],
}));

import {getPinnedRemoteIPs} from '../utils';
import {
  getLanDiscoverySessionId,
  isLanDiscoveryActive,
  startLanDiscovery,
  stopLanDiscovery,
} from '../services/lanDiscovery';

function publisher() {
  return mockInstances[0];
}

function scanner() {
  return mockInstances[1];
}

beforeEach(() => {
  stopLanDiscovery();
  mockPins.splice(0, mockPins.length);
  for (const inst of mockInstances) {
    inst.publishService.mockClear();
    inst.unpublishService.mockClear();
    inst.stop.mockClear();
    inst.scan.mockClear();
    inst.on.mockClear();
  }
});

describe('lanDiscovery', () => {
  it('publishes a fresh session id, not a persistent device id', async () => {
    await startLanDiscovery();
    const first = getLanDiscoverySessionId();
    expect(first).toMatch(/^[0-9a-f]{16}$/);
    expect(publisher().publishService).toHaveBeenCalledWith(
      'http',
      'tcp',
      'local.',
      'bbw_scan',
      55056,
      {txt: 'bbw_scan', id: first},
      'NSD',
    );
    expect(scanner().scan).toHaveBeenCalledWith('http', 'tcp', 'local.');

    await startLanDiscovery();
    expect(publisher().publishService).toHaveBeenCalledTimes(1);

    stopLanDiscovery();
    await startLanDiscovery();
    const second = getLanDiscoverySessionId();
    expect(second).toMatch(/^[0-9a-f]{16}$/);
    expect(second).not.toBe(first);
  });

  it('pins other sessions and ignores its own announcement', async () => {
    await startLanDiscovery();
    const mine = getLanDiscoverySessionId();
    const resolved = scanner().handlers.resolved;
    resolved({
      txt: {txt: 'bbw_scan', id: mine},
      addresses: ['10.0.0.8'],
    });
    expect(getPinnedRemoteIPs()).toEqual([]);

    resolved({
      txt: {txt: 'bbw_scan', id: 'other-session'},
      addresses: ['10.0.0.9', 'fe80::1'],
    });
    expect(getPinnedRemoteIPs()).toEqual(['10.0.0.9']);
  });

  it('stops publishing, scanning, and pinned addresses', async () => {
    await startLanDiscovery();
    scanner().handlers.resolved({
      txt: {txt: 'bbw_scan', id: 'other-session'},
      addresses: ['10.0.0.9'],
    });
    expect(getPinnedRemoteIPs()).toEqual(['10.0.0.9']);

    stopLanDiscovery();

    expect(isLanDiscoveryActive()).toBe(false);
    expect(getLanDiscoverySessionId()).toBe('');
    expect(publisher().unpublishService).toHaveBeenCalledWith('bbw_scan', 'NSD');
    expect(scanner().stop).toHaveBeenCalled();
    expect(getPinnedRemoteIPs()).toEqual([]);
  });
});
