import { describe, it, expect, vi, afterEach } from 'vitest';
import { haptic, hapticPattern, Haptics } from '../lib/haptics';
import { tokens } from '../styles/tokens';

const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Chrome/129.0 Mobile Safari/537.36';
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1';

function mockNavigator(userAgent: string) {
  const vibrate = vi.fn(() => true);
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(userAgent);
  Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true, writable: true });
  return vibrate;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('haptics', () => {
  it('usa os padroes dos tokens', () => {
    expect(hapticPattern('correct')).toEqual(tokens['haptic.correct'].web);
    expect(hapticPattern('courseDone')).toEqual(tokens['haptic.courseDone'].web);
  });

  it('erro nunca vibra', () => {
    const vibrate = mockNavigator(ANDROID_UA);
    expect(hapticPattern('wrong')).toEqual([]);
    haptic('wrong');
    Haptics.wrong();
    expect(vibrate).not.toHaveBeenCalled();
  });

  it('vibra no Android com o padrao do token', () => {
    const vibrate = mockNavigator(ANDROID_UA);
    Haptics.correctCamera();
    expect(vibrate).toHaveBeenCalledWith([...tokens['haptic.correctCamera'].web]);
  });

  it('nao chama a Vibration API no iOS', () => {
    const vibrate = mockNavigator(IPHONE_UA);
    Haptics.achievement();
    expect(vibrate).not.toHaveBeenCalled();
  });

  it('respeita a opcao desligada', () => {
    const vibrate = mockNavigator(ANDROID_UA);
    haptic('tap', false);
    expect(vibrate).not.toHaveBeenCalled();
  });
});
