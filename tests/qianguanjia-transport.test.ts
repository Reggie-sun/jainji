import { beforeEach, expect, it, vi } from 'vitest';
const inner = vi.hoisted(() => ({ onmessage: undefined as undefined | ((message: object) => void), onclose: undefined as undefined | ((reason?: string) => void), send: vi.fn(), attach: vi.fn(async () => {}), close: vi.fn() }));
vi.mock('../src/main/qianchuan-picker-transport', () => ({ QianchuanPickerTransport: { connect: async () => inner } }));
import { QianguanjiaTransport } from '../src/main/qianguanjia-transport';
beforeEach(() => { vi.clearAllMocks(); inner.send.mockImplementation((message: { id: number; sessionId: string }) => { inner.onmessage?.({ id: message.id, sessionId: message.sessionId }); }); });
const attached = (targetId = 'chosen') => ({ method: 'Target.attachedToTarget', params: { sessionId: 'sdk-page-session', targetInfo: { targetId } } });
it('reannounces contexts only on the explicitly attached SDK session and consumes its replies', async () => {
  const transport = await QianguanjiaTransport.connect('ws://127.0.0.1:1234', 'chosen', new AbortController().signal);
  transport.onmessage = vi.fn(); inner.onmessage?.(attached());
  await transport.refreshMainWorld();
  expect(inner.send.mock.calls.map(([message]) => [message.method, message.sessionId])).toEqual([['Runtime.disable', 'sdk-page-session'], ['Runtime.enable', 'sdk-page-session']]);
  expect(transport.onmessage).toHaveBeenCalledTimes(1);
  await transport.attach(); expect(inner.attach).toHaveBeenCalledWith('chosen');
});
it('refuses another target and rejects mismatched response sessions', async () => {
  const transport = await QianguanjiaTransport.connect('ws://127.0.0.1:1234', 'chosen', new AbortController().signal);
  inner.onmessage?.(attached('other'));
  await expect(transport.refreshMainWorld()).rejects.toThrow(/上下文/); expect(inner.send).not.toHaveBeenCalled();
  inner.onmessage?.(attached());
  inner.send.mockImplementation((message: { id: number }) => inner.onmessage?.({ id: message.id, sessionId: 'other', error: { message: 'private-secret-token' } }));
  await expect(transport.refreshMainWorld()).rejects.toThrow('千管家页面上下文无法核对。');
});
it('settles its pending request on disconnect while forwarding ordinary protocol traffic', async () => {
  const transport = await QianguanjiaTransport.connect('ws://127.0.0.1:1234', 'chosen', new AbortController().signal);
  transport.onclose = vi.fn(); transport.onmessage = vi.fn(); inner.onmessage?.(attached()); inner.send.mockImplementation(() => {});
  const result = expect(transport.refreshMainWorld()).rejects.toThrow(/断开/);
  inner.onmessage?.({ id: 42, result: {} }); expect(transport.onmessage).toHaveBeenLastCalledWith({ id: 42, result: {} });
  inner.onclose?.(); await result; expect(transport.onclose).toHaveBeenCalledOnce();
});
