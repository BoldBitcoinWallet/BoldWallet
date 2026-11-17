import {CommonActions} from '@react-navigation/native';
import React, {useEffect, useRef, useState} from 'react';
import {
  Alert,
  Animated,
  Easing,
  Image,
  LayoutAnimation,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  UIManager,
  View,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import AppPressable from '../components/AppPressable';
import {showAppNotice} from '../services/appPrompt';
import {dbg} from '../utils';
import {useTheme} from '../theme';
import {type TssBackend} from '../services/tssBackend';
import {
  getKeygenTssBackendPreference,
  isDkls23OptedOut,
  setDkls23OptedOut,
  setKeygenTssBackendPreference,
} from '../services/tssConfig';

if (
  Platform.OS === 'android' &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const SETUP_GUIDE_URL =
  'https://x.com/boldbtcwallet/status/1988322162386854108';
const LIBTSS_URL = 'https://github.com/0xCarbon/libtss';
const BNB_TSS_BLOG_URL =
  'https://www.binance.com/en/blog/all/398654406137536512';

type SetupMode = 'duo' | 'trio';
type SetupTransport = 'local' | 'nostr';
type SetupStep = 'phones' | 'connect' | 'stack';

const STEP_ORDER: SetupStep[] = ['phones', 'connect', 'stack'];

const STEP_TRANSITION = {
  duration: 240,
  create: {
    type: LayoutAnimation.Types.easeInEaseOut,
    property: LayoutAnimation.Properties.opacity,
  },
  update: {
    type: LayoutAnimation.Types.easeInEaseOut,
  },
  delete: {
    type: LayoutAnimation.Types.easeInEaseOut,
    property: LayoutAnimation.Properties.opacity,
  },
};

const StepContentReveal = ({
  stepKey,
  direction,
  children,
}: {
  stepKey: string;
  direction: 1 | -1;
  children: React.ReactNode;
}) => {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(direction * 10)).current;

  useEffect(() => {
    opacity.setValue(0);
    translateY.setValue(direction * 10);
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 220,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: 240,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [stepKey, direction, opacity, translateY]);

  return (
    <Animated.View style={{opacity, transform: [{translateY}]}}>
      {children}
    </Animated.View>
  );
};

const WalletSetupScreen = ({navigation}: {navigation: any}) => {
  const {theme} = useTheme();
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<SetupMode | null>(null);
  const [transport, setTransport] = useState<SetupTransport | null>(null);
  const [backend, setBackend] = useState<TssBackend>(
    getKeygenTssBackendPreference(),
  );
  const [activeStep, setActiveStep] = useState<SetupStep>('phones');
  const [stepDirection, setStepDirection] = useState<1 | -1>(1);

  const isLight = theme.colors.background === '#ffffff';
  const accent = isLight ? theme.colors.primary : theme.colors.bitcoinOrange;
  const canContinue = mode !== null && transport !== null;

  const goToStep = (next: SetupStep) => {
    if (next === activeStep) {
      return;
    }
    const prevIdx = STEP_ORDER.indexOf(activeStep);
    const nextIdx = STEP_ORDER.indexOf(next);
    setStepDirection(nextIdx >= prevIdx ? 1 : -1);
    LayoutAnimation.configureNext(STEP_TRANSITION);
    setActiveStep(next);
  };

  const canOpenStep = (target: SetupStep): boolean => {
    if (target === 'phones') {
      return true;
    }
    if (target === 'connect') {
      return mode !== null;
    }
    return mode !== null && transport !== null;
  };

  const openLink = (url: string) => {
    Linking.openURL(url).catch(err => {
      showAppNotice('Error', 'Unable to open the link');
      dbg('WalletSetupScreen: link failed', err);
    });
  };

  const continueToPairing = () => {
    if (!mode || !transport) {
      return;
    }
    setKeygenTssBackendPreference(backend);
    const setupParams = {
      mode,
      transport: transport === 'local' ? ('lan' as const) : ('nostr' as const),
      backend,
    };
    navigation.dispatch(
      CommonActions.reset({
        index: 0,
        routes: [
          {
            name: transport === 'local' ? 'Devices Pairing' : 'Nostr Connect',
            params: setupParams,
          },
        ],
      }),
    );
  };

  const styles = StyleSheet.create({
    screen: {flex: 1, backgroundColor: theme.colors.background},
    scroll: {paddingHorizontal: 20, paddingTop: 12, paddingBottom: 20},
    step: {
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: 14,
      backgroundColor: theme.colors.cardBackground,
      marginBottom: 10,
      overflow: 'hidden',
    },
    stepActive: {
      borderWidth: 1.5,
      borderColor: accent,
      shadowColor: '#000',
      shadowOffset: {width: 0, height: 4},
      shadowOpacity: isLight ? 0.08 : 0.25,
      shadowRadius: 8,
      elevation: 3,
    },
    stepMuted: {
      opacity: 0.56,
      backgroundColor: isLight
        ? theme.colors.background
        : theme.colors.cardBackground,
    },
    stepLocked: {
      opacity: 0.42,
    },
    stepHeader: {
      minHeight: 56,
      paddingHorizontal: 14,
      paddingVertical: 10,
      flexDirection: 'row',
      alignItems: 'center',
    },
    stepIndex: {
      width: 28,
      height: 28,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 12,
      backgroundColor: theme.colors.border + '55',
    },
    stepIndexActive: {backgroundColor: accent},
    stepIndexDone: {backgroundColor: accent + '24'},
    stepIndexText: {
      color: theme.colors.textSecondary,
      fontSize: theme.fontSizes?.sm || 13,
      fontFamily: theme.fontFamilies?.bold,
    },
    stepIndexTextActive: {color: theme.colors.white},
    stepIndexTextDone: {color: accent},
    stepCopy: {flex: 1},
    stepTitle: {
      color: theme.colors.text,
      fontSize: theme.fontSizes?.base || 15,
      fontFamily: theme.fontFamilies?.bold,
    },
    stepTitleMuted: {
      color: theme.colors.textSecondary,
      fontFamily: theme.fontFamilies?.medium,
    },
    stepValue: {
      color: theme.colors.textSecondary,
      fontSize: theme.fontSizes?.sm || 12,
      fontFamily: theme.fontFamilies?.regular,
      marginTop: 2,
    },
    stepBody: {
      paddingHorizontal: 12,
      paddingBottom: 12,
      borderTopWidth: 1,
      borderTopColor: theme.colors.border,
    },
    card: {
      borderWidth: 1.5,
      borderColor: theme.colors.border,
      borderRadius: 14,
      backgroundColor: theme.colors.cardBackground,
      padding: 12,
      marginTop: 8,
      marginBottom: 0,
      minHeight: 64,
    },
    cardOn: {borderColor: accent},
    cardRow: {flexDirection: 'row', alignItems: 'center'},
    iconWell: {
      minWidth: 44,
      height: 44,
      paddingHorizontal: 8,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 12,
      backgroundColor: accent + '18',
    },
    phoneRow: {flexDirection: 'row', alignItems: 'center'},
    phoneIcon: {width: 16, height: 16, tintColor: accent, marginHorizontal: 1},
    cardCopy: {flex: 1},
    cardTitle: {
      color: theme.colors.text,
      fontSize: theme.fontSizes?.lg || 16,
      fontFamily: theme.fontFamilies?.bold,
    },
    cardBody: {
      color: theme.colors.textSecondary,
      fontSize: theme.fontSizes?.sm || 12,
      fontFamily: theme.fontFamilies?.regular,
      lineHeight: 17,
      marginTop: 2,
    },
    stackIntro: {
      color: theme.colors.textSecondary,
      fontSize: theme.fontSizes?.sm || 12,
      fontFamily: theme.fontFamilies?.regular,
      lineHeight: 17,
      marginTop: 10,
    },
    check: {
      width: 22,
      height: 22,
      borderRadius: 11,
      borderWidth: 1.5,
      borderColor: theme.colors.border,
      alignItems: 'center',
      justifyContent: 'center',
      marginLeft: 8,
    },
    checkOn: {backgroundColor: accent, borderColor: accent},
    checkMark: {
      color: theme.colors.white,
      fontSize: 13,
      fontFamily: theme.fontFamilies?.bold,
    },
    hint: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 8,
      marginTop: 10,
      padding: 12,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.cardBackground,
    },
    hintIcon: {width: 18, height: 18, tintColor: accent, marginTop: 1},
    hintText: {
      flex: 1,
      color: theme.colors.text,
      fontSize: theme.fontSizes?.base || 14,
      fontFamily: theme.fontFamilies?.regular,
      lineHeight: 20,
    },
    hintBold: {fontFamily: theme.fontFamilies?.bold},
    guide: {
      alignSelf: 'flex-start',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingTop: 10,
      paddingBottom: 2,
    },
    guideIcon: {width: 16, height: 16, tintColor: accent},
    guideText: {
      color: accent,
      fontSize: theme.fontSizes?.base || 14,
      fontFamily: theme.fontFamilies?.medium,
      textDecorationLine: 'underline',
    },
    stackIcon: {width: 28, height: 28},
    badge: {
      alignSelf: 'flex-start',
      marginTop: 6,
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: 999,
      backgroundColor: accent + '22',
    },
    badgeText: {
      color: accent,
      fontSize: theme.fontSizes?.xs || 11,
      fontFamily: theme.fontFamilies?.bold,
    },
    link: {
      color: accent,
      textDecorationLine: 'underline',
      fontFamily: theme.fontFamilies?.medium,
    },
    stepNavRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: 14,
      paddingTop: 10,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.border,
    },
    stepNavSlotPlaceholder: {
      minWidth: 1,
    },
    prevBtn: {
      paddingVertical: 8,
      paddingHorizontal: 14,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.background,
    },
    prevBtnText: {
      color: theme.colors.textSecondary,
      fontSize: theme.fontSizes?.sm || 13,
      fontFamily: theme.fontFamilies?.bold,
    },
    nextBtn: {
      paddingVertical: 8,
      paddingHorizontal: 16,
      borderRadius: 10,
      backgroundColor: accent,
    },
    nextBtnOff: {
      backgroundColor: theme.colors.disabled,
    },
    nextBtnText: {
      color: theme.colors.white,
      fontSize: theme.fontSizes?.sm || 13,
      fontFamily: theme.fontFamilies?.bold,
    },
    nextBtnTextOff: {
      color: theme.colors.disabledText || '#777',
    },
    footer: {
      borderTopWidth: 1,
      borderTopColor: theme.colors.border,
      paddingHorizontal: 20,
      paddingTop: 12,
      paddingBottom: Math.max(insets.bottom, 12),
      backgroundColor: theme.colors.background,
    },
    continue: {
      minHeight: 52,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: accent,
    },
    continueOff: {backgroundColor: theme.colors.disabled},
    continueText: {
      color: theme.colors.white,
      fontSize: theme.fontSizes?.lg || 16,
      fontFamily: theme.fontFamilies?.bold,
    },
    continueTextOff: {color: theme.colors.disabledText || '#777'},
  });

  const choiceCard = (
    selected: boolean,
    title: string,
    body: string,
    icon: React.ReactNode,
    onPress: () => void,
    badge?: string,
  ) => (
    <AppPressable
      accessibilityRole="radio"
      accessibilityState={{selected}}
      style={[styles.card, selected && styles.cardOn]}
      onPress={onPress}>
      <View style={styles.cardRow}>
        <View style={styles.iconWell}>{icon}</View>
        <View style={styles.cardCopy}>
          <Text style={styles.cardTitle}>{title}</Text>
          <Text style={styles.cardBody}>{body}</Text>
          {badge ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{badge}</Text>
            </View>
          ) : null}
        </View>
        <View style={[styles.check, selected && styles.checkOn]}>
          {selected ? <Text style={styles.checkMark}>✓</Text> : null}
        </View>
      </View>
    </AppPressable>
  );

  const phones = (count: 2 | 3) => (
    <View style={styles.phoneRow}>
      {Array.from({length: count}, (_, index) => (
        <Image
          key={index}
          source={require('../assets/phone-icon.png')}
          style={styles.phoneIcon}
          resizeMode="contain"
        />
      ))}
    </View>
  );

  const stepHeader = (
    step: SetupStep,
    index: string,
    title: string,
    summary: string,
    done: boolean,
    onLongPress?: () => void,
  ) => {
    const open = activeStep === step;
    const unlocked = canOpenStep(step);
    return (
      <AppPressable
        accessibilityRole="button"
        accessibilityState={{expanded: open, disabled: !unlocked}}
        disabled={!unlocked}
        style={styles.stepHeader}
        onPress={() => goToStep(step)}
        onLongPress={onLongPress}>
        <View
          style={[
            styles.stepIndex,
            open && styles.stepIndexActive,
            !open && done && styles.stepIndexDone,
          ]}>
          <Text
            style={[
              styles.stepIndexText,
              open && styles.stepIndexTextActive,
              !open && done && styles.stepIndexTextDone,
            ]}>
            {!open && done ? '✓' : index}
          </Text>
        </View>
        <View style={styles.stepCopy}>
          <Text style={[styles.stepTitle, !open && styles.stepTitleMuted]}>
            {title}
          </Text>
          {open ? null : <Text style={styles.stepValue}>{summary}</Text>}
        </View>
      </AppPressable>
    );
  };

  const renderStepNav = ({
    prevStep,
    nextStep,
    nextDisabled = false,
  }: {
    prevStep?: SetupStep;
    nextStep?: SetupStep;
    nextDisabled?: boolean;
  }) => (
    <View style={styles.stepNavRow}>
      {prevStep ? (
        <AppPressable
          accessibilityRole="button"
          style={styles.prevBtn}
          onPress={() => goToStep(prevStep)}>
          <Text style={styles.prevBtnText}>← Previous</Text>
        </AppPressable>
      ) : (
        <View style={styles.stepNavSlotPlaceholder} />
      )}
      {nextStep ? (
        <AppPressable
          accessibilityRole="button"
          accessibilityState={{disabled: nextDisabled}}
          disabled={nextDisabled}
          style={[styles.nextBtn, nextDisabled && styles.nextBtnOff]}
          onPress={() => goToStep(nextStep)}>
          <Text
            style={[styles.nextBtnText, nextDisabled && styles.nextBtnTextOff]}>
            Next →
          </Text>
        </AppPressable>
      ) : (
        <View style={styles.stepNavSlotPlaceholder} />
      )}
    </View>
  );

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        <View
          style={[
            styles.step,
            activeStep === 'phones' ? styles.stepActive : styles.stepMuted,
          ]}>
          {stepHeader(
            'phones',
            '1',
            'How many phones?',
            mode === 'duo'
              ? 'Duo · both phones co-sign'
              : mode === 'trio'
                ? 'Trio · any 2 of 3'
                : 'Choose Duo or Trio',
            mode !== null,
          )}
          {activeStep === 'phones' ? (
            <View style={styles.stepBody}>
              <StepContentReveal stepKey="phones" direction={stepDirection}>
                {choiceCard(
                  mode === 'duo',
                  'Duo',
                  '2 devices — both phones take part in setup and co-sign every spend.',
                  phones(2),
                  () => setMode('duo'),
                )}
                {choiceCard(
                  mode === 'trio',
                  'Trio',
                  '3 devices — all three join setup; any 2 can approve a spend.',
                  phones(3),
                  () => setMode('trio'),
                )}
                <View style={styles.hint}>
                  <Image
                    source={require('../assets/bulb-icon.png')}
                    style={styles.hintIcon}
                    resizeMode="contain"
                  />
                  <Text style={styles.hintText}>
                    {mode === 'duo' ? (
                      <>
                        <Text style={styles.hintBold}>Duo.</Text>
                        {
                          ' Both phones set up together and co-sign every spend. One phone alone cannot move funds.'
                        }
                      </>
                    ) : mode === 'trio' ? (
                      <>
                        <Text style={styles.hintBold}>Trio.</Text>
                        {
                          ' All three phones join setup. After that, any two can approve a spend, so one can be away.'
                        }
                      </>
                    ) : (
                      <>
                        <Text style={styles.hintBold}>Duo</Text>
                        {' needs both phones every time. '}
                        <Text style={styles.hintBold}>Trio</Text>
                        {' lets any two approve.'}
                      </>
                    )}
                  </Text>
                </View>
                <AppPressable
                  accessibilityRole="link"
                  style={styles.guide}
                  onPress={() => openLink(SETUP_GUIDE_URL)}>
                  <Image
                    source={require('../assets/start-icon.png')}
                    style={styles.guideIcon}
                    resizeMode="contain"
                  />
                  <Text style={styles.guideText}>🎥 Watch setup guide →</Text>
                </AppPressable>
                {renderStepNav({
                  nextStep: 'connect',
                  nextDisabled: mode === null,
                })}
              </StepContentReveal>
            </View>
          ) : null}
        </View>

        <View
          style={[
            styles.step,
            activeStep === 'connect'
              ? styles.stepActive
              : [styles.stepMuted, !canOpenStep('connect') && styles.stepLocked],
          ]}>
          {stepHeader(
            'connect',
            '2',
            'How will they connect?',
            transport === 'local'
              ? 'Local Wi‑Fi · Nostr not available later'
              : transport === 'nostr'
                ? 'Nostr · internet and local Wi‑Fi'
                : 'Choose a connection',
            transport !== null,
          )}
          {activeStep === 'connect' ? (
            <View style={styles.stepBody}>
              <StepContentReveal stepKey="connect" direction={stepDirection}>
                {choiceCard(
                  transport === 'local',
                  'Local WiFi/Hotspot',
                  'Same network only. Nostr can’t be added later.',
                  <Image
                    source={require('../assets/wifi-icon.png')}
                    style={styles.stackIcon}
                    resizeMode="contain"
                  />,
                  () => setTransport('local'),
                )}
                {choiceCard(
                  transport === 'nostr',
                  'Nostr',
                  'Internet or local Wi‑Fi. Both stay available.',
                  <Image
                    source={require('../assets/nostr-icon.png')}
                    style={styles.stackIcon}
                    resizeMode="contain"
                  />,
                  () => setTransport('nostr'),
                )}
                {transport ? (
                  <View style={styles.hint}>
                    <Image
                      source={require('../assets/bulb-icon.png')}
                      style={styles.hintIcon}
                      resizeMode="contain"
                    />
                    <Text style={styles.hintText}>
                      {transport === 'local' ? (
                        <>
                          <Text style={styles.hintBold}>Local only.</Text>
                          {
                            ' Setup on Wi‑Fi or a hotspot is permanent. Later co-signing stays on the local network — Nostr is not available for this wallet.'
                          }
                        </>
                      ) : (
                        <>
                          <Text style={styles.hintBold}>Nostr.</Text>
                          {
                            ' Phones can meet over the internet or on the same local network.'
                          }
                        </>
                      )}
                    </Text>
                  </View>
                ) : null}
                {renderStepNav({
                  prevStep: 'phones',
                  nextStep: 'stack',
                  nextDisabled: transport === null,
                })}
              </StepContentReveal>
            </View>
          ) : null}
        </View>

        <View
          style={[
            styles.step,
            activeStep === 'stack'
              ? styles.stepActive
              : [styles.stepMuted, !canOpenStep('stack') && styles.stepLocked],
          ]}>
          {stepHeader(
            'stack',
            '3',
            'Signing stack',
            backend === 'dkls23' ? 'DKLs23 (Recommended)' : 'GG18',
            canContinue,
            () => {
              if (!__DEV__) {
                return;
              }
              const useGg18 = !isDkls23OptedOut();
              setDkls23OptedOut(useGg18);
              const next: TssBackend = useGg18 ? 'gg18' : 'dkls23';
              setBackend(next);
              Alert.alert(
                'Keygen backend (dev)',
                useGg18
                  ? 'New wallets will use GG18 (legacy) until toggled again.'
                  : 'New wallets will use DKLs23.',
              );
            },
          )}
          {activeStep === 'stack' ? (
            <View style={styles.stepBody}>
              <StepContentReveal stepKey="stack" direction={stepDirection}>
                <Text style={styles.stackIntro}>
                  Choose how this wallet will be created. Existing restored
                  wallets keep their original stack automatically. Every phone
                  must pick the same stack.
                </Text>
                {choiceCard(
                  backend === 'dkls23',
                  'DKLs23',
                  '0xCarbon libtss',
                  <Image
                    source={require('../assets/0xcarbon-lib.png')}
                    style={styles.stackIcon}
                    resizeMode="contain"
                  />,
                  () => setBackend('dkls23'),
                  'Recommended',
                )}
                {choiceCard(
                  backend === 'gg18',
                  'GG18',
                  'BNB TSS library',
                  <Image
                    source={require('../assets/bnb-lib.png')}
                    style={styles.stackIcon}
                    resizeMode="contain"
                  />,
                  () => setBackend('gg18'),
                )}
                <View style={styles.hint}>
                  <Image
                    source={require('../assets/bulb-icon.png')}
                    style={styles.hintIcon}
                    resizeMode="contain"
                  />
                  <Text style={styles.hintText}>
                    {backend === 'dkls23' ? (
                      <>
                        <Text style={styles.hintBold}>
                          DKLs23 (recommended)
                        </Text>
                        {
                          ' — 0xCarbon libtss. Faster setup and signing for new wallets. Every device must pick DKLs23.\n\n'
                        }
                        <Text
                          style={styles.link}
                          onPress={() => openLink(LIBTSS_URL)}>
                          0xCarbon/libtss on GitHub
                        </Text>
                      </>
                    ) : (
                      <>
                        <Text style={styles.hintBold}>GG18 · BNB TSS</Text>
                        {
                          ' — Binance established MPC stack. Slower, heavier & battle tested. Every device must pick the same stack.\n\n'
                        }
                        <Text
                          style={styles.link}
                          onPress={() => openLink(BNB_TSS_BLOG_URL)}>
                          Binance TSS overview
                        </Text>
                      </>
                    )}
                  </Text>
                </View>
                {renderStepNav({prevStep: 'connect'})}
              </StepContentReveal>
            </View>
          ) : null}
        </View>
      </ScrollView>
      <View style={styles.footer}>
        <AppPressable
          accessibilityRole="button"
          accessibilityState={{disabled: !canContinue}}
          disabled={!canContinue}
          style={[styles.continue, !canContinue && styles.continueOff]}
          onPress={continueToPairing}>
          <Text
            style={[
              styles.continueText,
              !canContinue && styles.continueTextOff,
            ]}>
            Continue to Pair Devices →
          </Text>
        </AppPressable>
      </View>
    </View>
  );
};

export default WalletSetupScreen;
