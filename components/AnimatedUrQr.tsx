import React, {useEffect, useMemo, useRef, useState} from 'react';
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
  /** When false, the parent draws the frame count outside the quiet zone. */
  showFrameLabel?: boolean;
  onFrame?: (frame: number, total: number) => void;
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
  showFrameLabel = true,
  onFrame,
}) => {
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;
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

  const displayFrame = totalParts > 0 ? (frameIndex % totalParts) + 1 : 1;
  useEffect(() => {
    if (!qrData) {
      return;
    }
    onFrameRef.current?.(displayFrame, totalParts);
  }, [qrData, displayFrame, totalParts]);

  if (!qrData) {
    return <Text style={hintStyle}>{fallbackText}</Text>;
  }
  return (
    <>
      <View style={containerStyle}>
        <View style={styles.quietPlate}>
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
      {showFrameLabel ? (
        <Text style={frameLabelStyle}>
          Frame {displayFrame} of {totalParts}
        </Text>
      ) : null}
      {hint ? <Text style={hintStyle}>{hint}</Text> : null}
    </>
  );
};

const styles = StyleSheet.create({
  quietPlate: {
    backgroundColor: '#FFFFFF',
    padding: UR_QR_QUIET_ZONE_PX,
  },
});

export default AnimatedUrQr;
