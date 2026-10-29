/**
 * Bonjour publish + scan for LAN pairing. Runs only while a pairing
 * session is active. The TXT id is a fresh session tag, not a device id.
 */
import Zeroconf, {ImplType} from 'react-native-zeroconf';
import {ensureLanDiscoveryPermission} from './lanDiscoveryPermissions';
import {clearPinnedRemoteIPs, dbg, pinRemoteIP} from '../utils';

const SERVICE_TYPE = 'http';
const SERVICE_PROTOCOL = 'tcp';
const SERVICE_DOMAIN = 'local.';
const SERVICE_NAME = 'bbw_scan';
const SERVICE_PORT = 55056;

type ResolvedService = {
  fullName?: string;
  addresses?: string[];
  txt?: {txt?: string; id?: string};
};

let publisher: Zeroconf | null = null;
let scanner: Zeroconf | null = null;
let sessionId = '';
let active = false;
let generation = 0;

function newSessionId(): string {
  let hex = '';
  for (let i = 0; i < 16; i++) {
    hex += Math.floor(Math.random() * 16).toString(16);
  }
  return hex;
}

function publisherInstance(): Zeroconf {
  if (!publisher) {
    publisher = new Zeroconf();
  }
  return publisher;
}

function scannerInstance(): Zeroconf {
  if (!scanner) {
    scanner = new Zeroconf();
  }
  return scanner;
}

export function isLanDiscoveryActive(): boolean {
  return active;
}

/** Current session tag, empty when discovery is not running. */
export function getLanDiscoverySessionId(): string {
  return sessionId;
}

function pinResolved(service: ResolvedService): void {
  dbg('lanDiscovery: service', service.fullName);
  const txt = service.txt;
  if (!txt || txt.txt !== SERVICE_NAME || !txt.id || txt.id === sessionId) {
    return;
  }
  for (const address of service.addresses || []) {
    pinRemoteIP(address);
  }
  dbg('lanDiscovery: pinned', service.addresses);
}

/**
 * Publish and scan until stopLanDiscovery. A second call while active
 * keeps the current session. A stop during the permission prompt aborts.
 */
export async function startLanDiscovery(): Promise<void> {
  if (active) {
    return;
  }
  const gen = ++generation;
  clearPinnedRemoteIPs();
  const nextSessionId = newSessionId();
  await ensureLanDiscoveryPermission();
  if (gen !== generation) {
    return;
  }
  sessionId = nextSessionId;
  const out = publisherInstance();
  out.publishService(
    SERVICE_TYPE,
    SERVICE_PROTOCOL,
    SERVICE_DOMAIN,
    SERVICE_NAME,
    SERVICE_PORT,
    {txt: SERVICE_NAME, id: sessionId},
    ImplType.NSD,
  );
  const scan = scannerInstance();
  scan.removeAllListeners();
  scan.on('resolved', pinResolved);
  scan.on('error', (err: unknown) => {
    dbg('lanDiscovery: scan error', String(err));
  });
  scan.scan(SERVICE_TYPE, SERVICE_PROTOCOL, SERVICE_DOMAIN);
  if (gen !== generation) {
    teardown();
    return;
  }
  active = true;
  dbg('lanDiscovery: started');
}

function teardown(): void {
  sessionId = '';
  active = false;
  clearPinnedRemoteIPs();
  try {
    publisher?.unpublishService(SERVICE_NAME, ImplType.NSD);
    publisher?.stop();
  } catch (err) {
    dbg('lanDiscovery: unpublish error', err);
  }
  try {
    scanner?.removeAllListeners();
    scanner?.stop();
  } catch (err) {
    dbg('lanDiscovery: scan stop error', err);
  }
}

/** Unpublish, stop scanning, and drop pinned addresses. Safe if idle. */
export function stopLanDiscovery(): void {
  generation += 1;
  teardown();
  dbg('lanDiscovery: stopped');
}
