import {PixelRatio} from 'react-native';

/**
 * WKWebView maps the same CSS px to a much larger on-screen size than Android WebView
 * (often ~2× in practice). Scale iOS CSS so the ticker matches Android visually.
 */
export const WEB_MARQUEE_IOS_CSS_FONT_MULTIPLIER = 1;

export function escapeHtmlForWebMarquee(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Split on `**` — odd segments (1,3,…) are bold; even segments are plain. */
export function splitMarkdownBoldSegments(s: string): string[] {
  return s.split('**');
}

/** `__<url>__` (preferred) or `__https://…__` — opens in browser; URL must be http(s). */
export type MarqueeLinkSegment =
  | {kind: 'text'; value: string}
  | {kind: 'link'; href: string; display: string};

const MARQUEE_LINK_RE = /__<([^>]+)>__|__(https?:\/\/.+?)__/g;

function isHttpUrl(s: string): boolean {
  return /^https?:\/\//i.test(s.trim());
}

/**
 * Split one fragment on marquee link syntax. Unmatched / invalid URLs stay as plain text.
 * Use `__<https://…>__` when the URL can contain `__` (e.g. query strings).
 */
export function parseMarqueeLinkSegments(line: string): MarqueeLinkSegment[] {
  const segments: MarqueeLinkSegment[] = [];
  let last = 0;
  const re = new RegExp(MARQUEE_LINK_RE.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    if (m.index > last) {
      segments.push({kind: 'text', value: line.slice(last, m.index)});
    }
    const raw = (m[1] ?? m[2] ?? '').trim();
    if (isHttpUrl(raw)) {
      segments.push({kind: 'link', href: raw, display: raw});
    } else {
      segments.push({kind: 'text', value: m[0]});
    }
    last = m.index + m[0].length;
  }
  if (last < line.length) {
    segments.push({kind: 'text', value: line.slice(last)});
  }
  return segments;
}

/** Remove `**` and link wrappers for accessibility labels. */
export function stripMarqueeMarkupForA11y(s: string): string {
  return s
    .replace(/\*\*/g, '')
    .replace(/__<([^>]+)>__/g, '$1')
    .replace(/__(https?:\/\/.+?)__/g, '$1');
}

/** `**bold**` → `<strong>`; each segment HTML-escaped. */
export function marqueeMarkdownBoldToHtml(line: string): string {
  const parts = splitMarkdownBoldSegments(line);
  return parts
    .map((part, i) => {
      const escaped = escapeHtmlForWebMarquee(part);
      return i % 2 === 1 ? `<strong>${escaped}</strong>` : escaped;
    })
    .join('');
}

/** `**bold**` + `__<url>__` / `__https://…__` → HTML with `<a target="_blank">`. */
export function marqueeMarkdownLinksAndBoldToHtml(line: string): string {
  const parts = splitMarkdownBoldSegments(line);
  return parts
    .map((part, i) => {
      const inner = parseMarqueeLinkSegments(part)
        .map(seg => {
          if (seg.kind === 'link') {
            const href = escapeHtmlForWebMarquee(seg.href);
            const disp = escapeHtmlForWebMarquee(seg.display);
            return `<a href="${href}" target="_self" rel="noopener noreferrer">${disp}</a>`;
          }
          return marqueeMarkdownBoldToHtml(seg.value);
        })
        .join('');
      return i % 2 === 1 ? `<strong>${inner}</strong>` : inner;
    })
    .join('');
}

export function buildQuotesMarqueeHtml(
  singleLinePlain: string,
  durationSec: number,
  fontSizePx: number,
  colorCss: string,
  isAndroid: boolean,
): string {
  const escaped = marqueeMarkdownLinksAndBoldToHtml(singleLinePlain);
  const pad = '10px';
  const scaled = fontSizePx * PixelRatio.getFontScale();
  const cssFontPx =
    Math.round(
      scaled * (isAndroid ? 1.1 : WEB_MARQUEE_IOS_CSS_FONT_MULTIPLIER) * 100,
    ) / 100;
  const fontStack = isAndroid
    ? 'Roboto, sans-serif'
    : 'Helvetica Neue, Helvetica, Arial, sans-serif';
  const durJs = Number.isFinite(durationSec) ? durationSec : 30;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no"/>
<style>
 * { box-sizing: border-box; margin: 0; padding: 0; }
 html, body {
   width: 100%;
   height: 100%;
   overflow: hidden;
   background: transparent;
   -webkit-text-size-adjust: 100%;
   text-size-adjust: 100%;
 }
 .viewport {
   width: 100%;
   height: 100%;
   overflow: hidden;
   display: flex;
   align-items: center;
   touch-action: none;
   -webkit-user-select: none;
   user-select: none;
 }
 .track {
   display: flex;
   flex-direction: row;
   flex-wrap: nowrap;
   width: max-content;
   will-change: transform;
 }
 .seg {
   font-size: ${cssFontPx}px;
   line-height: 1.25;
   color: ${colorCss};
   font-family: ${fontStack};
   font-weight: 500;
   padding-right: ${pad};
   white-space: nowrap;
 }
 .seg strong {
   font-weight: 700;
 }
 .seg a {
   color: inherit;
   text-decoration: underline;
   font-weight: inherit;
 }
</style></head><body>
<div class="viewport"><div class="track"><span class="seg">${escaped}</span><span class="seg">${escaped}</span></div></div>
<script>
(function () {
  var DURATION = ${durJs};
  var track = document.querySelector('.track');
  var viewport = document.querySelector('.viewport');
  if (!track || !viewport) return;
  var segW = 0;
  var offset = 0;
  var pxPerSec = 0;
  var paused = false;
  var pointerDown = false;
  var lastX = 0;
  var lastTs = 0;
  var rafId = 0;

  function measure() {
    var seg = track.querySelector('.seg');
    segW = seg ? seg.offsetWidth : 0;
    pxPerSec = segW > 0 ? segW / DURATION : 0;
  }

  function wrapOffset() {
    if (segW <= 0) return;
    while (offset < -segW) offset += segW;
    while (offset > 0) offset -= segW;
  }

  function applyTransform() {
    track.style.transform = 'translate3d(' + offset + 'px,0,0)';
  }

  function tick(ts) {
    if (!paused && segW > 0) {
      var dt = lastTs ? (ts - lastTs) / 1000 : 0;
      lastTs = ts;
      if (dt > 0 && dt < 0.35) {
        offset -= pxPerSec * dt;
        wrapOffset();
      }
    } else {
      lastTs = ts;
    }
    applyTransform();
    rafId = requestAnimationFrame(tick);
  }

  function onDown(clientX) {
    pointerDown = true;
    paused = true;
    lastX = clientX;
    measure();
  }

  function onMove(clientX) {
    if (!pointerDown) return;
    var dx = clientX - lastX;
    lastX = clientX;
    offset += dx;
    wrapOffset();
    applyTransform();
  }

  function onUp() {
    if (!pointerDown) return;
    pointerDown = false;
    paused = false;
    lastTs = performance.now();
  }

  viewport.addEventListener(
    'touchstart',
    function (e) {
      if (e.touches.length !== 1) return;
      onDown(e.touches[0].clientX);
    },
    {passive: true}
  );
  viewport.addEventListener(
    'touchmove',
    function (e) {
      if (!pointerDown || e.touches.length !== 1) return;
      onMove(e.touches[0].clientX);
      e.preventDefault();
    },
    {passive: false}
  );
  viewport.addEventListener('touchend', onUp);
  viewport.addEventListener('touchcancel', onUp);

  viewport.addEventListener('mousedown', function (e) {
    onDown(e.clientX);
  });
  window.addEventListener('mousemove', function (e) {
    onMove(e.clientX);
  });
  window.addEventListener('mouseup', onUp);

  window.addEventListener('resize', function () {
    measure();
  });

  function start() {
    measure();
    requestAnimationFrame(function () {
      measure();
      lastTs = performance.now();
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(tick);
    });
  }
  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start);
})();
</script>
</body></html>`;
}

/**
 * Any whitespace (newlines, tabs, Unicode spaces, regular spaces) lets RN Text wrap to
 * many lines. Replace runs with NBSP so the string is one unbreakable line; only the
 * strip clips (overflow hidden), not per-line clipping inside Text.
 */
export function toMarqueeSingleLine(s: string): string {
  return s.replace(/[\u200B\uFEFF]/g, '').replace(/\s+/gu, '\u00A0');
}

export const MANCHETTE_QUOTE_SEPARATOR = '  •  ';

/**
 * Build one continuous string from all quotes, then coerce the whole thing to a single
 * unbreakable line for RN Text (NBSP, no wrapping). Order: concatenate first, treat once.
 */
export function buildManchetteMarqueeLine(quotes: string[]): string {
  const parts = quotes.map(q => q.trim()).filter(q => q.length > 0);
  if (parts.length === 0) {
    return '';
  }
  const fullLine = `${parts.join(
    MANCHETTE_QUOTE_SEPARATOR,
  )}${MANCHETTE_QUOTE_SEPARATOR}`;
  return toMarqueeSingleLine(fullLine);
}
