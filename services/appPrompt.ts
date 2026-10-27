import Toast from 'react-native-toast-message';

export type AppPromptIcon =
  | 'security'
  | 'warning'
  | 'delete'
  | 'dice'
  | 'paste'
  | 'fee'
  | 'sync'
  | 'network'
  | 'dev'
  | 'relay'
  | 'copy'
  | 'backup'
  | 'wallet';

export type AppPromptRequest = {
  icon: AppPromptIcon;
  title: string;
  hint?: string;
  /** Short mono line, such as an address or URL. */
  detail?: string;
  /** Large compare code. */
  code?: string;
  confirmLabel: string;
  cancelLabel?: string;
  tone: 'default' | 'danger';
  resolve: (ok: boolean) => void;
};

type PromptInput = Omit<AppPromptRequest, 'resolve' | 'tone'> & {
  tone?: 'default' | 'danger';
};

let active: AppPromptRequest | null = null;
const queue: AppPromptRequest[] = [];
const listeners = new Set<(current: AppPromptRequest | null) => void>();

function emit() {
  listeners.forEach(listener => listener(active));
}

function pump() {
  if (active || queue.length === 0) {
    return;
  }
  active = queue.shift() ?? null;
  emit();
}

export function subscribeAppPrompt(
  listener: (current: AppPromptRequest | null) => void,
): () => void {
  listeners.add(listener);
  listener(active);
  return () => {
    listeners.delete(listener);
  };
}

export function currentAppPrompt(): AppPromptRequest | null {
  return active;
}

export function respondAppPrompt(ok: boolean) {
  const current = active;
  if (!current) {
    return;
  }
  active = null;
  current.resolve(ok);
  emit();
  pump();
}

export function confirmAppPrompt(input: PromptInput): Promise<boolean> {
  return new Promise(resolve => {
    queue.push({
      ...input,
      tone: input.tone ?? 'default',
      resolve,
    });
    pump();
  });
}

function noticeTone(title: string): 'success' | 'error' | 'info' {
  if (/copied|saved|success|switched|now on/i.test(title)) {
    return 'success';
  }
  if (
    /error|fail|wrong|invalid|could not|timeout|unavailable|denied|missing|nothing|please wait|insufficient|unsupported/i.test(
      title,
    )
  ) {
    return 'error';
  }
  return 'info';
}

/** One-tap message. Long copy is shortened so the toast stays a glance. */
export function showAppNotice(title: string, message?: string) {
  const text2 = message?.replace(/\s+/g, ' ').trim();
  Toast.show({
    type: noticeTone(title),
    text1: title,
    text2: text2 ? text2.slice(0, 140) : undefined,
    visibilityTime: text2 && text2.length > 80 ? 4500 : 2800,
  });
}
