import { useEffect, useState } from "react";
import type { BatchProductionDetail, BatchProductionDetailRequest } from "../shared/batch-production";

export function batchDetailError(cause: unknown): string {
  return cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "") : "无法读取作品，请返回列表重试。";
}

export function useBatchProductionDetails(request: BatchProductionDetailRequest, active: boolean) {
  const [detail, setDetail] = useState<BatchProductionDetail>();
  const [error, setError] = useState("");
  useEffect(() => { setDetail(undefined); setError(""); }, [request.runId, request.jobId]);
  useEffect(() => {
    if (!active) return;
    let current = true;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const next = await window.jianji.batchProductionDetails({ runId: request.runId, jobId: request.jobId });
        if (current) { setDetail(next); setError(""); }
      } catch (cause) { if (current) setError(batchDetailError(cause)); }
      finally { if (current) timer = setTimeout(() => void refresh(), 1000); }
    };
    void refresh();
    return () => { current = false; clearTimeout(timer); };
  }, [request.runId, request.jobId, active]);
  return { detail, error, setError };
}
