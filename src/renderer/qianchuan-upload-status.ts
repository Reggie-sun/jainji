import type { QianchuanUploadResult } from "../shared/douyin-upload";

export const qianchuanUploadLabels: Record<QianchuanUploadResult["state"], string> = {
  PENDING: "等待上传", CONNECTING_BROWSER: "连接浏览器", OPENING_UPLOAD_PAGE: "打开千川计划", UPLOADING: "上传文件", WAITING_UPLOAD_COMPLETE: "等待平台处理",
  WAITING_FOR_CONFIRMATION: "已上传，待确认", ACCEPTED: "平台已接收", FAILED_RETRYABLE: "可明确继续", FAILED_TERMINAL: "已停止", NEEDS_HUMAN: "需要人工处理", CANCELLED: "已停止", DISCARDED: "已删除上传任务",
};
