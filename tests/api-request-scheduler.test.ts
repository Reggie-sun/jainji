import { expect, it, vi } from "vitest";
import { ApiRequestScheduler } from "../src/main/api-request-scheduler";

const connection = { baseUrl: "https://fixture.invalid/v1", apiKey: "test-only", model: "vision" };
it("overlaps up to three requests across models sharing credentials and refills after failure", async () => {
  const scheduler = new ApiRequestScheduler(), signal = new AbortController().signal;
  const started: number[] = [], release: Array<() => void> = [];
  const jobs = Array.from({ length: 4 }, (_, index) => scheduler.run({ ...connection, model: `model-${index}`, baseUrl: `${connection.baseUrl}${index % 2 ? "/" : ""}` }, 0, signal, async () => {
    started.push(index);
    await new Promise<void>(resolve => release[index] = resolve);
    if (index === 0) throw new Error("provider failure");
    return index;
  }));
  const done = Promise.allSettled(jobs);
  try {
    await vi.waitFor(() => expect(started).toEqual([0, 1, 2]));
    release[0]();
    await vi.waitFor(() => expect(started).toEqual([0, 1, 2, 3]));
  } finally {
    // Also drain the old serial implementation when the red assertion fails.
    for (let index = 0; index < 4; index++) {
      await vi.waitFor(() => expect(release[index]).toBeTypeOf("function")); release[index]();
    }
  }
  expect((await done).map(result => result.status)).toEqual(["rejected", "fulfilled", "fulfilled", "fulfilled"]);
});

it("preserves start spacing while earlier requests are still in flight", async () => {
  vi.useFakeTimers();
  const releases: Array<() => void> = [], starts: number[] = [];
  const scheduler = new ApiRequestScheduler();
  const jobs = [0, 1, 2].map(() => scheduler.run(connection, 1000, new AbortController().signal, async () => {
    starts.push(Date.now()); await new Promise<void>(resolve => releases.push(resolve));
  }));
  try {
    await vi.advanceTimersByTimeAsync(0); expect(starts).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(999); expect(starts).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1); expect(starts).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1000); expect(starts).toHaveLength(3);
    expect(starts[1] - starts[0]).toBe(1000); expect(starts[2] - starts[1]).toBe(1000);
  } finally {
    for (let index = 0; index < 3; index++) { releases[index]?.(); await vi.advanceTimersByTimeAsync(1000); }
    await Promise.all(jobs); vi.useRealTimers();
  }
});

it("never starts a cancelled waiter and does not block other credentials", async () => {
  const scheduler = new ApiRequestScheduler(), signal = new AbortController().signal;
  const releases: Array<() => void> = [];
  const active = [0, 1, 2].map(() => scheduler.run(connection, 0, signal, () => new Promise<void>(resolve => releases.push(resolve))));
  await vi.waitFor(() => expect(releases).toHaveLength(3));
  const cancelled = new AbortController(), never = vi.fn();
  const waiting = scheduler.run(connection, 0, cancelled.signal, never);
  const result = waiting.catch(error => error);
  cancelled.abort(new Error("cancelled"));
  try {
    await expect(scheduler.run({ ...connection, apiKey: "independent" }, 0, signal, async () => "ok")).resolves.toBe("ok");
  } finally { releases.forEach(release => release()); await Promise.all(active); }
  expect(await result).toMatchObject({ message: "cancelled" });
  expect(never).not.toHaveBeenCalled();
  await expect(scheduler.run(connection, 0, signal, async () => "next")).resolves.toBe("next");
});
