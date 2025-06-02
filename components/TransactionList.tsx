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
  Platform,
} from 'react-native';
import axios, {all} from 'axios';
import Toast from 'react-native-toast-message';
import moment from 'moment';
import EncryptedStorage from 'react-native-encrypted-storage';
import {dbg} from '../utils';
import {useTheme} from '@react-navigation/native';
import {themes} from '../theme';
import TransactionListSkeleton from './TransactionListSkeleton';
import {WalletService} from '../services/WalletService';
import {add} from 'lodash';

interface TransactionListProps {
  refreshing: boolean;
  address: string;
  baseApi: string;
  onUpdate: (pendingTxs: any[], pending: number) => Promise<any>;
  onReload: () => Promise<any>;
  initialTransactions?: any[];
}

const TransactionList: React.FC<TransactionListProps> = ({
  refreshing,
  address,
  baseApi,
  onReload,
  onUpdate,
  initialTransactions = [],
}) => {
  const [transactions, setTransactions] = useState<any[]>(initialTransactions);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [lastSeenTxId, setLastSeenTxId] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [hasMoreTransactions, setHasMoreTransactions] = useState(true);
  const isFetching = useRef(false);

  const {colors} = useTheme();

  // Add refs to track mounting state and prevent memory leaks
  const isMounted = useRef(true);
  const abortController = useRef<AbortController | null>(null);

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

  const fetchTransactions = useCallback(
    async (url: string, retryCount = 0) => {
      if (refreshing || loading || !isMounted.current || isFetching.current) {
        dbg('Skipping fetch - already in progress or unmounted');
        return;
      }

      // Set our fetching ref
      isFetching.current = true;
      dbg('Starting fetch transactions from:', url, 'retry:', retryCount);

      // Cancel any ongoing requests
      if (abortController.current) {
        abortController.current.abort();
      }
      abortController.current = new AbortController();

      setLoading(true);
      try {
        dbg('Making request to:', url);
        const response = await axios.get(url, {
          signal: abortController.current.signal,
          timeout: 5000, // 10 second timeout
        });
        dbg('Received response:', response.data.length, 'transactions');

        if (!isMounted.current) {
          dbg('Component unmounted, skipping state updates');
          return;
        }

        const cached = JSON.parse(
          (await EncryptedStorage.getItem('pendingTxs')) || '{}',
        );
        dbg('Cached transactions:', Object.keys(cached).length);

        // Process pending transactions
        let pending = 0;
        let pendingTxs = response.data
          .filter((tx: any) => !tx.status || !tx.status.confirmed)
          .map((tx: any) => {
            const {sent} = getTransactionAmounts(tx, address);
            if (!isNaN(sent) && sent > 0) {
              pending += Number(sent);
            }
            return tx;
          });
        dbg('Pending transactions:', pendingTxs.length);

        // Update cache
        response.data.filter((tx: any) => {
          dbg('checking tx:', tx.txid);
          if (cached[tx.txid]) {
            delete cached[tx.txid];
            dbg('delete from cache', tx.txid);
            EncryptedStorage.setItem('pendingTxs', JSON.stringify(cached));
          }
        });

        // Add cached transactions
        for (const txID in cached) {
          dbg('prepending from cache', txID, cached[txID]);
          const validTxID = /^[a-fA-F0-9]{64}$/.test(txID);
          if (!validTxID) {
            delete cached[txID];
          } else {
            response.data.unshift({
              txid: txID,
              from: cached[txID].from,
              to: cached[txID].to,
              amount: cached[txID].satoshiAmount,
              sentAt: cached[txID].sentAt,
            });
          }
        }

        await onUpdate(pendingTxs, pending);
        dbg('Updated pending transactions');

        const newTransactions = response.data.sort(
          (a: any, b: any) => b.status.block_height - a.status.block_height,
        );
        dbg('Setting transactions:', newTransactions.length);

        WalletService.getInstance().updateTransactionsCache(
          address,
          newTransactions,
        );

        // Batch state updates
        if (isMounted.current) {
          setTransactions(newTransactions);
          setHasMoreTransactions(newTransactions.length > 0);
          if (newTransactions.length > 0) {
            setLastSeenTxId(newTransactions[newTransactions.length - 1].txid);
            dbg(
              'Set last seen txid:',
              newTransactions[newTransactions.length - 1].txid,
            );
          }
        }
      } catch (error: any) {
        dbg('got error', error);
        if (error.name === 'CanceledError') {
          dbg('Request canceled');
        } else if (retryCount < 3) {
          // Retry on timeout
          dbg('Request timed out, retrying...');
          if (isMounted.current) {
            setTimeout(() => {
              fetchTransactions(url, retryCount + 1);
            }, 1000 * (retryCount + 1)); // Exponential backoff
          }
        } else {
          console.error('Error fetching transactions:', error);
          dbg('Error details:', error.message);
          if (isMounted.current) {
            Toast.show({
              type: 'error',
              text1: 'Error loading transactions',
              text2: 'Please try again later',
            });
          }
        }
      } finally {
        if (isMounted.current && retryCount === 0) {
          isFetching.current = false;
          setLoading(false);
          dbg('Fetch completed, loading:', false);
        }
      }
    },
    [refreshing, loading, getTransactionAmounts, onUpdate, address],
  );

  // Fix transaction refresh handling
  useEffect(() => {
    let mounted = true;
    let refreshInterval: NodeJS.Timeout | null = null;
    const controller = new AbortController();
    abortController.current = controller;

    const fetchData = async () => {
      if (!mounted || refreshing || loading || isFetching.current) {
        dbg('Skipping fetch - conditions not met');
        return;
      }

      try {
        dbg('Starting fetch transactions');
        const cleanBaseApi = baseApi.replace(/\/+$/, '');
        await fetchTransactions(`${cleanBaseApi}/address/${address}/txs`);
      } catch (error) {
        dbg('Error in fetch:', error);
      }
    };

    // Initial fetch
    fetchData();

    // Set up refresh interval
    refreshInterval = setInterval(() => {
      if (mounted && !refreshing && !loading && !isFetching.current) {
        fetchData();
      }
    }, 30000); // Refresh every 30 seconds

    return () => {
      dbg('Cleaning up fetch effect');
      mounted = false;
      if (refreshInterval) {
        clearInterval(refreshInterval);
      }
      if (abortController.current) {
        abortController.current.abort();
      }
    };
  }, [address, baseApi]); // Remove dependencies that cause re-renders

  // Optimized refresh handler
  const onRefresh = useCallback(async () => {
    if (isRefreshing || loading || isFetching.current || !isMounted.current) {
      return;
    }

    setIsRefreshing(true);
    try {
      const cleanBaseApi = baseApi.replace(/\/+$/, '');
      await fetchTransactions(`${cleanBaseApi}/address/${address}/txs`);
      if (onReload) {
        await onReload();
      }
    } finally {
      if (isMounted.current) {
        setIsRefreshing(false);
      }
    }
  }, [address, baseApi, fetchTransactions, isRefreshing, loading, onReload]);

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

  // Debounced fetch more implementation
  const fetchMore = useCallback(async () => {
    if (
      loadingMore ||
      !lastSeenTxId ||
      !hasMoreTransactions ||
      !isMounted.current
    ) {
      dbg('Skipping fetch more - conditions not met');
      return;
    }

    dbg('Starting fetch more from:', lastSeenTxId);
    setLoadingMore(true);
    try {
      // Ensure baseApi doesn't end with a slash and add a single slash
      const cleanBaseApi = baseApi.replace(/\/+$/, '');
      const response = await axios.get(
        `${cleanBaseApi}/address/${address}/txs/chain/${lastSeenTxId}`,
        {
          signal: abortController.current?.signal,
        },
      );
      dbg('Received more transactions:', response.data.length);

      if (!isMounted.current) {
        dbg('Component unmounted during fetch more');
        return;
      }

      const newTransactions = response.data;
      if (newTransactions.length <= 1) {
        dbg('No more transactions to load');
        setHasMoreTransactions(false);
        return;
      }

      const cached = JSON.parse(
        (await EncryptedStorage.getItem('pendingTxs')) || '{}',
      );
      dbg('Cached transactions for fetch more:', Object.keys(cached).length);

      setTransactions(prevTransactions => {
        const existingIds = new Set(prevTransactions.map(tx => tx.txid));
        const filteredTransactions = newTransactions.filter(
          (tx: any) => !existingIds.has(tx.txid),
        );
        dbg('New unique transactions:', filteredTransactions.length);

        // Process pending transactions
        let pending = 0;
        let pendingTxs = filteredTransactions
          .filter((tx: any) => !tx.status || !tx.status.confirmed)
          .map((tx: any) => {
            const {sent} = getTransactionAmounts(tx, address);
            if (!isNaN(sent) && sent > 0) {
              pending += Number(sent);
            }
            return tx;
          });
        dbg('New pending transactions:', pendingTxs.length);

        // Update cache
        filteredTransactions.filter((tx: any) => {
          dbg('checking tx in fetch more:', tx.txid);
          if (cached[tx.txid]) {
            delete cached[tx.txid];
            dbg('delete from cache in fetch more', tx.txid);
            EncryptedStorage.setItem('pendingTxs', JSON.stringify(cached));
          }
        });

        // Add cached transactions
        for (const txID in cached) {
          dbg('prepending from cache in fetch more', txID, cached[txID]);
          const validTxID = /^[a-fA-F0-9]{64}$/.test(txID);
          if (!validTxID) {
            delete cached[txID];
          } else {
            filteredTransactions.unshift({
              txid: txID,
              from: cached[txID].from,
              to: cached[txID].to,
              amount: cached[txID].satoshiAmount,
              sentAt: cached[txID].sentAt,
            });
          }
        }

        onUpdate(pendingTxs, pending);
        dbg('Updated pending transactions in fetch more');

        const txs = [...prevTransactions, ...filteredTransactions];

        WalletService.getInstance().updateTransactionsCache(address, txs);

        return txs;
      });

      setLastSeenTxId(newTransactions[newTransactions.length - 1].txid);
      dbg(
        'Set new last seen txid:',
        newTransactions[newTransactions.length - 1].txid,
      );
    } catch (error: any) {
      if (error.name !== 'CanceledError') {
        console.error('Error fetching more transactions:', error);
        dbg('Error details in fetch more:', error.message);
        Toast.show({
          type: 'error',
          text1: 'Error loading more transactions',
        });
      }
    } finally {
      if (isMounted.current) {
        setLoadingMore(false);
        dbg('Fetch more completed, loading more:', false);
      }
    }
  }, [
    loadingMore,
    lastSeenTxId,
    hasMoreTransactions,
    address,
    baseApi,
    getTransactionAmounts,
    onUpdate,
  ]);

  // Add effect to handle initialTransactions changes
  useEffect(() => {
    if (initialTransactions && initialTransactions.length > 0) {
      setTransactions(initialTransactions);
    }
  }, [initialTransactions]);

  const styles = StyleSheet.create({
    container: {
      flex: 1,
      paddingLeft: 16,
      paddingRight: 16,
    },
    transactionItem: {
      padding: 16,
      margin: 4,
      backgroundColor: colors.card,
      borderRadius: 12,
      elevation: 3,
      shadowColor: '#000',
      shadowOffset: {width: 0, height: 2},
      shadowOpacity: 0.1,
      shadowRadius: 4,
    },
    transactionRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginVertical: 4,
    },
    endOfListText: {
      textAlign: 'center',
      fontSize: 16,
      color: colors.text,
      padding: 10,
    },
    status: {
      fontSize: 16,
      fontWeight: '600',
      color: colors.text,
    },
    amount: {
      fontSize: 18,
      fontWeight: '700',
      color: colors.text,
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    },
    usdAmount: {
      fontSize: 14,
      color: colors.text,
      opacity: 0.7,
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    },
    address: {
      fontSize: 14,
      color: colors.text,
      opacity: 0.7,
      flex: 1,
      marginRight: 8,
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    },
    addressLink: {
      color: colors.text,
      textDecorationLine: 'underline',
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    },
    txId: {
      fontSize: 13,
      color: colors.text,
      opacity: 0.6,
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    },
    timestamp: {
      fontSize: 13,
      color: colors.text,
      opacity: 0.6,
    },
    txLink: {
      color: colors.text,
      textDecorationLine: 'underline',
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    },
    emptyContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      padding: 20,
    },
    emptyText: {
      fontSize: 16,
      color: colors.text,
      textAlign: 'center',
    },
    addressRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginVertical: 4,
    },
  });

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
      const baseUrl = baseApi.replace(/\/+$/, '').replace(/\/api\/?$/, '');
      const explorerLink = `${baseUrl}/tx/${item.txid}`;

      // Format BTC amount with proper precision and grouping
      const formatBtcAmount = (amount: number) => {
        const formatted = amount.toFixed(8);
        const [whole, decimal] = formatted.split('.');
        return `${Number(whole).toLocaleString()}.${decimal}`;
      };

      let info = status.includes('Sen')
        ? `-${formatBtcAmount(sent)} BTC`
        : `+${formatBtcAmount(received)} BTC`;
      let finalStatus = status;

      if (sent === 0 && received === changeAmount) {
        finalStatus = confirmed
          ? '🔂 Consolidated UTXOs'
          : '🔂 Consolidating UTXOs';
        info = `+${formatBtcAmount(received)} BTC`;
      }

      // Get the relevant address based on transaction type
      const relevantAddress = status.includes('Sen')
        ? item.vout.find(
            (output: any) => output.scriptpubkey_address !== address,
          )?.scriptpubkey_address
        : item.vin.find(
            (input: any) => input.prevout.scriptpubkey_address !== address,
          )?.prevout.scriptpubkey_address;

      const shortAddress = relevantAddress
        ? `${relevantAddress.slice(0, 6)}...${relevantAddress.slice(-4)}`
        : '';

      const addressExplorerLink = relevantAddress
        ? `${baseUrl}/address/${relevantAddress}`
        : '';

      // Calculate USD amount (assuming 1 BTC = $40,000 for now)
      const btcRate = 40000; // This should come from props or context
      const usdAmount = status.includes('Sen')
        ? (sent * btcRate).toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })
        : (received * btcRate).toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          });

      return (
        <View style={styles.transactionItem}>
          <View style={styles.transactionRow}>
            <Text style={styles.status}>{finalStatus}</Text>
            <Text
              style={[
                styles.amount,
                status.includes('Sen')
                  ? {color: themes.cryptoVibrant.colors.accent}
                  : {color: themes.cryptoVibrant.colors.secondary},
              ]}>
              {info}
            </Text>
          </View>
          {relevantAddress && (
            <View style={styles.addressRow}>
              <Text style={styles.address}>
                {status.includes('Sen') ? 'To: ' : 'From: '}
                <Text
                  style={[styles.addressLink, {color: colors.text}]}
                  onPress={() => {
                    dbg('Opening address explorer:', addressExplorerLink);
                    Linking.openURL(addressExplorerLink);
                  }}>
                  {shortAddress}
                </Text>
              </Text>
              <Text style={styles.usdAmount}>${usdAmount}</Text>
            </View>
          )}
          <View style={styles.transactionRow}>
            <Text style={styles.txId}>
              🔗
              <Text
                style={[styles.txLink, {color: colors.text}]}
                onPress={() => {
                  dbg('Opening transaction explorer:', explorerLink);
                  Linking.openURL(explorerLink);
                }}>
                0x{shortTxId}
              </Text>
            </Text>
            <Text style={styles.timestamp}>{timestamp}</Text>
          </View>
        </View>
      );
    },
    [
      getTransactionStatus,
      getTransactionAmounts,
      address,
      baseApi,
      styles.transactionItem,
      styles.transactionRow,
      styles.status,
      styles.amount,
      styles.addressRow,
      styles.address,
      styles.addressLink,
      styles.usdAmount,
      styles.txId,
      styles.txLink,
      styles.timestamp,
      colors.text,
    ],
  );

  const renderEmptyComponent = useCallback(() => {
    if (loading) {
      return <TransactionListSkeleton />;
    }
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>No transactions yet</Text>
      </View>
    );
  }, [loading, styles.emptyContainer, styles.emptyText]);

  return (
    <SafeAreaView style={styles.container}>
      <FlatList
        data={transactions}
        renderItem={renderItem}
        keyExtractor={item => item.txid}
        onEndReached={hasMoreTransactions ? fetchMore : null}
        onEndReachedThreshold={0.5}
        ListEmptyComponent={renderEmptyComponent}
        ListFooterComponent={
          loadingMore ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : !hasMoreTransactions && transactions.length > 0 ? (
            <Text style={styles.endOfListText}>End of Transactions</Text>
          ) : null
        }
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />
        }
      />
      <Toast config={{}} />
    </SafeAreaView>
  );
};

export default TransactionList;
