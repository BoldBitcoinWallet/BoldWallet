import {Text} from 'react-native';
import TestRenderer, {act} from 'react-test-renderer';

jest.mock('../components/AppPressable', () => {
  const React = require('react');
  return {
    __esModule: true,
    default: (props: any) =>
      React.createElement('MockPressable', props, props.children),
  };
});
jest.mock('../theme', () => ({
  useTheme: () => ({
    theme: {
      colors: {
        warningBg: '#111',
        warningBorder: '#222',
        text: '#eee',
        primary: '#06c',
      },
    },
  }),
}));

import BackupNudgeCard from '../components/BackupNudgeCard';

describe('BackupNudgeCard (3b-6e)', () => {
  test('renders nothing when not visible', () => {
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <BackupNudgeCard visible={false} onBackUp={jest.fn()} />,
      );
    });
    expect(renderer!.toJSON()).toBeNull();
  });

  test('renders nudge copy and Back up button when visible', () => {
    const onBackUp = jest.fn();
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <BackupNudgeCard visible={true} onBackUp={onBackUp} />,
      );
    });
    const texts = renderer!.root
      .findAllByType(Text as any)
      .map(n => n.props.children);
    expect(texts.join(' ')).toContain('Backup recommended');
    const btn = renderer!.root.findByProps({accessibilityLabel: 'Back up now'});
    act(() => {
      btn.props.onPress();
    });
    expect(onBackUp).toHaveBeenCalledTimes(1);
  });
});
