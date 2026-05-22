import {getHardeningFlags, isHardeningEnabled} from '../services/hardening';

describe('hardening flags', () => {
  const envBackup: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of [
      'HARDENING',
      'HARDENING_OFF',
      'HARDENING_SAFE_CANCEL',
      'HARDENING_NOSTR_CANCEL_NOOP_OK',
      'HARDENING_CANCEL_TELEMETRY',
      'NODE_ENV',
    ]) {
      envBackup[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(envBackup)) {
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }
  });

  it('enables all flags in production by default', () => {
    process.env.NODE_ENV = 'production';
    const dev = (global as {__DEV__?: boolean}).__DEV__;
    (global as {__DEV__?: boolean}).__DEV__ = false;
    expect(isHardeningEnabled()).toBe(true);
    const flags = getHardeningFlags();
    expect(flags.safeCancel).toBe(true);
    expect(flags.nostrCancelNoopOk).toBe(true);
    expect(flags.cancelTelemetry).toBe(true);
    (global as {__DEV__?: boolean}).__DEV__ = dev;
  });

  it('disables all when HARDENING_OFF=1', () => {
    process.env.HARDENING_OFF = '1';
    expect(isHardeningEnabled()).toBe(false);
    const flags = getHardeningFlags();
    expect(flags.safeCancel).toBe(false);
    expect(flags.nostrCancelNoopOk).toBe(false);
    expect(flags.cancelTelemetry).toBe(false);
  });

  it('disables when HARDENING=0', () => {
    process.env.HARDENING = '0';
    expect(isHardeningEnabled()).toBe(false);
  });

  it('can disable safe cancel only via HARDENING_SAFE_CANCEL=0', () => {
    process.env.HARDENING_SAFE_CANCEL = '0';
    const flags = getHardeningFlags();
    expect(flags.safeCancel).toBe(false);
    expect(flags.nostrCancelNoopOk).toBe(true);
    expect(flags.cancelTelemetry).toBe(true);
  });

  it('can disable telemetry only via HARDENING_CANCEL_TELEMETRY=0', () => {
    process.env.HARDENING_CANCEL_TELEMETRY = '0';
    const flags = getHardeningFlags();
    expect(flags.cancelTelemetry).toBe(false);
    expect(flags.safeCancel).toBe(true);
  });
});
