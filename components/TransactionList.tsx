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
  TouchableOpacity,
  Image,
} from 'react-native';
import axios from 'axios';
import Toast from 'react-native-toast-message';
import moment from 'moment';
import EncryptedStorage from 'react-native-encrypted-storage';
import {dbg, presentFiat} from '../utils';
import {useTheme} from '@react-navigation/native';
import {themes} from '../theme';
import TransactionListSkeleton from './TransactionListSkeleton';
import {WalletService} from '../services/WalletService';
import TransactionDetailsModal from './TransactionDetailsModal';

// Add icon imports
const inIcon = require('../assets/in-icon.png');
const outIcon = require('../assets/out-icon.png');
const consolidateIcon = require('../assets/consolidate-icon.png');
const linkIcon = require('../assets/link-icon.png');
const pendingIcon = require('../assets/pending-icon.png');

interface TransactionListProps {
  address: string;
  baseApi: string;
  onUpdate: (pendingTxs: any[], pending: number) => Promise<any>;
  initialTransactions?: any[];
  selectedCurrency?: string;
  btcRate?: number;
  getCurrencySymbol?: (currency: string) => string;
}

const TransactionList: React.FC<TransactionListProps> = ({
  address,
  baseApi,
  onUpdate,
  initialTransactions = [],
  selectedCurrency = 'USD',
  btcRate = 0,
  getCurrencySymbol = currency => currency,
}) => {
  const [transactions, setTransactions] = useState<any[]>(initialTransactions);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [lastSeenTxId, setLastSeenTxId] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [hasMoreTransactions, setHasMoreTransactions] = useState(true);
  const isFetching = useRef(false);
  const [selectedTransaction, setSelectedTransaction] = useState<any>(null);
  const [isDetailsModalVisible, setIsDetailsModalVisible] = useState(false);

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

  // Memoize fetchTransactions to prevent unnecessary re-renders
  const memoizedFetchTransactions = useCallback(
    async (url: string | undefined) => {
      dbg('memoizedFetchTransactions...');

      // Prevent multiple simultaneous fetches
      if (isFetching.current) {
        dbg('Fetch already in progress, skipping');
        // Clear refresh state if this was a refresh attempt
        if (isRefreshing) {
          setIsRefreshing(false);
        }
        return;
      }

      // Set loading state
      if (isMounted.current) {
        setLoading(true);
        isFetching.current = true;
      }

      // Cancel any ongoing requests
      if (abortController.current) {
        abortController.current.abort();
      }
      abortController.current = new AbortController();

      // Function to load from cache
      const loadFromCache = async () => {
        dbg('Loading from cache...');
        const cachedTransactions =
          await WalletService.getInstance().transactionsFromCache(address);
        if (isMounted.current) {
          // No need to update cache when loading from cache
          setTransactions(cachedTransactions);
          setHasMoreTransactions(cachedTransactions.length > 0);
          if (cachedTransactions.length > 0) {
            setLastSeenTxId(
              cachedTransactions[cachedTransactions.length - 1].txid,
            );
          }
          // Clear refresh state when loading from cache
          setIsRefreshing(false);
        }
      };

      try {
        if (!url) {
          await loadFromCache();
          return;
        }

        // Construct proper API URL
        const cleanBaseApi = url.replace(/\/+$/, '').replace(/\/api\/?$/, '');
        const apiUrl = `${cleanBaseApi}/api/address/${address}/txs`;
        dbg('Starting fetch transactions from:', apiUrl);

        // Set a timeout to fall back to cache if API takes too long
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('API timeout')), 10000); // Increased timeout to 10s
        });

        const response = (await Promise.race([
          axios.get(apiUrl, {
            signal: abortController.current.signal,
            timeout: 10000, // Increased timeout to 10s
          }),
          timeoutPromise,
        ])) as {data: any[]};

        if (!isMounted.current) {
          dbg('Component unmounted, skipping state updates');
          return;
        }

        const cached = JSON.parse(
          (await EncryptedStorage.getItem('pendingTxs')) || '{}',
        );

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

        // Update cache
        response.data.forEach((tx: any) => {
          if (cached[tx.txid]) {
            delete cached[tx.txid];
            EncryptedStorage.setItem('pendingTxs', JSON.stringify(cached));
          }
        });

        // Add cached transactions
        for (const txID in cached) {
          const validTxID = /^[a-fA-F0-9]{64}$/.test(txID);
          if (!validTxID) {
            delete cached[txID];
          } else {
            response.data.unshift({
              txid: txID,
              from: cached[txID].from,
              to: cached[txID].to,
              amount: cached[txID].satoshiAmount,
              satoshiAmount: cached[txID].satoshiAmount,
              satoshiFees: cached[txID].satoshiFees,
              sentAt: cached[txID].sentAt,
              status: {
                confirmed: false,
                block_height: null,
              },
            });
          }
        }

        await onUpdate(pendingTxs, pending);

        // Filter out duplicates, keeping confirmed transactions over pending ones
        const uniqueTransactions = response.data.reduce(
          (acc: any[], tx: any) => {
            const existingTx = acc.find(t => t.txid === tx.txid);
            if (!existingTx) {
              acc.push(tx);
            } else {
              // If we have a duplicate, keep the confirmed one
              const existingIsPending =
                !existingTx.status || !existingTx.status.confirmed;
              const newIsPending = !tx.status || !tx.status.confirmed;
              if (existingIsPending && !newIsPending) {
                // Replace pending with confirmed
                const index = acc.indexOf(existingTx);
                acc[index] = tx;
              }
            }
            return acc;
          },
          [],
        );

        const newTransactions = uniqueTransactions.sort((a: any, b: any) => {
          // If either transaction is pending (no status or no block_height), prioritize it
          const aIsPending = !a.status || !a.status.block_height;
          const bIsPending = !b.status || !b.status.block_height;

          if (aIsPending && !bIsPending) return -1; // a is pending, show it first
          if (!aIsPending && bIsPending) return 1; // b is pending, show it first
          if (aIsPending && bIsPending) {
            // If both are pending, sort by sentAt timestamp if available
            const aTime = a.sentAt || 0;
            const bTime = b.sentAt || 0;
            return bTime - aTime; // Most recent pending first
          }

          // For confirmed transactions, sort by block height
          return (b.status.block_height || 0) - (a.status.block_height || 0);
        });

        WalletService.getInstance().updateTransactionsCache(
          address,
          newTransactions,
        );

        if (isMounted.current) {
          setTransactions(newTransactions);
          setHasMoreTransactions(newTransactions.length > 0);
          if (newTransactions.length > 0) {
            setLastSeenTxId(newTransactions[newTransactions.length - 1].txid);
          }
          // Clear refresh state on successful API response
          setIsRefreshing(false);
        }
      } catch (error: any) {
        dbg('got error', error);
        if (error.name === 'CanceledError') {
          dbg('Request canceled');
          // Clear refresh state on cancel
          if (isMounted.current) {
            setIsRefreshing(false);
          }
        } else {
          console.error('Error fetching transactions:', error);
          if (isMounted.current) {
            Toast.show({
              type: 'error',
              text1: 'Error loading transactions',
              text2: 'Using offline cache',
            });
            // Always fallback to cache on any error
            await loadFromCache();
          }
        }
      } finally {
        if (isMounted.current) {
          isFetching.current = false;
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [address, getTransactionAmounts, onUpdate, isRefreshing],
  );

  // Fix transaction refresh handling
  const handleRefresh = useCallback(async () => {
    if (isRefreshing || isFetching.current) {
      return;
    }
    setIsRefreshing(true);
    try {
      await memoizedFetchTransactions(baseApi);
    } catch (error) {
      // Error is already handled in memoizedFetchTransactions
    } finally {
      if (isMounted.current) {
        setIsRefreshing(false);
      }
    }
  }, [baseApi, isRefreshing, memoizedFetchTransactions]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isMounted.current = false;
      if (abortController.current) {
        abortController.current.abort();
      }
    };
  }, []);

  // Fix transaction refresh handling
  useEffect(() => {
    let mounted = true;
    let refreshInterval: NodeJS.Timeout | null = null;
    const controller = new AbortController();
    abortController.current = controller;

    const fetchData = async () => {
      if (!mounted || isFetching.current || isRefreshing) {
        dbg('Skipping fetch - conditions not met:', {
          mounted,
          isFetching: isFetching.current,
          isRefreshing,
        });
        return;
      }

      try {
        dbg('Starting fetch transactions');
        await memoizedFetchTransactions(baseApi);
      } catch (error: any) {
        if (error.name !== 'CanceledError') {
          dbg('Error in fetch:', error);
        }
      }
    };

    // Initial fetch
    if (!isFetching.current && !isRefreshing) {
      fetchData();
    }

    // Set up refresh interval
    refreshInterval = setInterval(() => {
      if (mounted && !isFetching.current && !isRefreshing) {
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
      // Reset states on cleanup
      isFetching.current = false;
      setLoading(false);
      setIsRefreshing(false);
    };
  }, [address, baseApi, memoizedFetchTransactions, isRefreshing]);

  // Memoized transaction status checker
  const getTransactionStatus = useCallback(
    (tx: any) => {
      const isSending =
        !!tx?.sentAt ||
        !!tx.vin.some(
          (input: any) => input.prevout.scriptpubkey_address === address,
        );

      if (tx.sentAt || !tx.status.confirmed) {
        return {
          confirmed: false,
          text: isSending ? 'Sending' : 'Receiving',
          icon: pendingIcon,
        };
      }

      return {
        confirmed: true,
        text: isSending ? 'Sent' : 'Received',
        icon: isSending ? outIcon : inIcon,
      };
    },
    [address],
  );

  // Debounced fetch more implementation
  const fetchMore = useCallback(async () => {
    if (loadingMore || !isMounted.current) {
      dbg('Skipping fetch more - conditions not met:', {
        loadingMore,
        isMounted: isMounted.current,
      });
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
      // Only set hasMoreTransactions to false if we get no new transactions
      if (newTransactions.length === 0) {
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
              satoshiAmount: cached[txID].satoshiAmount,
              satoshiFees: cached[txID].satoshiFees,
              sentAt: cached[txID].sentAt,
              status: {
                confirmed: false,
                block_height: null,
              },
            });
          }
        }

        onUpdate(pendingTxs, pending);
        dbg('Updated pending transactions in fetch more');

        const txs = [...prevTransactions, ...filteredTransactions];

        dbg('Caching transactions:', txs.length);
        WalletService.getInstance().updateTransactionsCache(
          address,
          txs,
          false, // isFromCache
        );

        return txs;
      });

      // Only update lastSeenTxId if we have new transactions
      if (newTransactions.length > 0) {
        setLastSeenTxId(newTransactions[newTransactions.length - 1].txid);
        dbg(
          'Set new last seen txid:',
          newTransactions[newTransactions.length - 1].txid,
        );
      }
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
    },
    list: {
      flex: 1,
      backgroundColor: colors.card,
    },
    listContent: {
      flexGrow: 1,
      paddingBottom: 20,
    },
    transactionItem: {
      padding: 12,
      marginVertical: 4,
      backgroundColor: colors.card,
      borderRadius: 10,
      elevation: 1,
      shadowColor: '#000',
      shadowOffset: {width: 0, height: 1},
      shadowOpacity: 0.05,
      shadowRadius: 1,
      borderWidth: 1,
      borderColor: 'rgba(0, 0, 0, 0.05)',
    },
    transactionRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginVertical: 2,
    },
    endOfListText: {
      textAlign: 'center',
      fontSize: 16,
      color: colors.text,
      padding: 10,
    },
    status: {
      fontSize: 15,
      fontWeight: '600',
      color: colors.text,
      opacity: 0.9,
    },
    amount: {
      fontSize: 17,
      fontWeight: '700',
      color: colors.text,
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      opacity: 0.95,
    },
    fiatAmount: {
      fontSize: 13,
      color: colors.text,
      opacity: 0.6,
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    },
    address: {
      fontSize: 13,
      color: colors.text,
      opacity: 0.6,
      flex: 1,
      marginRight: 8,
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    },
    addressLink: {
      color: colors.primary,
      textDecorationLine: 'none',
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      opacity: 0.9,
    },
    txId: {
      fontSize: 12,
      color: colors.text,
      opacity: 0.5,
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    },
    timestamp: {
      fontSize: 12,
      color: colors.text,
      opacity: 0.5,
    },
    txLink: {
      color: colors.primary,
      textDecorationLine: 'none',
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      opacity: 0.9,
    },
    emptyContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      padding: 20,
    },
    emptyText: {
      fontSize: 15,
      color: colors.text,
      textAlign: 'center',
      opacity: 0.7,
    },
    addressRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginVertical: 2,
    },
    statusContainer: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    statusIcon: {
      width: 20,
      height: 20,
      marginRight: 8,
    },
    txIdContainer: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    linkIcon: {
      width: 16,
      height: 16,
      marginRight: 4,
    },
  });

  // Memoized render item with currency support
  const renderItem = useCallback(
    ({item}: any) => {
      const {
        text: status,
        confirmed,
        icon: statusIcon,
      } = getTransactionStatus(item);
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

      // Get the relevant address based on transaction type
      const relevantAddress = status.includes('Sen')
        ? item?.vout?.find(
            (output: any) => output.scriptpubkey_address !== address,
          )?.scriptpubkey_address
        : item?.vin?.find(
            (input: any) => input.prevout.scriptpubkey_address !== address,
          )?.prevout?.scriptpubkey_address;

      const addressExplorerLink = relevantAddress
        ? `${baseUrl}/address/${relevantAddress}`
        : '';

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
      let finalIcon = statusIcon;

      if (sent === 0 && received === changeAmount) {
        finalStatus = confirmed ? 'Consolidated UTXOs' : 'Consolidating UTXOs';
        info = `+${formatBtcAmount(received)} BTC`;
        finalIcon = confirmed ? consolidateIcon : pendingIcon;
      }

      // Calculate amount in selected currency with proper formatting
      const getFiatAmount = (btcAmount: number) => {
        if (!btcRate || btcRate <= 0) {
          return '0.00';
        }
        const amount = btcAmount * btcRate;
        return presentFiat(amount);
      };

      const fiatAmount = status.includes('Sen')
        ? getFiatAmount(sent)
        : getFiatAmount(received);

      return (
        <TouchableOpacity
          style={styles.transactionItem}
          activeOpacity={0.7}
          onPress={() => {
            setSelectedTransaction(item);
            setIsDetailsModalVisible(true);
          }}>
          <View style={styles.transactionRow}>
            <View style={styles.statusContainer}>
              <Image source={finalIcon} style={styles.statusIcon} />
              <Text style={styles.status}>{finalStatus}</Text>
            </View>
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
                  style={styles.addressLink}
                  onPress={() => {
                    dbg('Opening address explorer:', addressExplorerLink);
                    Linking.openURL(addressExplorerLink);
                  }}>
                  {relevantAddress.slice(0, 6)}...{relevantAddress.slice(-4)}
                </Text>
              </Text>
              <Text style={styles.fiatAmount}>
                {getCurrencySymbol(selectedCurrency)}
                {fiatAmount}
              </Text>
            </View>
          )}
          <View style={styles.transactionRow}>
            <View style={styles.txIdContainer}>
              <Image source={linkIcon} style={styles.linkIcon} />
              <Text style={styles.txId}>
                <Text style={styles.txLink}>0x{shortTxId}</Text>
              </Text>
            </View>
            <Text style={styles.timestamp}>{timestamp}</Text>
          </View>
        </TouchableOpacity>
      );
    },
    [
      getTransactionStatus,
      getTransactionAmounts,
      address,
      baseApi,
      styles,
      selectedCurrency,
      btcRate,
      getCurrencySymbol,
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
    <SafeAreaView
      style={[styles.container, {backgroundColor: colors.background}]}>
      <FlatList
        style={styles.list}
        contentContainerStyle={styles.listContent}
        data={transactions}
        renderItem={renderItem}
        keyExtractor={item => {
          const isPending = !item.status || !item.status.confirmed;
          const timestamp = item.sentAt || item.status?.block_time || 0;
          return `${item.txid}-${
            isPending ? 'pending' : 'confirmed'
          }-${timestamp}`;
        }}
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
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={handleRefresh}
            colors={[colors.primary]}
            tintColor={colors.primary}
            progressBackgroundColor={colors.card}
            progressViewOffset={0}
            enabled={true}
          />
        }
      />
      {selectedTransaction && (
        <TransactionDetailsModal
          visible={isDetailsModalVisible}
          transaction={selectedTransaction}
          onClose={() => {
            setIsDetailsModalVisible(false);
            setSelectedTransaction(null);
          }}
          baseApi={baseApi}
          selectedCurrency={selectedCurrency}
          btcRate={btcRate}
          getCurrencySymbol={getCurrencySymbol}
          address={address}
          status={
            selectedTransaction
              ? (() => {
                  const {text: status, confirmed} =
                    getTransactionStatus(selectedTransaction);
                  const {sent, changeAmount, received} = getTransactionAmounts(
                    selectedTransaction,
                    address,
                  );
                  let finalStatus = status;
                  if (sent === 0 && received === changeAmount) {
                    finalStatus = confirmed
                      ? 'Consolidated UTXOs'
                      : 'Consolidating UTXOs';
                  }
                  return {
                    confirmed,
                    text: finalStatus,
                  };
                })()
              : null
          }
          amounts={
            selectedTransaction
              ? getTransactionAmounts(selectedTransaction, address)
              : null
          }
        />
      )}
      <Toast config={{}} />
    </SafeAreaView>
  );
};

export default TransactionList;
