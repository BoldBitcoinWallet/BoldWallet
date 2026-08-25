import React, {useMemo, useState} from 'react';
import {
  Alert,
  Image,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import AppPressable from './AppPressable';
import AppSwitch from './AppSwitch';
import {useTheme} from '../theme';
import {
  getHostQuality,
  type MempoolHealthQuality,
} from '../services/mempoolHealth';
import {
  firstInvalidProviderUrl,
  isValidProviderUrl,
  loadDefaultMempoolProviderEntries,
  normalizeProviderUrl,
  parseProviderUrls,
  PROVIDER_SCHEME_ERROR,
  providerListSummary,
  type MempoolProviderEntry,
} from '../services/mempoolProvidersStore';
import {normalizeMempoolApiRoot} from '../services/mempoolApiBase';

function hostRoot(url: string): string {
  return normalizeMempoolApiRoot(url);
}

type Props = {
  entries: MempoolProviderEntry[];
  onChange: (next: MempoolProviderEntry[]) => void;
  showSave?: boolean;
  saveDisabled?: boolean;
  onSave?: () => void | Promise<void>;
  showDefaults?: boolean;
};

function qualityLabel(q: MempoolHealthQuality | null): string | null {
  if (q === 'slow') return 'Slow';
  if (q === 'bad') return 'Unreachable';
  if (q === 'fine') return 'Healthy';
  return null;
}

export default function MempoolProvidersEditor({
  entries,
  onChange,
  showSave = false,
  saveDisabled = false,
  onSave,
  showDefaults = true,
}: Props) {
  const {theme} = useTheme();
  const [addUrl, setAddUrl] = useState('');
  const [showPaste, setShowPaste] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const summary = useMemo(() => providerListSummary(entries), [entries]);

  const addProvider = (raw: string) => {
    const url = normalizeProviderUrl(raw);
    if (!url) {
      return;
    }
    if (!isValidProviderUrl(url)) {
      Alert.alert(
        'Error',
        `Invalid provider URL: ${url}\n${PROVIDER_SCHEME_ERROR}`,
      );
      return;
    }
    if (entries.some(e => normalizeMempoolApiRoot(e.url) === normalizeMempoolApiRoot(url))) {
      Alert.alert('Already added', 'That provider is already in the list.');
      return;
    }
    onChange([...entries, {url, enabled: true}]);
    setAddUrl('');
  };

  const applyPaste = () => {
    const urls = parseProviderUrls(pasteText);
    const invalid = firstInvalidProviderUrl(urls);
    if (invalid) {
      Alert.alert(
        'Error',
        `Invalid provider URL: ${invalid}\n${PROVIDER_SCHEME_ERROR}`,
      );
      return;
    }
    if (urls.length === 0) {
      Alert.alert('Error', 'Please enter at least one provider URL');
      return;
    }
    const existing = new Set(entries.map(e => normalizeMempoolApiRoot(e.url)));
    const next = [...entries];
    for (const url of urls) {
      const root = normalizeMempoolApiRoot(url);
      if (!existing.has(root)) {
        next.push({url, enabled: true});
        existing.add(root);
      }
    }
    onChange(next);
    setPasteText('');
    setShowPaste(false);
  };

  const muted = theme.colors.textSecondary;
  const isDark = theme.colors.background !== '#ffffff';
  // Match header health-dot: dark primary (#3A3A3A) is unreadable on cards.
  const healthyColor = isDark ? theme.colors.secondary : theme.colors.primary;

  return (
    <View>
      <Text style={[styles.summary, {color: muted}]}>{summary}</Text>
      {entries.map((entry, index) => {
        const quality = getHostQuality(hostRoot(entry.url));
        const qLabel = qualityLabel(quality);
        return (
          <View
            key={entry.url}
            style={[
              styles.row,
              {
                borderColor: theme.colors.border,
                backgroundColor: theme.colors.cardBackground,
              },
            ]}>
            <View style={styles.rowMain}>
              <Text
                style={[
                  styles.url,
                  {
                    color: entry.enabled ? theme.colors.text : muted,
                    fontFamily: theme.fontFamilies?.regular,
                  },
                ]}
                numberOfLines={1}
                ellipsizeMode="middle">
                {entry.url}
              </Text>
              {qLabel && entry.enabled ? (
                <Text
                  style={[
                    styles.hint,
                    {
                      color:
                        quality === 'bad'
                          ? muted
                          : quality === 'slow'
                            ? theme.colors.bitcoinOrange
                            : healthyColor,
                    },
                  ]}>
                  {qLabel}
                </Text>
              ) : null}
            </View>
            <AppSwitch
              value={entry.enabled}
              onValueChange={value => {
                const next = entries.map((e, i) =>
                  i === index ? {...e, enabled: value} : e,
                );
                onChange(next);
              }}
            />
            <AppPressable
              onPress={() => onChange(entries.filter((_, i) => i !== index))}
              style={styles.deleteBtn}
              android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
              <Image
                source={require('../assets/delete-icon.png')}
                style={[styles.deleteIcon, {tintColor: theme.colors.text}]}
                resizeMode="contain"
              />
            </AppPressable>
          </View>
        );
      })}

      <View style={styles.addRow}>
        <TextInput
          style={[
            styles.addInput,
            {
              color: theme.colors.text,
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.cardBackground,
              fontFamily: theme.fontFamilies?.regular,
            },
          ]}
          value={addUrl}
          onChangeText={setAddUrl}
          placeholder="https://mempool.example/api"
          placeholderTextColor={muted + '80'}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          returnKeyType="done"
          onSubmitEditing={() => addProvider(addUrl)}
        />
        <AppPressable
          style={[
            styles.addBtn,
            {backgroundColor: theme.colors.primary},
            !addUrl.trim() && styles.disabled,
          ]}
          disabled={!addUrl.trim()}
          onPress={() => addProvider(addUrl)}
          android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
          <Text style={[styles.addBtnText, {color: theme.colors.white}]}>
            Add
          </Text>
        </AppPressable>
      </View>

      <AppPressable
        onPress={() => setShowPaste(v => !v)}
        style={styles.linkBtn}>
        <Text style={[styles.linkText, {color: theme.colors.primary}]}>
          {showPaste ? 'Hide paste' : 'Paste URLs'}
        </Text>
      </AppPressable>
      {showPaste ? (
        <View>
          <TextInput
            style={[
              styles.pasteInput,
              {
                color: theme.colors.text,
                borderColor: theme.colors.border,
                backgroundColor: theme.colors.cardBackground,
                fontFamily: theme.fontFamilies?.regular,
              },
            ]}
            value={pasteText}
            onChangeText={setPasteText}
            placeholder={
              'https://mempool.space/api\nhttps://mempool.emzy.de/api'
            }
            placeholderTextColor={muted + '80'}
            autoCapitalize="none"
            autoCorrect={false}
            multiline
          />
          <AppPressable
            style={[styles.secondaryBtn, {borderColor: theme.colors.border}]}
            onPress={applyPaste}
            android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
            <Text style={[styles.secondaryBtnText, {color: theme.colors.text}]}>
              Apply pasted list
            </Text>
          </AppPressable>
        </View>
      ) : null}

      <View style={styles.actions}>
        {showSave ? (
          <AppPressable
            style={[
              styles.primaryBtn,
              {backgroundColor: theme.colors.primary},
              saveDisabled && styles.disabled,
            ]}
            disabled={saveDisabled}
            onPress={() => onSave?.()}
            android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
            <Text style={[styles.primaryBtnText, {color: theme.colors.white}]}>
              Save Providers
            </Text>
          </AppPressable>
        ) : null}
        {showDefaults ? (
          <AppPressable
            style={[styles.secondaryBtn, {borderColor: theme.colors.border}]}
            onPress={async () => {
              const defaults = await loadDefaultMempoolProviderEntries();
              onChange(defaults);
            }}
            android_ripple={{color: 'rgba(0,0,0,0.1)'}}>
            <Text style={[styles.secondaryBtnText, {color: theme.colors.text}]}>
              Defaults
            </Text>
          </AppPressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  summary: {
    fontSize: 12,
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 8,
    gap: 8,
  },
  rowMain: {
    flex: 1,
    minWidth: 0,
  },
  url: {
    fontSize: 13,
  },
  hint: {
    fontSize: 11,
    marginTop: 2,
  },
  deleteBtn: {
    padding: 6,
  },
  deleteIcon: {
    width: 16,
    height: 16,
  },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  addInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
  },
  addBtn: {
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  addBtnText: {
    fontSize: 14,
    fontWeight: '600',
  },
  linkBtn: {
    marginTop: 8,
    marginBottom: 4,
  },
  linkText: {
    fontSize: 13,
    fontWeight: '600',
  },
  pasteInput: {
    minHeight: 88,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingTop: 10,
    textAlignVertical: 'top',
    fontSize: 13,
    marginBottom: 8,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  primaryBtn: {
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  primaryBtnText: {
    fontSize: 14,
    fontWeight: '600',
  },
  secondaryBtn: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  secondaryBtnText: {
    fontSize: 14,
    fontWeight: '600',
  },
  disabled: {
    opacity: 0.45,
  },
});
