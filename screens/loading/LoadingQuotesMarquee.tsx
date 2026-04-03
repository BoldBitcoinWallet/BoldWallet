import React, {useEffect, useMemo, useState} from 'react';
import {View, Text, Platform, Linking, StyleSheet} from 'react-native';
import {WebView} from 'react-native-webview';
import type {TextStyle, ViewStyle} from 'react-native';
import {
  buildManchetteMarqueeLine,
  buildQuotesMarqueeHtml,
  parseMarqueeLinkSegments,
  splitMarkdownBoldSegments,
  stripMarqueeMarkupForA11y,
} from './loadingQuotesMarqueeHtml';

export type LoadingQuotesMarqueeStyles = {
  strip: ViewStyle;
  lineWrap: ViewStyle;
  marqueeText: TextStyle;
  staticText: TextStyle;
  webMarquee: ViewStyle;
  webMarqueePlaceholder: ViewStyle;
};

const staticQuoteStyles = StyleSheet.create({
  linkUnderline: {
    textDecorationLine: 'underline',
  },
  bold: {
    fontWeight: '700',
  },
});

/** Reduced-motion path: same `**bold**` + `__<url>__` / `__https://…__` as the WebView marquee. */
function MarqueeStaticQuotesText({
  quotes,
  style,
}: {
  quotes: string[];
  style: TextStyle;
}) {
  const children: React.ReactNode[] = [];
  quotes.forEach((q, qi) => {
    if (qi > 0) {
      children.push('\n\n');
    }
    splitMarkdownBoldSegments(q).forEach((part, pi) => {
      const isBold = pi % 2 === 1;
      parseMarqueeLinkSegments(part).forEach((seg, si) => {
        if (seg.kind === 'link') {
          children.push(
            <Text
              key={`${qi}-${pi}-${si}-l`}
              onPress={() => {
                Linking.openURL(seg.href).catch(() => {});
              }}
              accessibilityRole="link"
              accessibilityLabel={`${seg.display}, opens in browser`}
              style={[
                style,
                staticQuoteStyles.linkUnderline,
                isBold ? staticQuoteStyles.bold : null,
              ]}>
              {seg.display}
            </Text>,
          );
        } else {
          children.push(
            <Text
              key={`${qi}-${pi}-${si}-t`}
              style={[style, isBold ? staticQuoteStyles.bold : null]}>
              {seg.value}
            </Text>,
          );
        }
      });
    });
  });
  const a11yLabel = quotes.map(stripMarqueeMarkupForA11y).join(' ');
  return (
    <Text selectable style={style} accessibilityLabel={a11yLabel}>
      {children}
    </Text>
  );
}

/** Open http(s) in the OS browser; marquee HTML has no other https loads. */
function openMarqueeUrlExternally(url: string): boolean {
  if (!/^https?:\/\//i.test(url)) {
    return false;
  }
  Linking.openURL(url).catch(() => {});
  return true;
}

/** Bottom manchette: WebView CSS ticker when motion is allowed; static text when reduced motion. */
export function LoadingQuotesMarquee({
  quotes,
  reduceMotion,
  styles: s,
  bottomInset = 0,
  appActive,
  textColor,
  fontSize,
}: {
  quotes: string[];
  reduceMotion: boolean;
  styles: LoadingQuotesMarqueeStyles;
  bottomInset?: number;
  appActive: boolean;
  textColor: string;
  fontSize: number;
}) {
  const segmentLine = useMemo(
    () => buildManchetteMarqueeLine(quotes),
    [quotes],
  );
  const stripStyle = useMemo(
    () => [s.strip, {paddingBottom: 10 + bottomInset}],
    [s.strip, bottomInset],
  );

  const [webReady, setWebReady] = useState(false);
  useEffect(() => {
    if (!appActive || reduceMotion || !segmentLine) {
      setWebReady(false);
      return;
    }
    const t = setTimeout(() => setWebReady(true), 600);
    return () => clearTimeout(t);
  }, [appActive, reduceMotion, segmentLine]);

  const htmlSource = useMemo(() => {
    if (!segmentLine) {
      return null;
    }
    const dur = Math.max(
      12,
      Math.min(90, Math.round(segmentLine.length * 0.15)),
    );
    return buildQuotesMarqueeHtml(
      segmentLine,
      dur,
      fontSize,
      textColor,
      Platform.OS === 'android',
    );
  }, [segmentLine, fontSize, textColor]);

  if (!segmentLine) {
    return null;
  }

  if (reduceMotion) {
    return (
      <View style={stripStyle} accessibilityRole="text">
        <MarqueeStaticQuotesText quotes={quotes} style={s.staticText} />
      </View>
    );
  }

  if (!appActive || !webReady || !htmlSource) {
    return (
      <View
        style={stripStyle}
        accessibilityRole="text"
        accessibilityLabel={quotes.join(' ')}>
        <View style={[s.lineWrap, s.webMarqueePlaceholder]} />
      </View>
    );
  }

  return (
    <View
      style={stripStyle}
      accessibilityRole="text"
      accessibilityLabel="Wallet quotes">
      <View style={s.lineWrap}>
        <WebView
          key={`${segmentLine.length}:${segmentLine.slice(0, 80)}`}
          originWhitelist={['*']}
          source={{html: htmlSource}}
          style={s.webMarquee}
          scrollEnabled={false}
          showsHorizontalScrollIndicator={false}
          showsVerticalScrollIndicator={false}
          bounces={false}
          overScrollMode="never"
          androidLayerType="hardware"
          setSupportMultipleWindows={true}
          opaque={false}
          textZoom={Platform.OS === 'android' ? 100 : undefined}
          onShouldStartLoadWithRequest={req => {
            if (openMarqueeUrlExternally(req.url)) {
              return false;
            }
            return true;
          }}
          onOpenWindow={e => {
            openMarqueeUrlExternally(e.nativeEvent.targetUrl);
          }}
        />
      </View>
    </View>
  );
}
