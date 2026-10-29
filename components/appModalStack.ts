/**
 * Which content modals are on screen. A prompt paints inside the top
 * one. Opening a second native modal on iOS never presents, so the
 * tap looks dead.
 */
let stack: number[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach(listener => listener());
}

export function pushAppModal(): number {
  const id = nextId++;
  stack = [...stack, id];
  emit();
  return id;
}

export function popAppModal(id: number) {
  stack = stack.filter(entry => entry !== id);
  emit();
}

export function isTopAppModal(id: number): boolean {
  return stack[stack.length - 1] === id;
}

export function hasOpenAppModal(): boolean {
  return stack.length > 0;
}

export function subscribeAppModalStack(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test-only. Production ids only move forward. */
export function resetAppModalStackForTests() {
  stack = [];
  nextId = 1;
  listeners.clear();
}
