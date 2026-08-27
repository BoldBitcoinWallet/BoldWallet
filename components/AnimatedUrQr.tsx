import React, {useEffect, useMemo, useState} from 'react';
import {
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import type {UR} from '@ngraveio/bc-ur';
import {dbg} from '../utils';
import {useTheme} from '../theme';
import {
  UR_BYTES_FRAGMENT_SIZE,
  UR_FRAME_INTERVAL_MS,
  createUrEncoder,
  urFountainWrapAfter,
  urFragmentCount,
  utf8ToUr,
} from '../utils/urBytesQr';

/**
 * Quiet zone around the modules (always white — never invert in dark mode).
 * ISO is ~4 modules; extra pad helps phone cameras lock on dense UR frames.
 */
export const UR_QR_QUIET_ZONE_PX = 32;

type AnimatedUrQrProps = {
  ur?: UR | null;
  pipePayload?: string;
  size: number;
  frameLabelStyle: StyleProp<TextStyle>;
  hintStyle: StyleProp<TextStyle>;
  containerStyle: StyleProp<ViewStyle>;
  hint?: string;
  fallbackText?: string;
  /** Changing this recreates the fountain encoder from the first frame. */
  restartNonce?: number;
  /** Override default UR fragment size (bytes). Larger = fewer denser frames. */
  maxFragmentLen?: number;
  /** Override default frame interval (ms). Lower = faster animation. */
  frameIntervalMs?: number;
};

const DEFAULT_HINT =
  'Large UTXO set — keep scanning until the other device finishes.';
const DEFAULT_FALLBACK = 'Could not render animated QR.';

const AnimatedUrQr: React.FC<AnimatedUrQrProps> = ({
  ur: urProp,
  pipePayload,
  size,
  frameLabelStyle,
  hintStyle,
  containerStyle,
  hint = DEFAULT_HINT,
  fallbackText = DEFAULT_FALLBACK,
  restartNonce = 0,
  maxFragmentLen = UR_BYTES_FRAGMENT_SIZE,
  frameIntervalMs = UR_FRAME_INTERVAL_MS,
}) => {
  const {theme} = useTheme();
  const isLightTheme = theme.colors.background === '#ffffff';
  const ur = useMemo(() => {
    if (urProp) {
      return urProp;
    }
    if (pipePayload) {
      return utf8ToUr(pipePayload);
    }
    return null;
  }, [urProp, pipePayload]);
  const totalParts = useMemo(
    () => (ur ? urFragmentCount(ur, maxFragmentLen) : 1),
    [ur, maxFragmentLen],
  );
  const [qrData, setQrData] = useState<string | null>(null);
  const [frameIndex, setFrameIndex] = useState(0);

  useEffect(() => {
    if (!ur) {
      setQrData(null);
      setFrameIndex(0);
      return;
    }
    let encoder = createUrEncoder(ur, maxFragmentLen);
    let emitted = 0;
    const wrapAfter = urFountainWrapAfter(totalParts);
    const pushNext = () => {
      if (emitted > 0 && emitted % wrapAfter === 0) {
        encoder = createUrEncoder(ur, maxFragmentLen);
        dbg('AnimatedUrQr: wrapped fountain encoder', {
          wrapAfter,
          totalParts,
        });
      }
      setQrData(encoder.nextPart());
      setFrameIndex(emitted);
      emitted += 1;
    };
    pushNext();
    const interval = setInterval(pushNext, frameIntervalMs);
    return () => clearInterval(interval);
  }, [ur, restartNonce, maxFragmentLen, frameIntervalMs, totalParts]);

  if (!qrData) {
    return <Text style={hintStyle}>{fallbackText}</Text>;
  }
  const displayFrame = totalParts > 0 ? (frameIndex % totalParts) + 1 : 1;
  return (
    <>
      <View style={containerStyle}>
        <View
          style={[
            styles.quietPlate,
            {
              borderColor: isLightTheme
                ? theme.colors.blackOverlay10
                : 'rgba(0,0,0,0.12)',
            },
          ]}>
          <QRCode
            value={qrData}
            size={size}
            color="#000000"
            backgroundColor="#FFFFFF"
            ecl="L"
            onError={(error: unknown) => {
              dbg('AnimatedUrQr: encode failed', error);
            }}
          />
        </View>
      </View>
      <Text style={frameLabelStyle}>
        Frame {displayFrame} of {totalParts}
      </Text>
      {hint ? <Text style={hintStyle}>{hint}</Text> : null}
    </>
  );
};

const styles = StyleSheet.create({
  quietPlate: {
    backgroundColor: '#FFFFFF',
    padding: UR_QR_QUIET_ZONE_PX,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
  },
});

export default AnimatedUrQr;
