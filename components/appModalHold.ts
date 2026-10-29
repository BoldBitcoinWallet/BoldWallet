/**
 * iOS keeps a full-screen modal host after `visible` goes false until
 * `onDismiss`. Dismissing during the open animation never fires that
 * callback, so the host stays and eats every touch. Hold the modal up
 * only while it still has something to show and present has not finished.
 * An empty modal is never held.
 */
export function shouldHoldIosModal(input: {
  os: string;
  visible: boolean;
  hasContent: boolean;
  opened: boolean;
  presented: boolean;
}): boolean {
  return (
    input.os === 'ios' &&
    !input.visible &&
    input.hasContent &&
    input.opened &&
    !input.presented
  );
}
