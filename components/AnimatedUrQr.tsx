import React, {useEffect, useMemo, useState} from 'react';
import {Text, View, type StyleProp, type TextStyle, type ViewStyle} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import type {UR} from '@ngraveio/bc-ur';
import {dbg} from '../utils';
import {
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
  const totalParts = useMemo(() => (ur ? urFragmentCount(ur) : 1), [ur]);
  const encoder = useMemo(
    () => (ur ? createUrEncoder(ur) : null),
    [ur, restartNonce],
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
    }, UR_FRAME_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [encoder]);

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
