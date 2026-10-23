/**
 * Descrição curta do aparelho e do navegador a partir do user agent, para a telemetria da
 * página de teste (W0) e para os campos da coleta de dados (platform, device_model, browser).
 * Não serve para mudar comportamento: a experiência é a mesma em todos (princípio do plano).
 */

export type Platform = 'ios' | 'android' | 'desktop' | 'outro';

export interface DeviceInfo {
  platform: Platform;
  /** Ex.: "iOS 17.5", "Android 14", "Windows". */
  os: string;
  /** Ex.: "Safari 17.5", "Chrome 130", "Samsung Internet 26". */
  browser: string;
  /** Ex.: "iPhone", "SM-A145M". Vazio quando o navegador esconde (Chrome reduz o UA para "K"). */
  model: string;
  /** Nome do app quando é navegador embutido (Instagram, WhatsApp...), senão null. */
  embedded: string | null;
  /** Uma linha: "iPhone · iOS 17.5 · Safari 17.5". */
  summary: string;
}

const EMBEDDED: [RegExp, string][] = [
  [/Instagram/i, 'Instagram'],
  [/FBAN|FBAV|FB_IAB/i, 'Facebook'],
  [/WhatsApp/i, 'WhatsApp'],
  [/musical_ly|BytedanceWebview|TikTok/i, 'TikTok'],
  [/\bLine\//i, 'LINE'],
  [/Snapchat/i, 'Snapchat'],
  [/LinkedInApp/i, 'LinkedIn'],
];

function major(v: string | undefined): string {
  return v ? v.split('.').slice(0, 2).join('.') : '';
}

export function describeDevice(
  ua: string = typeof navigator !== 'undefined' ? navigator.userAgent : '',
  maxTouchPoints: number = typeof navigator !== 'undefined' ? navigator.maxTouchPoints ?? 0 : 0,
): DeviceInfo {
  const embedded = EMBEDDED.find(([re]) => re.test(ua))?.[1] ?? null;
  let platform: Platform = 'outro';
  let os = '';
  let model = '';
  let browser = '';

  const iosDevice = ua.match(/\b(iPhone|iPad|iPod)\b/)?.[1]
    ?? (/Macintosh/.test(ua) && maxTouchPoints > 1 ? 'iPad' : null);
  const android = ua.match(/Android\s([\d.]+)/);

  if (iosDevice) {
    platform = 'ios';
    model = iosDevice;
    const v = ua.match(/OS (\d+)[_.](\d+)/);
    const safariVersion = ua.match(/Version\/([\d.]+)/)?.[1];
    os = v ? `iOS ${v[1]}.${v[2]}` : safariVersion ? `iOS ${major(safariVersion)}` : 'iOS';
    const other = ua.match(/(CriOS|FxiOS|EdgiOS)\/([\d.]+)/);
    if (other) {
      const name = { CriOS: 'Chrome', FxiOS: 'Firefox', EdgiOS: 'Edge' }[other[1] as 'CriOS' | 'FxiOS' | 'EdgiOS'];
      browser = `${name} ${other[2].split('.')[0]} (motor Safari)`;
    } else if (safariVersion && /Safari\//.test(ua)) {
      browser = `Safari ${major(safariVersion)}`;
    } else {
      browser = 'WebView iOS';
    }
  } else if (android) {
    platform = 'android';
    os = `Android ${android[1]}`;
    const m = ua.match(/Android [^;)]+;\s*([^;)]+?)(?:\sBuild\/[^;)]*)?[;)]/);
    model = m && m[1] !== 'K' && m[1] !== 'wv' ? m[1].trim() : '';
    const samsung = ua.match(/SamsungBrowser\/([\d.]+)/);
    const edge = ua.match(/EdgA\/([\d.]+)/);
    const firefox = ua.match(/Firefox\/([\d.]+)/);
    const chrome = ua.match(/Chrome\/([\d.]+)/);
    if (samsung) browser = `Samsung Internet ${samsung[1].split('.')[0]}`;
    else if (edge) browser = `Edge ${edge[1].split('.')[0]}`;
    else if (firefox) browser = `Firefox ${firefox[1].split('.')[0]}`;
    else if (chrome) browser = `Chrome ${chrome[1].split('.')[0]}${/; wv\)/.test(ua) ? ' (WebView)' : ''}`;
    else browser = 'navegador Android';
  } else if (/Windows|Macintosh|Linux|CrOS/.test(ua)) {
    platform = 'desktop';
    os = /Windows/.test(ua) ? 'Windows' : /Macintosh/.test(ua) ? 'macOS' : /CrOS/.test(ua) ? 'ChromeOS' : 'Linux';
    const edge = ua.match(/Edg\/([\d.]+)/);
    const firefox = ua.match(/Firefox\/([\d.]+)/);
    const chrome = ua.match(/Chrome\/([\d.]+)/);
    const safari = ua.match(/Version\/([\d.]+).*Safari/);
    if (edge) browser = `Edge ${edge[1].split('.')[0]}`;
    else if (firefox) browser = `Firefox ${firefox[1].split('.')[0]}`;
    else if (chrome) browser = `Chrome ${chrome[1].split('.')[0]}`;
    else if (safari) browser = `Safari ${major(safari[1])}`;
  }

  if (!browser) browser = 'desconhecido';
  if (embedded) browser = `${embedded} (embutido)`;

  const summary = [model, os, browser].filter(Boolean).join(' · ');
  return { platform, os, browser, model, embedded, summary };
}

interface UADataHighEntropy {
  model?: string;
  platformVersion?: string;
}
type NavigatorUAData = Navigator & {
  userAgentData?: { getHighEntropyValues(hints: string[]): Promise<UADataHighEntropy> };
};

/**
 * Igual a describeDevice, mas pergunta o modelo ao navegador quando ele permite
 * (Client Hints do Chrome Android). No Safari volta o mesmo de describeDevice.
 */
export async function describeDeviceDetailed(): Promise<DeviceInfo> {
  const base = describeDevice();
  const uaData = (navigator as NavigatorUAData).userAgentData;
  if (!uaData || base.model) return base;
  try {
    const { model } = await uaData.getHighEntropyValues(['model', 'platformVersion']);
    if (!model) return base;
    return { ...base, model, summary: [model, base.os, base.browser].filter(Boolean).join(' · ') };
  } catch {
    return base;
  }
}
