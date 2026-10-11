import type { DecorationOptions } from "../shared/decorations";

export function PackagingModePicker({ value, disabled, onChange }: {
  value: DecorationOptions["mode"]; disabled: boolean; onChange(mode: DecorationOptions["mode"]): void;
}) {
  return <div className="corner-tabs" role="group" aria-label="制作方式">
    {([ ["agent", "全部交给 Agent"], ["manual", "自己设置"], ["random", "本地随机"] ] as const).map(([mode, label]) => <button key={mode} type="button" disabled={disabled} aria-pressed={value === mode} onClick={() => onChange(mode)}>{label}</button>)}
  </div>;
}
