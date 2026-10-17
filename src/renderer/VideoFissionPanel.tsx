import { useEffect, useRef, useState, type ReactNode } from "react";
import { fissionAllocation, MAX_FISSION_OUTPUTS } from "../shared/video-fission";
import "./video-fission.css";

type MediaOption = { id: string; displayName: string };

type Props = {
  media: MediaOption[];
  selected: string[];
  disabled: boolean;
  engineReady: boolean;
  inputDirectory: string;
  outputDirectory: string;
  uploadControls?: ReactNode;
  onSelection(ids: string[]): void;
  onImport(): void;
  onOutput(): void;
  onAutomaticOutput(): void;
  onStart(total: number): void;
  onResults(): void;
};

export function VideoFissionPanel({
  media,
  selected,
  disabled,
  engineReady,
  inputDirectory,
  outputDirectory,
  uploadControls,
  onSelection,
  onImport,
  onOutput,
  onAutomaticOutput,
  onStart,
  onResults,
}: Props) {
  const [total, setTotal] = useState<number | "">(100);
  const selectAllRef = useRef<HTMLInputElement>(null);
  const hasInputDirectory = inputDirectory.trim().length > 0;
  const visibleMedia = hasInputDirectory ? media : [];
  const selectedIds = new Set(selected);
  const selectedMedia = visibleMedia.filter(item => selectedIds.has(item.id));
  const allSelected = visibleMedia.length > 0 && selectedMedia.length === visibleMedia.length;
  const someSelected = selectedMedia.length > 0 && !allSelected;

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someSelected;
  }, [someSelected]);

  const validTotal = typeof total === "number"
    && Number.isInteger(total)
    && total >= 1
    && total <= MAX_FISSION_OUTPUTS
    ? total
    : null;
  const validSourceCount = selectedMedia.length >= 1 && selectedMedia.length <= MAX_FISSION_OUTPUTS;
  const allocation = validTotal !== null && validSourceCount
    ? fissionAllocation(selectedMedia.length, validTotal)
    : [];
  const allocatedTotal = allocation.length > 0
    ? allocation.reduce((sum, count) => sum + count, 0)
    : null;
  const allocationById = new Map<string, number>();
  allocation.forEach((count, index) => allocationById.set(selectedMedia[index].id, count));
  const canStart = !disabled
    && engineReady
    && validSourceCount
    && validTotal !== null
    && allocatedTotal === validTotal;

  const changeSelection = (id: string, checked: boolean) => {
    const next = new Set(selectedMedia.map(item => item.id));
    if (checked) next.add(id);
    else next.delete(id);
    onSelection(visibleMedia.filter(item => next.has(item.id)).map(item => item.id));
  };

  const start = () => {
    if (canStart && validTotal !== null) onStart(validTotal);
  };

  const startMessages = [
    disabled ? "任务处理中，暂不能修改设置或开始新的裂变。" : "",
    !hasInputDirectory ? "请先选择视频输入目录。" : "",
    hasInputDirectory && selectedMedia.length === 0 ? "请至少选择 1 个素材。" : "",
    selectedMedia.length > MAX_FISSION_OUTPUTS ? `单次最多选择${MAX_FISSION_OUTPUTS}条素材，请取消部分选择。` : "",
    validTotal === null ? `条数须为 1 到 ${MAX_FISSION_OUTPUTS} 的整数。` : "",
    !engineReady ? "引擎尚未就绪，准备完成后即可开始。" : "",
  ].filter(Boolean);

  return <section className="video-fission-panel" aria-labelledby="video-fission-title">
    <div className="section-heading video-fission-heading">
      <h1 id="video-fission-title">本地视频裂变</h1>
      <p>选择素材和成片条数，预览每条源素材的分配数量后开始生成。</p>
    </div>

    <div className="card video-fission-card">
      <div className="video-fission-intro">
        <p>本地裂变会轻微变速（0.97–1.0756 倍，时长会随之变化）、调色并等比缩小补边；完整保留口播、字幕和原边框，不加贴纸。</p>
        <small>自动微调色温、色调、色相、曝光、高光、阴影、黑白场、自然饱和度、锐化、颗粒、暗角，以及对比度、饱和度、亮度和 Gamma；仅使用极小幅度，尽量保持原有观感。</small>
        <small>生成的视频保存在所选目录；可按需启用下方千川自动上传。</small>
      </div>

      <div className="video-fission-settings">
        <div className="video-fission-input-directory">
          <span>视频输入目录</span>
          <button type="button" className="directory-picker video-fission-directory-picker" disabled={disabled} onClick={onImport}>
            <span>{inputDirectory || "请选择视频输入目录"}</span>
          </button>
        </div>

        <label className="video-fission-total" htmlFor="video-fission-total">
          <span>成片总数</span>
          <input
            id="video-fission-total"
            type="number"
            min={1}
            max={MAX_FISSION_OUTPUTS}
            step={1}
            value={total}
            disabled={disabled}
            aria-describedby="video-fission-total-note"
            onChange={event => {
              const value = event.currentTarget.value;
              setTotal(value === "" ? "" : Number(value));
            }}
          />
          <small id="video-fission-total-note">1–{MAX_FISSION_OUTPUTS} 条</small>
        </label>

        <div className="video-fission-output">
          <span>输出目录</span>
          <button type="button" className="directory-picker video-fission-directory-picker" disabled={disabled} onClick={onOutput}>
            <span>{outputDirectory || "自动创建裂变目录"}</span>
          </button>
          {outputDirectory && <button type="button" className="text-button video-fission-automatic-output" disabled={disabled} onClick={onAutomaticOutput}>使用自动目录</button>}
        </div>
      </div>

      <section className="video-fission-materials" aria-labelledby="video-fission-material-title">
        <div className="video-fission-section-heading">
          <div>
            <h2 id="video-fission-material-title">源素材</h2>
            <small>已选 {selectedMedia.length} / {visibleMedia.length}</small>
          </div>
          <label className="video-fission-select-all">
            <input
              ref={selectAllRef}
              type="checkbox"
              checked={allSelected}
              disabled={disabled || visibleMedia.length === 0}
              onChange={event => onSelection(event.currentTarget.checked ? visibleMedia.map(item => item.id) : [])}
            />
            <span>全选素材</span>
          </label>
        </div>

        {visibleMedia.length > 0 ? <ul className="video-fission-media-list">
          {visibleMedia.map(item => {
            const isSelected = selectedIds.has(item.id);
            const assignedCount = allocationById.get(item.id);
            return <li key={item.id}>
              <label className="video-fission-media-option">
                <input
                  type="checkbox"
                  checked={isSelected}
                  disabled={disabled || (!isSelected && selectedMedia.length >= MAX_FISSION_OUTPUTS)}
                  onChange={event => changeSelection(item.id, event.currentTarget.checked)}
                />
                <span className="video-fission-media-name" title={item.displayName}>{item.displayName}</span>
                <small>{isSelected ? assignedCount === undefined ? "—" : `${assignedCount} 条` : "未参与"}</small>
              </label>
            </li>;
          })}
        </ul> : <p className="video-fission-empty">{hasInputDirectory ? "所选目录中没有可处理的视频。" : "请先选择视频输入目录，素材列表会显示该目录中的视频。"}</p>}
      </section>

      <div className="video-fission-summary" aria-live="polite">
        <span>已分配 <strong>{allocatedTotal ?? "—"}</strong> / {validTotal ?? "—"} 条</span>
        <span>{allocatedTotal === null ? "完成素材与条数设置后即可查看分配。" : "源素材按顺序均匀分配，合计与设置条数一致。"}</span>
      </div>

      {uploadControls}
      <div className="video-fission-actions">
        <div className="video-fission-action-group">
          <button type="button" className="button secondary" onClick={onResults}>查看作品</button>
        </div>
        <button type="button" className="button primary" disabled={!canStart} onClick={start}>开始裂变{validTotal !== null ? ` ${validTotal} 条` : ""}</button>
      </div>
      {startMessages.length > 0 && <p className="video-fission-status" role="status">{startMessages.join(" ")}</p>}
    </div>
  </section>;
}
