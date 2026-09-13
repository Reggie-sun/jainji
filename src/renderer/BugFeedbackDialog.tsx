import { useEffect, useRef, useState, type ClipboardEvent } from "react";
import { BugFeedbackSchema, FEEDBACK_REPOSITORY, MAX_FEEDBACK_IMAGE_BYTES, redactFeedback, type BugFeedback, type FeedbackHistoryEntry, type FeedbackReceipt, type FeedbackScreenshot, type FeedbackStatus } from "../shared/bug-feedback";
import { Icon } from "./ui";
import "./bug-feedback.css";

export function BugFeedbackDialog({ open, page, onClose }: { open: boolean; page: BugFeedback["page"]; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const previousFocus = useRef<HTMLElement>();
  const fileInput = useRef<HTMLInputElement>(null);
  const submitting = useRef(false);
  const readingImage = useRef(false);
  const [status, setStatus] = useState<FeedbackStatus>();
  const [description, setDescription] = useState("");
  const [screenshot, setScreenshot] = useState<FeedbackScreenshot>();
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState<BugFeedback>();
  const [receipt, setReceipt] = useState<FeedbackReceipt>();
  const [history, setHistory] = useState<FeedbackHistoryEntry[]>([]);
  const frozen = busy || Boolean(attempt);

  const message = (value: unknown) => setError(value instanceof Error ? value.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "") : "操作失败，请重试。");
  useEffect(() => {
    if (!open) { previousFocus.current?.focus(); previousFocus.current = undefined; setToken(""); return; }
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    dialog.current?.showModal();
    let active = true;
    void window.jianji.feedbackStatus().then((next) => { if (active) setStatus(next); }).catch((value) => { if (active) message(value); });
    void window.jianji.feedbackHistory().then((next) => { if (active) setHistory(next); }).catch((value) => { if (active) message(value); });
    return () => { active = false; };
  }, [open]);

  const close = () => { if (!submitting.current && !readingImage.current) onClose(); };
  const configure = async (value: string) => {
    if (submitting.current) return;
    submitting.current = true; setBusy(true); setError("");
    try { setStatus(await window.jianji.configureFeedback(value)); setToken(""); }
    catch (value) { message(value); }
    finally { submitting.current = false; setBusy(false); }
  };
  const loadImage = async (file: File) => {
    if (frozen || readingImage.current) return;
    readingImage.current = true; setImageBusy(true); setError("");
    try {
      if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || !file.size || file.size > MAX_FEEDBACK_IMAGE_BYTES) throw new Error("截图仅支持不超过 5 MB 的 PNG、JPEG 或 WebP。");
      const bitmap = await createImageBitmap(file); bitmap.close();
      const dataBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1]);
        reader.onerror = () => reject(new Error("截图读取失败，请重新选择。"));
        reader.readAsDataURL(file);
      });
      setScreenshot({ contentType: file.type as FeedbackScreenshot["contentType"], dataBase64 });
    } catch { setError("截图读取失败，请选择不超过 5 MB 的有效 PNG、JPEG 或 WebP 图片。"); }
    finally { readingImage.current = false; setImageBusy(false); if (fileInput.current) fileInput.current.value = ""; }
  };
  const paste = (event: ClipboardEvent) => {
    const file = [...event.clipboardData.items].find((item) => item.kind === "file" && item.type.startsWith("image/"))?.getAsFile();
    if (file) { event.preventDefault(); void loadImage(file); }
  };
  const submit = async () => {
    if (submitting.current || readingImage.current) return;
    const input = attempt ?? { feedbackId: crypto.randomUUID(), description: description.trim(), page, ...(screenshot ? { screenshot } : {}) };
    if (!BugFeedbackSchema.safeParse(input).success) { setError("请填写 5–8000 字的问题描述。"); return; }
    submitting.current = true; setBusy(true); setError(""); setAttempt(input);
    try { setReceipt(await window.jianji.submitFeedback(input)); }
    catch (value) { message(value); }
    finally { submitting.current = false; setBusy(false); void window.jianji.feedbackHistory().then(setHistory).catch(message); }
  };
  const resume = async (entry: FeedbackHistoryEntry) => {
    if (submitting.current || readingImage.current) return;
    submitting.current = true; setBusy(true); setError("");
    try { setReceipt(await window.jianji.resumeFeedback(entry.feedbackId)); }
    catch (value) { message(value); }
    finally { submitting.current = false; setBusy(false); void window.jianji.feedbackHistory().then(setHistory).catch(message); }
  };
  const newFeedback = () => { setAttempt(undefined); setReceipt(undefined); setError(""); setDescription(""); setScreenshot(undefined); };

  if (!open) return null;
  return <dialog ref={dialog} className="feedback-dialog" aria-labelledby="feedback-title" onCancel={(event) => { event.preventDefault(); close(); }} onPaste={paste}>
    <div className="feedback-heading"><div><span className="eyebrow">HELP US IMPROVE</span><h2 id="feedback-title">反馈问题</h2></div><button className="icon-button" aria-label="关闭问题反馈" disabled={busy || imageBusy} onClick={close}><Icon name="close" size={20} /></button></div>
    <p className="feedback-intro">反馈将提交到 GitHub：<strong>{FEEDBACK_REPOSITORY}</strong></p>
    {error && <p className="notice error" role="alert">{error}</p>}
    {!receipt && history.length > 0 && <details className="feedback-history" open={history.some((entry) => !entry.receipt)}><summary>最近的反馈 · 重启后可在此找回</summary><ul>{history.map((entry) => <li key={entry.feedbackId}><span>{entry.description.slice(0, 60)}</span><button className="text-button" disabled={busy || imageBusy} onClick={() => void resume(entry)}>{entry.receipt ? `查看回执 #${entry.receipt.issueNumber}` : "恢复 / 核对反馈"}</button></li>)}</ul></details>}
    {receipt ? <div className="feedback-receipt" role="status">
      <Icon name="check" size={32} /><h3>已提交 Issue #{receipt.issueNumber}</h3><p>问题已收到，可在 GitHub 查看后续进展。</p>
      <button className="button primary" onClick={() => void window.jianji.openFeedback(receipt.feedbackId).catch(message)}>打开 Issue #{receipt.issueNumber}</button>
      {receipt.hasScreenshot && <><p>截图保存在本机，尚未上传。打开截图所在文件夹后，可将图片拖入 GitHub Issue 评论中。</p><button className="button secondary" onClick={() => void window.jianji.revealFeedbackScreenshot(receipt.feedbackId).catch(message)}>打开截图所在文件夹</button></>}
      <button className="text-button" onClick={newFeedback}>再反馈一个问题</button>
    </div> : <>
      <details className="feedback-settings" open={status ? !status.configured : false}>
        <summary>GitHub 提交配置 · {status?.configured ? "已配置" : "未配置"}</summary>
        <p>使用仅授权此仓库、具有 Issues 读写权限的 GitHub Token。Token 只保存在本机，不写入项目；环境变量配置优先。</p>
        {status?.credentialSource === "environment" ? <p>正在使用 JIANJI_GITHUB_TOKEN 环境变量。</p> : <div className="feedback-token"><label htmlFor="feedback-token">GitHub Token</label><input id="feedback-token" type="password" autoComplete="off" value={token} onChange={(event) => setToken(event.target.value)} disabled={busy} placeholder={status?.configured ? "输入新的 Token 以替换" : "输入 GitHub Token"} /><div className="feedback-actions"><button className="button secondary compact" disabled={busy || !token.trim()} onClick={() => void configure(token)}>保存 Token</button>{status?.configured && <button className="text-button" disabled={busy} onClick={() => void configure("")}>删除本地 Token</button>}</div></div>}
      </details>
      <label className="feedback-label" htmlFor="feedback-description">问题描述 <span>必填 · {description.length}/8000</span></label>
      <textarea id="feedback-description" autoFocus rows={5} maxLength={8000} value={description} disabled={frozen} onChange={(event) => setDescription(event.target.value)} placeholder="你进行了什么操作？期望发生什么？实际发生了什么？" />
      <div className="feedback-label">截图 <span>可选 · PNG / JPEG / WebP，最多 5 MB</span></div>
      <div className="feedback-image"><input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" aria-label="选择反馈截图" disabled={frozen || imageBusy} onChange={(event) => { const file = event.target.files?.[0]; if (file) void loadImage(file); }} />
        {screenshot && <><img alt="待保存的问题截图" src={`data:${screenshot.contentType};base64,${screenshot.dataBase64}`} /><button className="text-button" disabled={frozen || imageBusy} onClick={() => setScreenshot(undefined)}>移除截图</button></>}
        <p>{imageBusy ? "正在读取截图…" : "支持粘贴截图。截图只保存在本机，提交后可手动附加到 Issue。"}</p>
      </div>
      <details className="feedback-preview"><summary>查看将提交的问题描述</summary><pre>{redactFeedback(description) || "填写问题描述后可预览。"}</pre></details>
      <p className="feedback-privacy">自动附带应用版本、系统类型、当前页面与时间。不会自动收集视频、项目、模型配置或日志；请检查描述和截图，避免包含私人信息。常见凭据与路径会从描述中脱敏。</p>
      {attempt && <p className="feedback-privacy">本次内容已冻结，可重试核对原提交。若要改写，请先到仓库确认是否已建单，再开始新的反馈。</p>}
      <div className="feedback-actions"><button className="text-button" disabled={busy} onClick={() => void window.jianji.openFeedbackRepository().catch(message)}>查看仓库 Issues</button>{attempt && <button className="text-button" disabled={busy} onClick={newFeedback}>开始新的反馈</button>}<button className="button primary" disabled={busy || imageBusy || !status?.configured || description.trim().length < 5} onClick={() => void submit()}>{busy ? "正在处理…" : attempt ? "重试 / 核对提交" : "提交到 GitHub"}</button></div>
    </>}
  </dialog>;
}
