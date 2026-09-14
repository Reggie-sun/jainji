import type { ExportSettings } from "../shared/export-settings";

export function ExportSettingsPanel({ value, onChange, disabled }: {
  value: ExportSettings; onChange(value: ExportSettings): void; disabled: boolean;
}) {
  return <div role="group" aria-label="导出设置">
    <label className="export-format" htmlFor="export-resolution">分辨率<select id="export-resolution" value={value.resolutionMode} disabled={disabled} onChange={(event) => onChange({ ...value, resolutionMode: event.target.value as ExportSettings["resolutionMode"] })}>
      <option value="720p">720p（默认）</option><option value="1080p">1080p</option><option value="source">原分辨率</option>
    </select></label>
    <label className="export-format" htmlFor="export-framerate">帧率<select id="export-framerate" value={value.frameRateMode} disabled={disabled} onChange={(event) => onChange({ ...value, frameRateMode: event.target.value as ExportSettings["frameRateMode"] })}>
      <option value="source">原帧率（默认）</option><option value="30">30 fps</option>
    </select></label>
    <label className="export-format" htmlFor="export-quality">画质<select id="export-quality" value={value.quality} disabled={disabled} onChange={(event) => onChange({ ...value, quality: event.target.value as ExportSettings["quality"] })}>
      <option value="high">高画质 · 文件较大</option><option value="balanced">均衡（默认）</option><option value="small">较小文件</option>
    </select></label>
    <p>{value.resolutionMode === "source" ? "保留原尺寸，可能不满足上传平台的尺寸要求。" : value.resolutionMode === "720p" ? "竖版 720×1280，横版 1280×720；等比缩放并补边。" : "竖版 1080×1920，横版 1920×1080；等比缩放并补边。"} 每个版本使用以上设置，重试沿用制作时的设置。</p>
  </div>;
}
