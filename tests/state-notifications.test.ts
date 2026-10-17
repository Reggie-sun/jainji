import { afterEach, expect, it, vi } from "vitest";
import { StateNotifications } from "../src/main/state-notifications";

afterEach(() => vi.useRealTimers());

function fixture() {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  let revision = 0;
  let available = true;
  const read = vi.fn(async () => revision);
  const send = vi.fn();
  const notifications = new StateNotifications({ read, send, available: () => available });
  return { notifications, read, send, update: (value: number) => { revision = value; notifications.request(); }, close: () => { available = false; } };
}

it("paces a continuous progress stream while delivering its latest revision", async () => {
  const f = fixture();
  f.update(0);
  await vi.advanceTimersByTimeAsync(0);
  expect(f.send.mock.calls).toEqual([[0]]);
  for (let revision = 1; revision <= 100; revision++) {
    f.update(revision);
    await vi.advanceTimersByTimeAsync(10);
  }
  expect(f.read).toHaveBeenCalledTimes(3);
  expect(f.send.mock.calls).toEqual([[0], [50], [100]]);
  await vi.advanceTimersByTimeAsync(1000);
  expect(f.read).toHaveBeenCalledTimes(3);
});

it("keeps one reader in flight and delivers a final update arriving during that read", async () => {
  const f = fixture();
  let finish!: (value: number) => void;
  f.read.mockImplementationOnce(() => new Promise<number>(resolve => { finish = resolve; }));
  f.update(1);
  await vi.advanceTimersByTimeAsync(0);
  f.update(2);
  await vi.advanceTimersByTimeAsync(800);
  expect(f.read).toHaveBeenCalledTimes(1);
  f.update(3);
  finish(1);
  await vi.advanceTimersByTimeAsync(0);
  expect(f.send.mock.calls).toEqual([[1], [3]]);
  expect(f.read).toHaveBeenCalledTimes(2);
});

it("does not send to a closed window or build a pending snapshot after it closes", async () => {
  const f = fixture();
  let finish!: (value: number) => void;
  f.read.mockImplementationOnce(() => new Promise<number>(resolve => { finish = resolve; }));
  f.update(1);
  await vi.advanceTimersByTimeAsync(0);
  f.update(2);
  f.close();
  finish(1);
  await vi.advanceTimersByTimeAsync(1000);
  expect(f.send).not.toHaveBeenCalled();
  expect(f.read).toHaveBeenCalledTimes(1);
});

it("recovers from a failed read on the next invalidation without a hot retry loop", async () => {
  const f = fixture();
  f.read.mockRejectedValueOnce(new Error("temporarily unavailable"));
  f.update(1);
  await vi.advanceTimersByTimeAsync(2000);
  expect(f.read).toHaveBeenCalledTimes(1);
  f.update(2);
  await vi.advanceTimersByTimeAsync(0);
  expect(f.send.mock.calls).toEqual([[2]]);
});
