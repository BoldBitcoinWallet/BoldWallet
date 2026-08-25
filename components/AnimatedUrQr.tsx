import React, {useEffect, useMemo, useState} from 'react';
import {Text, View, type StyleProp, type TextStyle, type ViewStyle} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import type {UR} from '@ngraveio/bc-ur';
import {dbg} from '../utils';
import {
  UR_BYTES_FRAGMENT_SIZE,
  UR_FRAME_INTERVAL_MS,
  createUrEncoder,
  urFragmentCount,
  utf8ToUr,
} from '../utils/urBytesQr';

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
  const encoder = useMemo(
    () => (ur ? createUrEncoder(ur, maxFragmentLen) : null),
    [ur, restartNonce, maxFragmentLen],
  );
  const [qrData, setQrData] = useState<string | null>(null);
  const [frameIndex, setFrameIndex] = useState(0);

  useEffect(() => {
    if (!encoder) {
      setQrData(null);
      setFrameIndex(0);
      return;
    }
    setQrData(encoder.nextPart());
    setFrameIndex(0);
    const interval = setInterval(() => {
      setQrData(encoder.nextPart());
      setFrameIndex(prev => prev + 1);
    }, frameIntervalMs);
    return () => clearInterval(interval);
  }, [encoder, frameIntervalMs]);

  if (!qrData) {
    return <Text style={hintStyle}>{fallbackText}</Text>;
  }
  const displayFrame = totalParts > 0 ? (frameIndex % totalParts) + 1 : 1;
  return (
    <>
      <View style={containerStyle}>
        <QRCode
          value={qrData}
          size={size}
          color="black"
          backgroundColor="white"
          ecl="L"
          onError={error => {
            dbg('AnimatedUrQr: encode failed', error);
          }}
        />
      </View>
      <Text style={frameLabelStyle}>
        Frame {displayFrame} of {totalParts}
      </Text>
      {hint ? <Text style={hintStyle}>{hint}</Text> : null}
    </>
  );
};

export default AnimatedUrQr;
