import database from '../Database';
import { dbg } from '../../utils';

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
  threadCreatedAt: number;
  threadUpdatedAt: number;
}

class ChatRepository {
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
             (message_id, thread_id, sender_npub, content, timestamp, is_payload)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            message.messageId,
            message.threadId,
            message.senderNpub,
            message.content,
            message.timestamp,
            message.isPayload ? 1 : 0,
          ],
        );
      });
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
        threadCreatedAt: Number(row.created_at || 0),
        threadUpdatedAt: Number(row.updated_at || 0),
      }));
    } catch (err) {
      dbg('ChatRepository.getHydrationRows error', err);
      return [];
    }
  }
}

export default new ChatRepository();
