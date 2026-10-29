import React, {useEffect, useRef, useState} from 'react';
import AppModal from './AppModal';
import AppPromptCard from './AppPromptCard';
import {hasOpenAppModal, subscribeAppModalStack} from './appModalStack';
import {
  respondAppPrompt,
  subscribeAppPrompt,
  type AppPromptRequest,
} from '../services/appPrompt';

/**
 * One in-app choice sheet for the whole app. Icon, title, one hint.
 * While another sheet is already up, that sheet paints the prompt.
 * A second native modal does not present on iOS.
 */
export default function AppPromptHost() {
  const [prompt, setPrompt] = useState<AppPromptRequest | null>(null);
  const [shown, setShown] = useState<AppPromptRequest | null>(null);
  const [covered, setCovered] = useState(hasOpenAppModal);
  const promptRef = useRef<AppPromptRequest | null>(null);
  promptRef.current = prompt;

  useEffect(
    () =>
      subscribeAppPrompt(next => {
        setPrompt(next);
        if (next) {
          setShown(next);
        }
      }),
    [],
  );

  useEffect(
    () => subscribeAppModalStack(() => setCovered(hasOpenAppModal())),
    [],
  );

  const display = prompt ?? shown;

  return (
    <AppModal
      embedPrompts={false}
      visible={prompt != null && !covered}
      transparent
      animationType="fade"
      onDismiss={() => {
        if (!promptRef.current) {
          setShown(null);
        }
      }}
      onRequestClose={() => respondAppPrompt(false)}>
      {display ? <AppPromptCard prompt={display} /> : null}
    </AppModal>
  );
}
