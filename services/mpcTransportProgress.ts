import type {MpcHookMessage} from './mpcProgress';

export type MpcTransportSubprogressState = {
  active: boolean;
  visible: boolean;
  /** 0–1 when determinate; null when indeterminate */
  fraction: number | null;
  label: string;
  chunk: number;
  total: number;
  transport: 'nostr' | 'lan';
};

export function emptyMpcTransportSubprogress(): MpcTransportSubprogressState {
  return {
    active: false,
    visible: false,
    fraction: null,
    label: '',
    chunk: 0,
    total: 1,
    transport: 'nostr',
  };
}

export function isTransportHookMessage(
  msg: MpcHookMessage,
): msg is MpcHookMessage & {
  type: 'transport';
  transport: string;
  chunk: number;
  total: number;
  active: boolean;
} {
  return msg.type === 'transport';
}

/** Map native transport hook to upload subprogress state (does not affect main MPC %). */
export function mapTransportHookToSubprogress(
  msg: MpcHookMessage,
): MpcTransportSubprogressState | null {
  if (!isTransportHookMessage(msg)) {
    return null;
  }
  const transport = msg.transport === 'lan' ? 'lan' : 'nostr';
  const total = Math.max(1, msg.total ?? 1);
  const chunk = Math.min(total, Math.max(0, msg.chunk ?? 0));
  const active = msg.active === true;

  if (!active) {
    return {
      active: false,
      visible: false,
      fraction: null,
      label: '',
      chunk,
      total,
      transport,
    };
  }

  const label =
    transport === 'lan'
      ? 'Sending to peer on LAN…'
      : total > 1
        ? `Publishing to Nostr (${chunk}/${total})…`
        : 'Publishing to Nostr…';

  const fraction = total > 1 ? chunk / total : null;

  return {
    active: true,
    visible: true,
    fraction,
    label,
    chunk,
    total,
    transport,
  };
}
