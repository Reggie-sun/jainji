import type { QianchuanUploadResult, QianchuanUploadTaskStatus } from "../shared/douyin-upload";

export const qianchuanUploadLabels: Record<QianchuanUploadResult["state"], string> = {
  PENDING: "等待上传", CONNECTING_BROWSER: "连接浏览器", OPENING_UPLOAD_PAGE: "打开千川计划", UPLOADING: "上传文件", WAITING_UPLOAD_COMPLETE: "等待平台处理",
  WAITING_FOR_CONFIRMATION: "已上传，待确认", ACCEPTED: "平台已接收", FAILED_RETRYABLE: "可明确继续", FAILED_TERMINAL: "已停止", NEEDS_HUMAN: "需要人工处理", CANCELLED: "已停止", DISCARDED: "已删除上传任务",
};

export function qianchuanUploaded(task: QianchuanUploadTaskStatus): boolean {
  return ["READY", "ACCEPTED"].includes(task.upload_outcome) || task.rowReady === true && task.state === "WAITING_UPLOAD_COMPLETE" && task.upload_outcome === "MAY_HAVE_UPLOADED" && !task.failure;
}

export function qianchuanUploadLabel(task: QianchuanUploadTaskStatus): string {
  return task.rowReady && qianchuanUploaded(task) && task.state === "WAITING_UPLOAD_COMPLETE" ? "已上传，等待整批处理" : qianchuanUploadLabels[task.state];
}
