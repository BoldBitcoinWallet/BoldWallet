import React, {useCallback, useEffect, useRef, useState} from 'react';
import {Modal, Platform, StyleSheet, View, type ModalProps} from 'react-native';
import AppPromptCard from './AppPromptCard';
import ModalToastHost from './ModalToastHost';
import {
  isTopAppModal,
  popAppModal,
  pushAppModal,
  subscribeAppModalStack,
} from './appModalStack';
import {
  respondAppPrompt,
  subscribeAppPrompt,
  type AppPromptRequest,
} from '../services/appPrompt';
import {shouldHoldIosModal} from './appModalHold';

const PRESENT_GRACE_MS = 350;
const EARLY_DISMISS_HOLD_MS = 800;
const HOST_FALLBACK_MS = 700;

type AppModalProps = ModalProps & {
  /**
   * Paint an in-app prompt inside this sheet while it is the top modal.
   * The prompt host sets this false so it does not nest a prompt in itself.
   */
  embedPrompts?: boolean;
};

const AppModal: React.FC<AppModalProps> = ({
  visible = false,
  onShow,
  onDismiss,
  onRequestClose,
  embedPrompts = true,
  children,
  ...rest
}) => {
  const presentedRef = useRef(false);
  const openedRef = useRef(false);
  const wasVisibleRef = useRef(false);
  const visibleRef = useRef(!!visible);
  const onDismissRef = useRef(onDismiss);
  const dismissNotifiedRef = useRef(false);
  const hideFallbackRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  visibleRef.current = !!visible;
  onDismissRef.current = onDismiss;
  const [, setEpoch] = useState(0);
  const [prompt, setPrompt] = useState<AppPromptRequest | null>(null);
  const [isTop, setIsTop] = useState(false);
  const hasContent = React.Children.toArray(children).length > 0;

  const releaseHost = useCallback(() => {
    if (hideFallbackRef.current) {
      clearTimeout(hideFallbackRef.current);
      hideFallbackRef.current = null;
    }
    openedRef.current = false;
    presentedRef.current = true;
    if (dismissNotifiedRef.current) {
      return;
    }
    dismissNotifiedRef.current = true;
    onDismissRef.current?.();
  }, []);

  const armHostFallback = useCallback(() => {
    if (hideFallbackRef.current) {
      clearTimeout(hideFallbackRef.current);
    }
    const fallback = setTimeout(() => {
      hideFallbackRef.current = null;
      if (visibleRef.current || dismissNotifiedRef.current) {
        return;
      }
      releaseHost();
      setEpoch(n => n + 1);
    }, HOST_FALLBACK_MS);
    hideFallbackRef.current = fallback;
  }, [releaseHost]);

  if (visible && !wasVisibleRef.current) {
    presentedRef.current = false;
    openedRef.current = true;
    dismissNotifiedRef.current = false;
  }
  wasVisibleRef.current = !!visible;

  const holdForPresent = shouldHoldIosModal({
    os: Platform.OS,
    visible: !!visible,
    hasContent,
    opened: openedRef.current,
    presented: presentedRef.current,
  });
  const show = !!visible || holdForPresent;

  useEffect(() => {
    if (Platform.OS !== 'ios' || !visible) {
      return;
    }
    const timer = setTimeout(() => {
      if (visibleRef.current) {
        presentedRef.current = true;
      }
    }, PRESENT_GRACE_MS);
    return () => clearTimeout(timer);
  }, [visible]);

  useEffect(() => {
    if (visible || !openedRef.current) {
      return;
    }
    if (Platform.OS !== 'ios' || !hasContent) {
      releaseHost();
      return;
    }
    if (!presentedRef.current) {
      const timer = setTimeout(() => {
        if (visibleRef.current || presentedRef.current) {
          return;
        }
        presentedRef.current = true;
        setEpoch(n => n + 1);
        armHostFallback();
      }, EARLY_DISMISS_HOLD_MS);
      return () => clearTimeout(timer);
    }
    armHostFallback();
    return () => {
      if (hideFallbackRef.current) {
        clearTimeout(hideFallbackRef.current);
        hideFallbackRef.current = null;
      }
    };
  }, [armHostFallback, hasContent, releaseHost, visible]);

  useEffect(() => {
    if (!embedPrompts) {
      return;
    }
    return subscribeAppPrompt(setPrompt);
  }, [embedPrompts]);

  useEffect(() => {
    if (!embedPrompts || !show) {
      setIsTop(false);
      return;
    }
    const id = pushAppModal();
    const sync = () => setIsTop(isTopAppModal(id));
    sync();
    const unsubscribe = subscribeAppModalStack(sync);
    return () => {
      unsubscribe();
      popAppModal(id);
    };
  }, [embedPrompts, show]);

  const promptHere = embedPrompts && isTop && prompt != null;

  if (!show && (!hasContent || !openedRef.current)) {
    return null;
  }

  return (
    <Modal
      {...rest}
      visible={show}
      onRequestClose={event => {
        if (promptHere) {
          respondAppPrompt(false);
          return;
        }
        onRequestClose?.(event);
      }}
      onShow={event => {
        presentedRef.current = true;
        if (!visibleRef.current) {
          setEpoch(n => n + 1);
          armHostFallback();
        }
        onShow?.(event);
      }}
      onDismiss={() => {
        releaseHost();
      }}>
      <View style={styles.promptHost}>
        {promptHere && prompt ? (
          <>
            <View style={styles.promptUnder} pointerEvents="none">
              {children}
            </View>
            <View style={StyleSheet.absoluteFill}>
              <AppPromptCard prompt={prompt} />
            </View>
          </>
        ) : (
          children
        )}
        {show ? <ModalToastHost /> : null}
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  promptHost: {
    flex: 1,
  },
  promptUnder: {
    flex: 1,
  },
});

export {shouldHoldIosModal} from './appModalHold';

/** Resolves when the matching modal calls `onDismiss`, or after one second. */
export function armModalDismiss(slot: {
  current: (() => void) | null;
}): Promise<void> {
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      if (slot.current === finish) {
        slot.current = null;
      }
      resolve();
    }, 1000);
    const finish = () => {
      clearTimeout(timer);
      if (slot.current === finish) {
        slot.current = null;
      }
      resolve();
    };
    slot.current = finish;
  });
}

export default AppModal;
