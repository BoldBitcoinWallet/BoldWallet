import {Alert} from 'react-native';
import {
  completeCeremonyToken,
  isCeremonyAuthRejection,
  newCeremonySessionID,
  releaseCeremonyToken,
  requestConfigCeremonyToken,
} from './ceremonyAuth';

export {isCeremonyAuthRejection};
import {resolveStoredMempoolApiBase} from './mempoolApiBase';
import {TssProvider} from './TssProvider';

/**
 * 3b-2d B15/B16: allowlist-or-token API application.
 *
 * Every setAPI/setFeeAPIs call site routes through here. The
 * native gate applies allowlisted URLs silently; unknown URLs
 * need a user-approved `config` ceremony (in-app URL confirm +
 * OS prompt), after which native persists the URL. Malicious JS
 * calling TssProvider.setAPI directly gets CEREMONY_AUTH_REQUIRED
 * for non-allowlisted hosts.
 */

export type ApiUrlConfirmFn = (urls: string[]) => Promise<boolean>;

/** In-app confirm showing the exact URLs (the OS prompt cannot). */
export function defaultConfirmApiUrls(urls: string[]): Promise<boolean> {
  return new Promise(resolve => {
    Alert.alert(
      'Allow API endpoint?',
      `BoldWallet wants to use a new API endpoint:\n${urls.join(
        '\n',
      )}\n\nOnly approve endpoints you trust.`,
      [
        {text: 'Cancel', style: 'cancel', onPress: () => resolve(false)},
        {text: 'Approve', onPress: () => resolve(true)},
      ],
      {cancelable: true, onDismiss: () => resolve(false)},
    );
  });
}

async function applyWithConfigApproval<T>(
  urls: string[],
  silentApply: () => Promise<T>,
  authedApply: (token: string, sessionID: string) => Promise<T>,
  // Null = caller already confirmed (settings save with the URL
  // on screen): mint directly without a second Alert.
  confirm: ApiUrlConfirmFn | null,
  deniedKey: string,
): Promise<T> {
  try {
    return await silentApply();
  } catch (error) {
    if (!isCeremonyAuthRejection(error)) {
      throw error;
    }
    if (confirm !== null) {
      // Silent first: a concurrent approval may have allowlisted
      // the URL while this call was in flight — but a prior
      // denial in this session short-circuits (no Alert spam).
      if (deniedApiUrls.has(deniedKey)) {
        throw new Error('API endpoint change was denied.');
      }
      if (!(await confirm(urls))) {
        deniedApiUrls.add(deniedKey);
        throw new Error('API endpoint change cancelled.');
      }
    }
    const sessionID = await newCeremonySessionID('config');
    const token = await requestConfigCeremonyToken(sessionID);
    try {
      const out = await authedApply(token, sessionID);
      deniedApiUrls.delete(deniedKey);
      try {
        await completeCeremonyToken(token);
      } catch {
        /* logged in ceremonyAuth; success stands */
      }
      return out;
    } catch (error2) {
      try {
        await releaseCeremonyToken(token);
      } catch {
        /* logged in ceremonyAuth */
      }
      throw error2;
    }
  }
}

/** URLs the user denied this session (no repeat Alerts). */
const deniedApiUrls = new Set<string>();

/** Same-URL approval dedup: concurrent applies share one Alert+mint. */
const inflightApprovals = new Map<string, Promise<unknown>>();

function deduped<T>(key: string, run: () => Promise<T>): Promise<T> {
  const inflight = inflightApprovals.get(key);
  if (inflight !== undefined) {
    return inflight as Promise<T>;
  }
  const started = run();
  inflightApprovals.set(key, started);
  return started.finally(() => {
    if (inflightApprovals.get(key) === started) {
      inflightApprovals.delete(key);
    }
  });
}

function normalizeKey(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

/**
 * Apply the mempool API base for a network (explicit URL or the
 * stored-or-default resolution). Silent for allowlisted URLs;
 * otherwise user-confirmed `config` ceremony (or direct mint
 * when confirm is null).
 */
export async function ensureMempoolApiApplied(
  network: string,
  url: string = resolveStoredMempoolApiBase(network),
  confirm: ApiUrlConfirmFn | null = defaultConfirmApiUrls,
): Promise<string> {
  const key = `setAPI:${normalizeKey(url)}`;
  return deduped(key, () =>
    applyWithConfigApproval(
      [url],
      () => TssProvider.setAPI(network, url),
      (token, sessionID) =>
        TssProvider.setAPI(network, url, token, sessionID),
      confirm,
      key,
    ),
  );
}

/** Apply fee API bases (array or CSV). Same rule as mempool base. */
export async function ensureFeeApisApplied(
  bases: string[] | string,
  confirm: ApiUrlConfirmFn | null = defaultConfirmApiUrls,
): Promise<string> {
  const list = (Array.isArray(bases) ? bases : bases.split(','))
    .map(s => s.trim())
    .filter(Boolean);
  const csv = list.join(',');
  const key = `setFeeAPIs:${csv}`;
  return deduped(key, () =>
    applyWithConfigApproval(
      list,
      () => TssProvider.setFeeAPIs(csv),
      (token, sessionID) => TssProvider.setFeeAPIs(csv, token, sessionID),
      confirm,
      key,
    ),
  );
}
