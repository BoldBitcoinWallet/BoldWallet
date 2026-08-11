import database from '../Database';
import { dbg } from '../../utils';
import { DeviceEventEmitter } from 'react-native';

export type ChatThreadType = 'cosign' | 'direct';
export type ChatThreadStatus = 'pending' | 'approved' | 'closed';

export interface ChatThreadRecord {
  threadId: string;
  peerNpub: string;
  threadType: ChatThreadType;
  status: ChatThreadStatus;
  createdAt: number;
  updatedAt: number;
}

export interface ChatMessageRecord {
  messageId: string;
  threadId: string;
  senderNpub: string;
  content: string;
  timestamp: number;
  isPayload: boolean;
  isRead: boolean;
}

export interface ChatHydrationRow {
  messageId: string;
  threadId: string;
  peerNpub: string;
  threadType: ChatThreadType;
  status: ChatThreadStatus;
  senderNpub: string;
  content: string;
  timestamp: number;
  isPayload: boolean;
  isRead: boolean;
  threadCreatedAt: number;
  threadUpdatedAt: number;
}

type UnreadCountRow = {
  threadId: string;
  unreadCount: number;
};

type CoSignRequestContext = {
  txId: string;
  traceId?: string;
  recipientAddress: string;
  amountSats: number;
  feeSats: number;
  network: string;
  utxosJson?: string;
  changeAddress?: string;
  senderDerivationPath?: string;
  senderAddressType?: string;
  signingNpubsCSV?: string;
  txTemplateHash?: string;
  utxoSetHash?: string;
  senderNpub: string;
  peerNpub: string;
  messageId: string;
  threadId: string;
  timestamp: number;
};

class ChatRepository {
  private extractTxIdFromThreadId(threadId: string): string {
    const key = String(threadId || '').trim();
    if (!key.startsWith('tx:')) return '';

    const txTraceMatch = key.match(/^tx:([^:]+):trace:.+$/);
    if (txTraceMatch?.[1]) return txTraceMatch[1].trim();

    const txHashMatch = key.match(/^tx:([^:]+):h:[^:]+$/);
    if (txHashMatch?.[1]) return txHashMatch[1].trim();

    const txOnlyMatch = key.match(/^tx:([^:]+)$/);
    if (txOnlyMatch?.[1]) return txOnlyMatch[1].trim();

    return '';
  }

  private notifyUnreadChanged(): void {
    DeviceEventEmitter.emit('chat:unread-changed', { ts: Date.now() });
  }

  upsertThread(thread: ChatThreadRecord): void {
    try {
      database.execute(
        `INSERT INTO chat_threads
           (thread_id, peer_npub, thread_type, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(thread_id) DO UPDATE SET
           peer_npub = excluded.peer_npub,
           thread_type = excluded.thread_type,
           status = excluded.status,
           updated_at = excluded.updated_at`,
        [
          thread.threadId,
          thread.peerNpub,
          thread.threadType,
          thread.status,
          thread.createdAt,
          thread.updatedAt,
        ],
      );
    } catch (err) {
      dbg('ChatRepository.upsertThread error', err);
    }
  }

  hasMessageId(messageId: string): boolean {
    try {
      const trimmed = String(messageId || '').trim();
      if (!trimmed) return false;
      const { rows } = database.execute(
        `SELECT 1 AS hit
         FROM chat_messages
         WHERE message_id = ?
         LIMIT 1`,
        [trimmed],
      );
      return rows.length > 0;
    } catch (err) {
      dbg('ChatRepository.hasMessageId error', err);
      return false;
    }
  }

  upsertThreadAndMessage(thread: ChatThreadRecord, message: ChatMessageRecord): void {
    try {
      database.transaction(svc => {
        svc.execute(
          `INSERT INTO chat_threads
             (thread_id, peer_npub, thread_type, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(thread_id) DO UPDATE SET
             peer_npub = excluded.peer_npub,
             thread_type = excluded.thread_type,
             status = excluded.status,
             updated_at = excluded.updated_at`,
          [
            thread.threadId,
            thread.peerNpub,
            thread.threadType,
            thread.status,
            thread.createdAt,
            thread.updatedAt,
          ],
        );

        svc.execute(
          `INSERT OR IGNORE INTO chat_messages
             (message_id, thread_id, sender_npub, content, timestamp, is_payload, is_read)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            message.messageId,
            message.threadId,
            message.senderNpub,
            message.content,
            message.timestamp,
            message.isPayload ? 1 : 0,
            message.isRead ? 1 : 0,
          ],
        );
      });
      this.notifyUnreadChanged();
    } catch (err) {
      dbg('ChatRepository.upsertThreadAndMessage error', err);
    }
  }

  setThreadStatus(threadId: string, status: ChatThreadStatus, updatedAt: number): void {
    try {
      database.execute(
        `UPDATE chat_threads
           SET status = ?, updated_at = ?
         WHERE thread_id = ?`,
        [status, updatedAt, threadId],
      );
    } catch (err) {
      dbg('ChatRepository.setThreadStatus error', err);
    }
  }

  getHydrationRows(minUpdatedAt: number): ChatHydrationRow[] {
    try {
      const { rows } = database.execute(
        `SELECT
           m.message_id,
           m.thread_id,
           t.peer_npub,
           t.thread_type,
           t.status,
           m.sender_npub,
           m.content,
           m.timestamp,
           m.is_payload,
            m.is_read,
           t.created_at,
           t.updated_at
         FROM chat_messages m
         JOIN chat_threads t ON t.thread_id = m.thread_id
         WHERE t.updated_at >= ?
         ORDER BY m.timestamp DESC`,
        [minUpdatedAt],
      );

      return rows.map(row => ({
        messageId: String(row.message_id || ''),
        threadId: String(row.thread_id || ''),
        peerNpub: String(row.peer_npub || ''),
        threadType: (row.thread_type === 'cosign' ? 'cosign' : 'direct') as ChatThreadType,
        status: (
          row.status === 'approved' || row.status === 'closed' ? row.status : 'pending'
        ) as ChatThreadStatus,
        senderNpub: String(row.sender_npub || ''),
        content: String(row.content || ''),
        timestamp: Number(row.timestamp || 0),
        isPayload: Number(row.is_payload || 0) === 1,
        isRead: Number(row.is_read || 0) === 1,
        threadCreatedAt: Number(row.created_at || 0),
        threadUpdatedAt: Number(row.updated_at || 0),
      }));
    } catch (err) {
      dbg('ChatRepository.getHydrationRows error', err);
      return [];
    }
  }

  markThreadAsRead(threadId: string): void {
    try {
      const trimmed = String(threadId || '').trim();
      if (!trimmed) return;
      const txId = this.extractTxIdFromThreadId(trimmed);
      const txBase = txId ? `tx:${txId}` : '';
      const txPrefixLike = txBase ? `${txBase}:%` : '';

      database.execute(
        `UPDATE chat_messages
           SET is_read = 1
         WHERE is_read = 0
           AND (
             thread_id = ?
             OR (? <> '' AND (thread_id = ? OR thread_id LIKE ?))
           )`,
        [trimmed, txBase, txBase, txPrefixLike],
      );
      this.notifyUnreadChanged();
    } catch (err) {
      dbg('ChatRepository.markThreadAsRead error', err);
    }
  }

  getTotalUnreadCount(): number {
    try {
      const { rows } = database.execute(
        `SELECT COUNT(1) AS unread_count
         FROM chat_messages
         WHERE is_read = 0`,
      );
      return Number(rows?.[0]?.unread_count || 0);
    } catch (err) {
      dbg('ChatRepository.getTotalUnreadCount error', err);
      return 0;
    }
  }

  getUnreadCountByThread(): UnreadCountRow[] {
    try {
      const { rows } = database.execute(
        `SELECT thread_id, COUNT(1) AS unread_count
         FROM chat_messages
         WHERE is_read = 0
         GROUP BY thread_id`,
      );
      return rows.map(row => ({
        threadId: String(row.thread_id || ''),
        unreadCount: Number(row.unread_count || 0),
      }));
    } catch (err) {
      dbg('ChatRepository.getUnreadCountByThread error', err);
      return [];
    }
  }

  findLatestCoSignRequestContext(criteria: {
    txId?: string;
    traceId?: string;
  }): CoSignRequestContext | null {
    try {
      const txId = String(criteria.txId || '').trim();
      const traceId = String(criteria.traceId || '').trim();
      if (!txId && !traceId) return null;

      const txLike = `%"txId":"${txId}"%`;
      const traceLike = `%"traceId":"${traceId}"%`;
      const { rows } = database.execute(
        `SELECT
           m.message_id,
           m.thread_id,
           m.sender_npub,
           m.content,
           m.timestamp,
           t.peer_npub
         FROM chat_messages m
         JOIN chat_threads t ON t.thread_id = m.thread_id
         WHERE m.is_payload = 1
           AND ((? <> '' AND m.content LIKE ?) OR (? <> '' AND m.content LIKE ?))
         ORDER BY m.timestamp DESC
         LIMIT 40`,
        [txId, txLike, traceId, traceLike],
      );

      for (const row of rows) {
        const content = String(row.content || '');
        if (!content) continue;
        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(content) as Record<string, unknown>;
        } catch {
          continue;
        }

        const rowTxId =
          typeof payload.txId === 'string' ? payload.txId.trim() : '';
        const rowTraceId =
          typeof payload.traceId === 'string' ? payload.traceId.trim() : '';
        const matchByTx = txId && rowTxId === txId;
        const matchByTrace = traceId && rowTraceId === traceId;
        if (!matchByTx && !matchByTrace) continue;

        const recipientAddress =
          typeof payload.recipientAddress === 'string'
            ? payload.recipientAddress.trim()
            : '';
        const amountSats = Number(payload.amountSats);
        const feeSats = Number(payload.feeSats);
        if (!recipientAddress || !Number.isFinite(amountSats)) continue;

        const utxosJson =
          typeof payload.utxosJson === 'string' ? payload.utxosJson.trim() : '';
        const changeAddress =
          typeof payload.changeAddress === 'string'
            ? payload.changeAddress.trim()
            : '';
        const senderDerivationPath =
          typeof payload.senderDerivationPath === 'string'
            ? payload.senderDerivationPath.trim()
            : '';
        const senderAddressType =
          typeof payload.senderAddressType === 'string'
            ? payload.senderAddressType.trim()
            : '';
        const signingNpubsCSV =
          typeof payload.signingNpubsCSV === 'string'
            ? payload.signingNpubsCSV.trim()
            : '';
        const txTemplateHash =
          typeof payload.txTemplateHash === 'string'
            ? payload.txTemplateHash.trim()
            : '';
        const utxoSetHash =
          typeof payload.utxoSetHash === 'string'
            ? payload.utxoSetHash.trim()
            : '';

        return {
          txId: rowTxId,
          traceId: rowTraceId || undefined,
          recipientAddress,
          amountSats,
          feeSats: Number.isFinite(feeSats) ? feeSats : 0,
          network:
            typeof payload.network === 'string' && payload.network.trim()
              ? payload.network.trim()
              : 'mainnet',
          utxosJson: utxosJson || undefined,
          changeAddress: changeAddress || undefined,
          senderDerivationPath: senderDerivationPath || undefined,
          senderAddressType: senderAddressType || undefined,
          signingNpubsCSV: signingNpubsCSV || undefined,
          txTemplateHash: txTemplateHash || undefined,
          utxoSetHash: utxoSetHash || undefined,
          senderNpub: String(row.sender_npub || ''),
          peerNpub: String(row.peer_npub || ''),
          messageId: String(row.message_id || ''),
          threadId: String(row.thread_id || ''),
          timestamp: Number(row.timestamp || 0),
        };
      }
      return null;
    } catch (err) {
      dbg('ChatRepository.findLatestCoSignRequestContext error', err);
      return null;
    }
  }
}

export default new ChatRepository();
