import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import AppText from './AppText';
import { useTheme } from '../theme';

type Props = {
  text: string;
  timestamp: number;
  isMine: boolean;
  senderLabel?: string;
};

function formatClock(ts: number): string {
  if (!Number.isFinite(ts) || ts <= 0) return '';
  try {
    return new Date(ts).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

const ChatBubble: React.FC<Props> = ({ text, timestamp, isMine, senderLabel }) => {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <View style={[styles.row, isMine ? styles.rowMine : styles.rowPeer]}>
      <View style={styles.block}>
        {!isMine && !!senderLabel && (
          <AppText style={styles.senderLabel}>{senderLabel}</AppText>
        )}
        <View style={[styles.bubble, isMine ? styles.mineBubble : styles.peerBubble]}>
        <AppText style={[styles.text, isMine ? styles.mineText : styles.peerText]}>
          {text}
        </AppText>
        <AppText style={[styles.time, isMine ? styles.mineTime : styles.peerTime]}>
          {formatClock(timestamp)}
        </AppText>
        </View>
      </View>
    </View>
  );
};

const createStyles = (theme: any) =>
  StyleSheet.create({
    row: {
      width: '100%',
      marginBottom: 8,
      flexDirection: 'row',
    },
    block: {
      maxWidth: '84%',
    },
    rowMine: {
      justifyContent: 'flex-end',
    },
    rowPeer: {
      justifyContent: 'flex-start',
    },
    bubble: {
      borderRadius: 14,
      paddingHorizontal: 12,
      paddingVertical: 9,
    },
    senderLabel: {
      fontSize: 11,
      color: theme.colors.textSecondary,
      marginBottom: 4,
      marginLeft: 2,
    },
    mineBubble: {
      backgroundColor: 'rgba(46, 134, 255, 0.20)',
      borderTopRightRadius: 6,
    },
    peerBubble: {
      backgroundColor: 'rgba(255, 255, 255, 0.10)',
      borderTopLeftRadius: 6,
    },
    text: {
      fontSize: 14,
      lineHeight: 19,
    },
    mineText: {
      color: theme.colors.text,
    },
    peerText: {
      color: theme.colors.text,
    },
    time: {
      marginTop: 6,
      fontSize: 11,
      alignSelf: 'flex-end',
    },
    mineTime: {
      color: 'rgba(255, 255, 255, 0.72)',
    },
    peerTime: {
      color: theme.colors.textSecondary,
    },
  });

export default ChatBubble;