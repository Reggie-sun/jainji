import type { QianchuanPlanListRequest, QianchuanPlanOption } from "../shared/qianchuan-plan-selection";

interface Request {
  id: string;
  consumers: number;
  completed: boolean;
  promise: Promise<QianchuanPlanOption[]>;
  releaseTimer?: ReturnType<typeof setTimeout>;
}
const requests = new Map<string, Request>();

/** A lease lasts only for a mounted selector; no catalog is cached after completion. */
export function acquireQianchuanPlans(input: QianchuanPlanListRequest): { promise: Promise<QianchuanPlanOption[]>; release(): void } {
  const key = JSON.stringify([input.product, input.expectedAdvertiserId, input.refresh === true]);
  let request = requests.get(key);
  if (!request) {
    const id = crypto.randomUUID();
    const current: Request = { id, consumers: 0, completed: false, promise: Promise.resolve([]) };
    // A Vite update may arrive while the previous main process still exports videos.
    const cancellable = typeof window.jianji.cancelQianchuanPlans === "function";
    current.promise = window.jianji.listQianchuanPlans({ ...input, ...(cancellable ? { requestId: id } : {}) }).finally(() => {
      current.completed = true;
      if (requests.get(key) === current) requests.delete(key);
    });
    requests.set(key, current);
    request = current;
  }
  const current = request;
  clearTimeout(current.releaseTimer);
  current.consumers++;
  let released = false;
  return { promise: current.promise, release() {
    if (released) return;
    released = true;
    if (--current.consumers || current.completed) return;
    // StrictMode releases and immediately reacquires the same request.
    current.releaseTimer = setTimeout(() => {
      if (current.consumers || current.completed) return;
      if (requests.get(key) === current) requests.delete(key);
      void window.jianji.cancelQianchuanPlans?.({ requestId: current.id }).catch(() => undefined);
    }, 0);
  } };
}
