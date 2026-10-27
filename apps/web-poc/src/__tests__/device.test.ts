import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getDeviceId, reportDevice, __resetDeviceForTests } from '../lib/device';

// Aparelho da conta (lib/device.ts): código aleatório deste navegador e o aviso ao servidor depois de
// entrar e quando o idioma muda. A API é falsa: nada sai do teste.

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

const session = { token: 'id-token', userId: 'sub-1' };

function deps(over: Record<string, unknown> = {}) {
  const storage = memoryStorage();
  const fetch = vi.fn(async () => new Response('{"known":false}', { status: 200 }));
  return {
    storage,
    fetch,
    over: { fetch, storage, getSession: async () => session, apiBase: '/api', timeZone: () => 'America/Sao_Paulo', ...over },
  };
}

beforeEach(() => __resetDeviceForTests());

describe('código do aparelho', () => {
  it('é aleatório, criado uma vez e guardado neste navegador', () => {
    const storage = memoryStorage();
    const id = getDeviceId(storage);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(getDeviceId(storage)).toBe(id);
    expect(storage.data.get('librax_deviceId')).toBe(id);
    expect(getDeviceId(memoryStorage())).not.toBe(id);
  });

  it('valor estranho guardado é trocado por um novo', () => {
    const storage = memoryStorage();
    storage.setItem('librax_deviceId', '<script>');
    expect(getDeviceId(storage)).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('reportDevice', () => {
  it('manda o código, o idioma e o fuso com o id token; não repete a mesma combinação', async () => {
    const { fetch, over, storage } = deps();
    expect(await reportDevice('en', over)).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/v1/users/me/devices');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer id-token');
    expect(JSON.parse(init.body as string)).toEqual({
      deviceId: storage.data.get('librax_deviceId'),
      lang: 'en',
      timezone: 'America/Sao_Paulo',
    });

    expect(await reportDevice('en', over)).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
    // idioma novo: avisa de novo (os e-mails seguem o idioma do app)
    expect(await reportDevice('es', over)).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('convidado (sem sessão) não chama a API', async () => {
    const { fetch, over } = deps({ getSession: async () => null });
    expect(await reportDevice('pt-BR', over)).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('falha de rede ou da API não quebra nada e tenta de novo depois', async () => {
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce(new Response('{}', { status: 500 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    const { over } = deps({ fetch });
    expect(await reportDevice('pt-BR', over)).toBe(false);
    expect(await reportDevice('pt-BR', over)).toBe(false);
    expect(await reportDevice('pt-BR', over)).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});
