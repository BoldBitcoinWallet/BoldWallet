import React from 'react';
import {View, StyleSheet} from 'react-native';
import AppPressable from './AppPressable';
import AppText from './AppText';
import FeeRateSlider from './FeeRateSlider';
import {useTheme} from '../theme';
import {dbg} from '../utils';
import {fetchFeeRates, type FeeRates} from '../services/feeUtils';
import utxoRepository from '../services/repositories/UtxoRepository';
import {scriptPubKeyFromAddress} from '../utils/scriptPubKeyFromAddress';
import {
  DUST_SATS,
  buildRbfCancel,
  buildRbfSpeedUp,
  quoteReplacement,
  type ExtraCoin,
  type RbfEligibility,
  type RbfSendPayload,
} from '../services/rbfBuilder';

type Mode = 'speedup' | 'cancel';

interface RbfModalProps {
  visible: boolean;
  mode: Mode;
  eligibility: RbfEligibility;
  network: string;
  addressType: string;
  baseApi: string;
  btcRate: number;
  currencySymbol: string;
  onClose: () => void;
  onConfirm: (payload: RbfSendPayload) => void;
  onSuggestCancel?: () => void;
}

function extrasFor(network: string, addressType: string): ExtraCoin[] {
  return utxoRepository
    .getUtxosForNetwork(network, addressType)
    .filter(u => u.isConfirmed && u.valueSats > DUST_SATS && u.derivationPath)
    .map(u => ({
      txid: u.txid,
      vout: u.vout,
      value: u.valueSats,
      address: u.address,
      derivationPath: u.derivationPath || '',
      scriptpubkey: u.scriptPubkey || scriptPubKeyFromAddress(u.address) || '',
    }));
}

const RbfModal: React.FC<RbfModalProps> = ({
  visible,
  mode,
  eligibility,
  network,
  addressType,
  baseApi,
  btcRate,
  currencySymbol,
  onClose,
  onConfirm,
  onSuggestCancel,
}) => {
  const {theme} = useTheme();
  const [rates, setRates] = React.useState<FeeRates | null>(null);
  const [rate, setRate] = React.useState(0);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const extras = React.useMemo(
    () => (visible ? extrasFor(network, addressType) : []),
    [visible, network, addressType],
  );

  const quote = React.useMemo(
    () =>
      quoteReplacement({
        mode,
        eligibility,
        rate: Math.max(1, rate),
        addressType,
        extraUtxos: extras,
        freshChangeAddress: 'pending-change',
        selfAddress: 'pending-self',
      }),
    [mode, eligibility, rate, addressType, extras],
  );

  const plan = quote.plan;
  const minRate = quote.minRate;
  const amountCap =
    mode === 'speedup'
      ? eligibility.shrinkRecipient
        ? Math.floor(eligibility.inputSum / 2)
        : eligibility.recipient?.value ?? quote.minFee
      : Math.max(quote.minFee, Math.floor(eligibility.inputSum / 2));
  const vsize = plan.ok ? plan.vsize : Math.max(1, eligibility.origVsize);
  const maxByAmount = Math.max(minRate, Math.floor(amountCap / vsize));
  const usefulTop = Math.max(
    minRate,
    Math.ceil(eligibility.origFeeRate) + 50,
    rates?.fastestFee ?? 0,
  );
  const maxRate = Math.min(10000, maxByAmount, usefulTop);

  React.useEffect(() => {
    if (!visible) {
      return;
    }
    let cancelled = false;
    setRates(null);
    fetchFeeRates(baseApi)
      .then(next => {
        if (cancelled) {
          return;
        }
        setRates(next);
        const seeded = Math.max(minRate, next.fastestFee || minRate);
        setRate(Math.min(maxRate, seeded));
      })
      .catch(() => {
        if (!cancelled) {
          setRate(minRate);
          setRates({
            fastestFee: minRate,
            halfHourFee: minRate,
            hourFee: minRate,
            economyFee: minRate,
            minimumFee: 1,
            fetchedAt: Date.now(),
          });
        }
      });
    return () => {
      cancelled = true;
    };
    // Seed once each time the sheet opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, baseApi, mode]);

  React.useEffect(() => {
    if (rate > 0 && (rate < minRate || rate > maxRate)) {
      setRate(Math.min(maxRate, Math.max(minRate, rate)));
    }
  }, [minRate, maxRate, rate]);

  const feeSats = quote.feeSats;
  const shownRate = plan.ok ? plan.feeRate : rate;
  const fiat = btcRate > 0 ? ((feeSats / 1e8) * btcRate).toFixed(2) : null;
  const loading = rates == null;
  const accent =
    theme.colors.background === '#ffffff'
      ? theme.colors.primary
      : theme.colors.bitcoinOrange;

  const chips: Array<{label: string; value: number}> = [
    {label: 'Next block', value: Math.max(minRate, rates?.fastestFee ?? minRate)},
    {label: '30 min', value: Math.max(minRate, rates?.halfHourFee ?? minRate)},
    {
      label: '+10 sat/vB',
      value: Math.min(maxRate, Math.max(minRate, Math.ceil(eligibility.origFeeRate + 10))),
    },
  ];

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const built =
        mode === 'speedup'
          ? await buildRbfSpeedUp({
              eligibility,
              feeSats,
              addressType,
              network,
            })
          : await buildRbfCancel({
              eligibility,
              feeSats,
              addressType,
              network,
            });
      if (!built.ok) {
        setError(built.reason);
        return;
      }
      onConfirm(built);
    } catch (err) {
      dbg('RbfModal: prepare failed', err);
      setError('Could not prepare the replacement.');
    } finally {
      setBusy(false);
    }
  };

  const styles = React.useMemo(
    () =>
      StyleSheet.create({
        card: {
          marginTop: 12,
          borderRadius: 16,
          padding: 16,
          backgroundColor: theme.colors.cardBackground,
          borderWidth: 1,
          borderColor: theme.colors.border,
          gap: 12,
        },
        row: {flexDirection: 'row', justifyContent: 'space-between', gap: 12},
        value: {flexShrink: 1, textAlign: 'right'},
        chips: {flexDirection: 'row', flexWrap: 'wrap', gap: 8},
        chip: {
          paddingHorizontal: 12,
          paddingVertical: 8,
          borderRadius: 999,
          backgroundColor: theme.colors.background,
          borderWidth: 1,
          borderColor: theme.colors.border,
        },
        chipOn: {
          backgroundColor: accent,
          borderColor: accent,
        },
        chipText: {color: theme.colors.textSecondary},
        chipTextOn: {color: theme.colors.white},
        actions: {flexDirection: 'row', gap: 8, marginTop: 4},
        btn: {
          flex: 1,
          paddingVertical: 12,
          borderRadius: 12,
          alignItems: 'center',
          backgroundColor: theme.colors.background,
          borderWidth: 1,
          borderColor: theme.colors.border,
        },
        primary: {
          backgroundColor: accent,
          borderColor: accent,
        },
        danger: {
          backgroundColor: theme.colors.danger,
          borderColor: theme.colors.danger,
        },
        dim: {opacity: 0.4},
      }),
    [theme, accent],
  );

  if (!visible) {
    return null;
  }

  const blocked = !plan.ok;
  const sliderRate = Math.min(maxRate, Math.max(minRate, rate || minRate));
  const originalAmount = eligibility.recipient?.value;
  const signedAmount =
    plan.ok && originalAmount != null && plan.amountSats !== originalAmount
      ? plan.amountSats
      : null;
  const recipient =
    mode === 'speedup' && plan.ok ? shortAddress(plan.toAddress) : null;
  const confirmStyle = mode === 'cancel' ? styles.danger : styles.primary;

  return (
    <View style={styles.card}>
      <AppText variant="h2">
        {mode === 'speedup' ? 'Speed up' : 'Cancel transaction'}
      </AppText>
      <AppText variant="caption" tone="muted">
        {mode === 'speedup'
          ? eligibility.shrinkRecipient
            ? 'Pays a higher fee from the amount returning to your wallet.'
            : 'Keeps the recipient and the amount. Only the fee changes.'
          : 'Replaces this transaction and returns the funds to your wallet. Not guaranteed if it is already mined.'}
      </AppText>
      {loading ? (
        <AppText tone="muted">Loading fee rates…</AppText>
      ) : (
        <>
          <View style={styles.row}>
            <AppText tone="muted">Current</AppText>
            <AppText style={styles.value}>
              {eligibility.origFee.toLocaleString()} sats · {eligibility.origFeeRate.toFixed(1)} sat/vB
            </AppText>
          </View>
          <View style={styles.row}>
            <AppText tone="muted">New fee</AppText>
            <AppText style={styles.value}>
              {feeSats.toLocaleString()} sats · {shownRate.toFixed(1)} sat/vB
              {fiat ? ` · ${currencySymbol}${fiat}` : ''}
            </AppText>
          </View>
          {signedAmount != null ? (
            <View style={styles.row}>
              <AppText tone="muted">Amount</AppText>
              <AppText style={styles.value}>{signedAmount.toLocaleString()} sats</AppText>
            </View>
          ) : null}
          {recipient ? (
            <View style={styles.row}>
              <AppText tone="muted">To</AppText>
              <AppText style={styles.value}>{recipient}</AppText>
            </View>
          ) : null}
          {plan.ok && plan.addedInput ? (
            <AppText variant="caption" tone="muted">
              Adds one confirmed coin so the higher fee can be paid.
            </AppText>
          ) : null}
          <View style={styles.chips}>
            {chips.map(chip => {
              const selected = chip.value === sliderRate;
              return (
                <AppPressable
                  key={chip.label}
                  style={[styles.chip, selected ? styles.chipOn : null]}
                  onPress={() => {
                    setRate(Math.min(maxRate, Math.max(minRate, chip.value)));
                    setError(null);
                  }}
                  accessibilityRole="button"
                  accessibilityState={{selected}}
                  accessibilityLabel={chip.label}>
                  <AppText
                    variant="caption"
                    style={selected ? styles.chipTextOn : styles.chipText}>
                    {chip.label}
                  </AppText>
                </AppPressable>
              );
            })}
          </View>
          <FeeRateSlider
            value={sliderRate}
            min={minRate}
            max={Math.max(minRate, maxRate)}
            accent={accent}
            trackColor={theme.colors.border}
            thumbBorder={theme.colors.cardBackground}
            onCommit={next => {
              setRate(next);
              setError(null);
            }}
          />
          <AppText variant="caption" tone="muted">
            Minimum {quote.minFee.toLocaleString()} sats
          </AppText>
        </>
      )}
      {error || blocked ? (
        <AppText variant="caption" tone="danger">
          {error || (blocked ? plan.reason : '')}
        </AppText>
      ) : null}
      <View style={styles.actions}>
        <AppPressable style={styles.btn} onPress={onClose} accessibilityRole="button" accessibilityLabel="Back">
          <AppText>Back</AppText>
        </AppPressable>
        {blocked && plan.suggestCancel && onSuggestCancel ? (
          <AppPressable
            style={[styles.btn, styles.danger]}
            onPress={onSuggestCancel}
            accessibilityRole="button"
            accessibilityLabel="Cancel instead">
            <AppText variant="button" tone="onPrimary">Cancel instead</AppText>
          </AppPressable>
        ) : (
          <AppPressable
            style={[styles.btn, confirmStyle, busy || blocked || loading ? styles.dim : null]}
            onPress={confirm}
            disabled={busy || blocked || loading}
            accessibilityRole="button"
            accessibilityLabel={mode === 'speedup' ? 'Speed up transaction' : 'Cancel transaction'}>
            <AppText variant="button" tone="onPrimary">
              {busy ? 'Preparing…' : mode === 'speedup' ? 'Speed up' : 'Cancel tx'}
            </AppText>
          </AppPressable>
        )}
      </View>
    </View>
  );
};

function shortAddress(address: string): string {
  if (address.length <= 16) {
    return address;
  }
  return `${address.slice(0, 8)}…${address.slice(-4)}`;
}

export default RbfModal;
