import React, {useEffect, useState, useCallback, useRef} from 'react';
import {
  SafeAreaView,
  FlatList,
  Text,
  StyleSheet,
  View,
  ActivityIndicator,
  RefreshControl,
  Linking,
} from 'react-native';
import axios from 'axios';
import Toast from 'react-native-toast-message';
import moment from 'moment';
import theme from '../theme';
import {debounce} from 'lodash';
import EncryptedStorage from 'react-native-encrypted-storage';
import {dbg} from '../utils';

const TransactionList = ({
  address,
  baseApi,
  onReload,
  onUpdate,
}: {
  address: string;
  baseApi: string;
  onUpdate: (pendingTxs: any[], pending: number) => Promise<any>;
  onReload: () => Promise<any>;
}) => {
  const [transactions, setTransactions] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [lastSeenTxId, setLastSeenTxId] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [hasMoreTransactions, setHasMoreTransactions] = useState(true);
  const isFetching = useRef(false);

  // Add refs to track mounting state and prevent memory leaks
  const isMounted = useRef(true);
  const abortController = useRef<AbortController | null>(null);

  function updatePendings(txs: any[], cached: any) {
    dbg('cached', cached);
    let pending = 0;
    let pendingTxs = txs
      .filter(tx => !tx.status || !tx.status.confirmed)
      .map(tx => {
        const {sent} = getTransactionAmounts(tx, address);
        if (!isNaN(sent) && sent > 0) {
          pending += Number(sent);
        }
        return tx;
      });

    txs.filter(tx => {
      dbg('checking tx:', tx.txid);
      if (cached[tx.txid]) {
        delete cached[tx.txid];
        dbg('delete from cache', tx.txid);
        EncryptedStorage.setItem('pendingTxs', JSON.stringify(cached));
      }
    });

    // rany push pending-cached
    for (const txID in cached) {
      dbg('prepending from cache', txID, cached[txID]);
      txs.unshift({
        txid: txID,
        from: cached[txID].from,
        to: cached[txID].to,
        amount: cached[txID].satoshiAmount,
        sentAt: cached[txID].sentAt,
      });
    }

    onUpdate(pendingTxs, pending);

    return txs;
  }

  const fetchTransactions = useCallback(async (url: string) => {
    // Check both loading state and our ref
    if (loading || !isMounted.current || isFetching.current) {
      dbg('Skipping duplicate fetch...');
      return;
    }

    // Set our fetching ref
    isFetching.current = true;
    dbg('fetching...');

    // Cancel any ongoing requests
    if (abortController.current) {
      abortController.current.abort();
    }
    abortController.current = new AbortController();

    setLoading(true);
    try {
      const response = await axios.get(url, {
        signal: abortController.current.signal,
      });
      if (isMounted.current) {
        const cached = JSON.parse(
          (await EncryptedStorage.getItem('pendingTxs')) || '{}',
        );
        const newTransactions = updatePendings(
          response.data.sort(
            (a: any, b: any) => b.status.block_height - a.status.block_height,
          ),
          cached,
        );
        setTransactions(newTransactions);
        setHasMoreTransactions(newTransactions.length > 0);
        if (newTransactions.length > 0) {
          setLastSeenTxId(newTransactions[newTransactions.length - 1].txid);
        }
      }
    } catch (error: any) {
      if (error.name === 'CanceledError') {
        dbg('Request canceled');
      } else {
        console.error('Error fetching transactions:', error);
        Toast.show({
          type: 'error',
          text1: 'Error loading transactions',
          text2: 'Please try again later',
        });
      }
    } finally {
      if (isMounted.current) {
        setLoading(false);
        isFetching.current = false;
      }
    }
  }, []);

  // Modify the initial useEffect to handle cleanup properly
  useEffect(() => {
    let ignore = false;

    const initialFetch = async () => {
      if (!ignore) {
        await fetchTransactions(`${baseApi}/address/${address}/txs`);
      }
    };

    initialFetch();

    return () => {
      ignore = true;
      if (abortController.current) {
        abortController.current.abort();
      }
    };
  }, [address, baseApi, fetchTransactions]);
  // Debounced fetch more implementation
  const debouncedFetchMore = useCallback(
    debounce(async () => {
      if (
        loadingMore ||
        !lastSeenTxId ||
        !hasMoreTransactions ||
        !isMounted.current
      ) {
        return;
      }

      setLoadingMore(true);
      try {
        const response = await axios.get(
          `${baseApi}/address/${address}/txs/chain/${lastSeenTxId}`,
          {
            signal: abortController.current?.signal,
          },
        );

        if (!isMounted.current) {
          return;
        }

        const newTransactions = response.data;
        if (newTransactions.length <= 1) {
          setHasMoreTransactions(false);
          return;
        }

        const cached = JSON.parse(
          (await EncryptedStorage.getItem('pendingTxs')) || '{}',
        );

        setTransactions(prevTransactions => {
          const existingIds = new Set(prevTransactions.map(tx => tx.txid));
          const filteredTransactions = newTransactions.filter(
            (tx: any) => !existingIds.has(tx.txid),
          );
          const txs = [...prevTransactions, ...filteredTransactions];
          updatePendings(txs, cached);
          return txs;
        });

        setLastSeenTxId(newTransactions[newTransactions.length - 1].txid);
      } catch (error: any) {
        if (error.name !== 'CanceledError') {
          console.error('Error fetching more transactions:', error);
          Toast.show({
            type: 'error',
            text1: 'Error loading more transactions',
          });
        }
      } finally {
        if (isMounted.current) {
          setLoadingMore(false);
        }
      }
    }, 500),
    [loadingMore, lastSeenTxId, hasMoreTransactions, address, baseApi],
  );

  // Optimized refresh handler
  const onRefresh = useCallback(async () => {
    if (isRefreshing) {
      return;
    }

    setIsRefreshing(true);
    await fetchTransactions(`${baseApi}/address/${address}/txs`);
    setIsRefreshing(false);
    if (onReload) {
      onReload();
    }
  }, [address, baseApi, fetchTransactions, isRefreshing, onReload]);

  // Initial fetch
  useEffect(() => {
    fetchTransactions(`${baseApi}/address/${address}/txs`);
  }, [address, baseApi, fetchTransactions]);

  // Memoized transaction amount calculator
  const getTransactionAmounts = useCallback((tx: any, addr: string) => {
    if (tx.sentAt) {
      const self =
        String(tx.from).toLowerCase() === String(tx.to).toLowerCase();
      const sent = self ? 0 : tx.amount;
      const chng = self ? sent : 0;
      const rcvd = self ? sent : 0;
      return {
        sent: tx.amount / 1e8,
        changeAmount: chng / 1e8,
        received: rcvd / 1e8,
      };
    }

    const sentAmount = tx.vin.reduce((total: number, input: any) => {
      return input.prevout.scriptpubkey_address === addr
        ? total + input.prevout.value
        : total;
    }, 0);

    const receivedAmount = tx.vout.reduce((total: number, output: any) => {
      return output.scriptpubkey_address === addr
        ? total + output.value
        : total;
    }, 0);

    const changeAmount = tx.vout.reduce((total: number, output: any) => {
      return sentAmount > 0 && output.scriptpubkey_address === addr
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
  }, []);

  // Memoized transaction status checker
  const getTransactionStatus = useCallback(
    (tx: any) => {
      if (tx.sentAt) {
        return {
          confirmed: false,
          text: '⏳ Sending',
        };
      }
      if (!tx.status.confirmed) {
        return {
          confirmed: false,
          text: tx.vin.some(
            (input: any) => input.prevout.scriptpubkey_address === address,
          )
            ? '⏳ Sending'
            : '⏳ Receiving',
        };
      }
      return {
        confirmed: true,
        text: tx.vin.some(
          (input: any) => input.prevout.scriptpubkey_address === address,
        )
          ? '↗️ Sent'
          : '↘️ Received',
      };
    },
    [address],
  );

  // Memoized render item
  const renderItem = useCallback(
    ({item}: any) => {
      const {text: status, confirmed} = getTransactionStatus(item);
      const {sent, changeAmount, received} = getTransactionAmounts(
        item,
        address,
      );

      const txTime = item.sentAt || item.status.block_time * 1000;
      const txConf = item.sentAt ? false : item.status.confirmed;

      const timestamp = txConf
        ? txTime < Date.now()
          ? moment(txTime).fromNow()
          : 'Recently confirmed'
        : 'Pending confirmation';

      const shortTxId = `${item.txid.slice(0, 4)}...${item.txid.slice(-4)}`;
      const explorerLink = `${baseApi.replace('api', '')}tx/${item.txid}`;

      let info = status.includes('Sen')
        ? `-${sent.toFixed(8)} BTC`
        : `+${received.toFixed(8)} BTC`;
      let finalStatus = status;

      if (sent === 0 && received === changeAmount) {
        finalStatus = confirmed
          ? '🔂 Consolidated UTXOs'
          : '🔂 Consolidating UTXOs';
        info = `+${received} BTC`;
      }

      return (
        <View style={styles.transactionItem}>
          <View style={styles.transactionRow}>
            <Text style={styles.status}>{finalStatus}</Text>
            <Text style={styles.amount}>{info}</Text>
          </View>
          <View style={styles.transactionRow}>
            <Text style={styles.txId}>
              🔗
              <Text
                style={styles.txLink}
                onPress={() => Linking.openURL(explorerLink)}>
                0x{shortTxId}
              </Text>
            </Text>
            <Text style={styles.timestamp}>{timestamp}</Text>
          </View>
        </View>
      );
    },
    [address, baseApi, getTransactionStatus, getTransactionAmounts],
  );

  return (
    <SafeAreaView style={styles.container}>
      {loading ? (
        <ActivityIndicator size="large" color={theme.colors.secondary} />
      ) : (
        <FlatList
          data={transactions}
          renderItem={renderItem}
          keyExtractor={item => item.txid}
          onEndReached={hasMoreTransactions ? debouncedFetchMore : null}
          onEndReachedThreshold={0.5}
          ListFooterComponent={
            loadingMore ? (
              <ActivityIndicator size="small" color={theme.colors.secondary} />
            ) : !hasMoreTransactions ? (
              <Text style={styles.endOfListText}>End of Transactions</Text>
            ) : null
          }
          refreshControl={
            <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />
          }
        />
      )}
      <Toast config={{}} />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 10,
    backgroundColor: theme.colors.background,
  },
  transactionItem: {
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#ddd',
    marginBottom: 10,
  },
  transactionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  endOfListText: {
    textAlign: 'center',
    fontSize: 16,
    color: theme.colors.text,
    padding: 10,
  },
  status: {
    fontSize: 16,
    fontWeight: 'bold',
    color: theme.colors.text,
  },
  amount: {
    fontSize: 16,
    fontWeight: 'bold',
    color: theme.colors.secondary,
  },
  txId: {
    fontSize: 14,
    marginTop: 8,
    color: theme.colors.text,
  },
  timestamp: {
    fontSize: 14,
    color: theme.colors.text,
  },
  txLink: {
    color: theme.colors.secondary,
    textDecorationLine: 'underline',
  },
});

export default TransactionList;
