/**
 * Pure helpers shared by TransactionList — mempool tx shape is loosely typed
 * to match API/DB payloads without forcing a full schema here.
 */

/** Shared sort: pending (no block_height) first, then block_height descending. */
export function sortMempoolTransactionsForDisplay(txs: any[]): any[] {
  return [...txs].sort((a, b) => {
    const aPending = !a.status?.block_height;
    const bPending = !b.status?.block_height;
    if (aPending && !bPending) {
      return -1;
    }
    if (!aPending && bPending) {
      return 1;
    }
    if (aPending && bPending) {
      return (b.sentAt || 0) - (a.sentAt || 0);
    }
    return (b.status.block_height || 0) - (a.status.block_height || 0);
  });
}

export function getMempoolTransactionAmounts(
  tx: any,
  isOurAddress: (addr: string) => boolean,
  addrOrAddrs?: string | string[],
): {sent: number; changeAmount: number; received: number} {
  const checkAddr = (a: string) =>
    addrOrAddrs
      ? Array.isArray(addrOrAddrs)
        ? addrOrAddrs.includes(a)
        : a === addrOrAddrs
      : isOurAddress(a);
  if (tx.sentAt) {
    const self =
      String(tx.from).toLowerCase() === String(tx.to).toLowerCase();
    const sentLocal = self ? 0 : tx.amount;
    const chng = self ? sentLocal : 0;
    const rcvd = self ? sentLocal : 0;
    return {
      sent: tx.amount / 1e8,
      changeAmount: chng / 1e8,
      received: rcvd / 1e8,
    };
  }
  const sentAmount = tx.vin.reduce((total: number, input: any) => {
    return checkAddr(input.prevout?.scriptpubkey_address || '')
      ? total + (input.prevout?.value || 0)
      : total;
  }, 0);
  const receivedAmount = tx.vout.reduce((total: number, output: any) => {
    return checkAddr(output.scriptpubkey_address || '')
      ? total + output.value
      : total;
  }, 0);
  const changeAmount = tx.vout.reduce((total: number, output: any) => {
    return sentAmount > 0 && checkAddr(output.scriptpubkey_address || '')
      ? total + output.value
      : total;
  }, 0);
  const fee = tx.fee || 0;
  const finalSentAmount = Math.max(0, sentAmount - changeAmount - fee);
  return {
    sent: finalSentAmount / 1e8,
    changeAmount: changeAmount / 1e8,
    received: receivedAmount / 1e8,
  };
}
