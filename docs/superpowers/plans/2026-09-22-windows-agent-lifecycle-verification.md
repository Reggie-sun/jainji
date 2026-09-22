# Windows Agent Lifecycle Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 回写两份既有文档（`docs/windows-acceptance-spec.md` 增加 W21–W29 测试用例；`docs/batch-video-production-agent-playbook.md` 增加 Windows Adaptation 小节），把 Windows 上产品 Agent 全链路与外部 agent IPC 表面的验收契约落地。

**Architecture:** 不改产品代码、不新增测试文件。仅以 Markdown 文档改动把 [`docs/superpowers/specs/2026-09-22-windows-agent-lifecycle-verification-design.md`](../specs/2026-09-22-windows-agent-lifecycle-verification-design.md) 的设计契约逐字下沉到运行清单。三份文档保持相互引用一致：规格充当契约、acceptance-spec 充当首版运行清单、playbook 充当外部 agent 在 Windows 上的操作层补充。

**Tech Stack:** Markdown（含表格、代码块、相对路径链接）。

**Spec:** [`docs/superpowers/specs/2026-09-22-windows-agent-lifecycle-verification-design.md`](../specs/2026-09-22-windows-agent-lifecycle-verification-design.md)

**Plan revision 2026-09-22 (rev2):** 规格已按 `9c612e0..a058826` 的新代码事实补记（addendum）：本地随机路径（`decorations.mode === "random"` 唯一触发，零模型调用）→ 新增 W29；`coverSticker.trackingMode` 的 `random` 已移除（`3aaeb3b`）；H.264 编码器三态分类（`6213b85`）；开发实例退出自动保存（`a058826`）；W22 修正为 3 帧抽帧（[`src/main/agent-frames.ts:14`](../../src/main/agent-frames.ts)）；W23 覆盖开关锚点修正为规则模板页 CoverStickerPanel。另发现 `docs/batch-video-production-agent-playbook.md` 未被 git 跟踪，Task 2 增加 Step 0 先提交基线导入。

## Global Constraints

来自规格与项目既有规则，逐条直接影响所有任务：

- 不修改产品代码、不新增测试文件、不动 schema/IPC。改动限定 `docs/windows-acceptance-spec.md` 与 `docs/batch-video-production-agent-playbook.md` 两份文件。
- 既有 W01–W20 与 Linux 步骤一律不动；W21–W29 与 Windows Adaptation 是追加而非替换。
- W21–W29 Priority 列与既有 W 表保持一致（P0 / P1），不接受未标注的新等级。
- 引用路径使用相对仓库根的形式；新增到既有表的行不重新格式化既有列；插入新行保持既有行的字段顺序（`ID | Priority | Action | Acceptance`，本规格再加 `Stage` 列）。
- Markdown 可渲染性：标题层级、表格列数、代码块围栏语言、相对路径链接 4 项必须在合并前人工核对。
- 提交：每个 Task 单独 commit；commit message 不携带 emoji；按既定规范加上 `Co-Authored-By: Claude Code <noreply@anthropic.com>` 末尾行。Task 2 例外地含两个 commit（基线导入 + WA 增量），见 Task 2 Step 0。
- Dual-review gate 在最终 Task 启动；Codex native reviewer 与 Kimi deep reviewer 对同一 immutable snapshot 独立审查。

---

### Task 1: 回写 `docs/windows-acceptance-spec.md`：在 Test Cases 表追加 W21–W29

**Files:**

- Modify: `docs/windows-acceptance-spec.md:51-77`（W01–W20 Test Cases 表与表前说明）

**Interfaces:**

- Consumes: [`docs/superpowers/specs/2026-09-22-windows-agent-lifecycle-verification-design.md`](../specs/2026-09-22-windows-agent-lifecycle-verification-design.md) §Windows Test Matrix（W21–W29 九行 + 测试机制说明；含 addendum 修正：W22 3 帧抽帧、W23 覆盖开关锚点、新增 W29 本地随机路径）
- Produces: 既有 markdown 表扩展 9 行（ID W21–W29），新增一列 `Stage`（与既有表四列并列）；表前说明段落保持不动。

- [ ] **Step 1: 打开 `docs/windows-acceptance-spec.md`，定位 W01–W20 表**

在仓库根执行：

```bash
wc -l docs/windows-acceptance-spec.md
sed -n '49,80p' docs/windows-acceptance-spec.md
```

确认 `| ID | Priority | Action | Acceptance |` 表头与 W01–W20 行存在，行格式如下：

```text
| W01 | P0 | 用普通 Windows 用户安装、启动、关闭、再次启动安装版 | 无白屏或崩溃；记录安装/签名提示原文；不要求用户安装 Node.js/Codex；能正常退出 |
```

如不存在该文件或行格式差异，先停下来报告，切勿继续。

- [ ] **Step 2: 修改表头加入 `Stage` 列**

将

```text
| ID | Priority | Action | Acceptance |
```

改为

```text
| ID | Priority | Stage | Action | Acceptance |
```

说明：表头多一列 `Stage`，与规格表一致；既有的 W01–W20 行 `Stage` 列填 `n/a`（他们属于旧基础测试，不对应 Agent 阶段编号）。

- [ ] **Step 3: 给既有 W01–W20 行的 `Stage` 列填 `n/a`**

逐行编辑 W01–W20 的每一行，把四列变成五列：在 `Priority` 后插入 `| n/a`。示例：

```text
| W01 | P0 | n/a | 用普通 Windows 用户安装、启动、关闭、再次启动安装版 | 无白屏或崩溃；记录安装/签名提示原文；不要求用户安装 Node.js/Codex；能正常退出 |
```

W02 到 W20 共 19 行同样处理。逐行校验，避免一次 `replace_all` 误伤。完成后 `git diff docs/windows-acceptance-spec.md` 只显示列结构变化与 W21–W29 新行，不应改动其它字符。

- [ ] **Step 4: 在 W20 之后追加 W21–W29 行**

直接复制规格的 Windows Test Matrix 表（W21 至 W29 共 9 行）到 W20 行后：

```text
| W21 | P0 | 1 | 在 NSIS 安装版首次启动后，检查 `%APPDATA%\jianji\connections\`；用任意 API Key + 模拟 endpoint；启动最小视觉模型请求 | 凭据明文保存在该目录（不写入项目文件、不写入环境、不写入浏览器存储）；ChatGPT 登录走应用独立 `userData`；三个角色各自可设模型与档位而不互相覆盖；运行中切换连接被拒绝 |
| W22 | P1 | 2 | 在隔离 fixture 模型上 1 视频 1 版本手填价格；运行中尝试切换连接 | 模型抽 3 帧（0.1/0.5/0.85 处各一张）→ 本地中心 + 四角 → FFmpeg 渲染 → 输出验证通过；运行中切换连接被禁用；非法价格在 IPC 入口拒绝；非法方案显式失败且不重试不切换 |
| W23 | P1 | 4 | 覆盖关闭的自动补角；「启用覆盖」开关在规则模板页 CoverStickerPanel 可见且默认关闭 | 每角归属明确（源贴纸角 vs 补齐角），补齐时段在导出前可被补帧/放大，每窗口执行 1 次、主管最多 3 次；超时显式失败，不静默重试 |
| W24 | P1 | 5 | 在含视觉模型 fixture 上开启自动覆盖；制作 1 视频 1 版本 | 视觉连接返回近似覆盖框并定框 → 主管样片渲染 → 修订反馈保留 → 非法/未改变画面的修订不能转通过；样片最多 5 次检查、2 次修订；新覆盖层以白色不透明底板渲染；不可用视觉模型时在调用前拒绝制作 |
| W25 | P1 | 6 | 在隔离 fixture 上先识别一张原贴纸 → 复用同源其他批次 → 删除源再识别 | 复用位置只在带专用标记的已完成模板复用、精确源身份相同；事实有疑议时显式阻断；近似覆盖方案与原贴纸事实分开 |
| W26 | P1 | 7 | 进 `coverReview.*` 系列 IPC 完成「识别→候选→草稿→预览→批准→出片」 | 草稿落盘独立于项目文件；草稿编辑失效旧预览与批准；独立复核关闭时不能批准/自动改稿；退出/重启后草稿可恢复；草稿未通过批准前不会进入正式队列 |
| W27 | P1 | 9 | 经 `window.jianji.appendProduction` 完成「预填→改文字→追加 2 条→渲染完成→文件校验」 | 展示文字/条数/目录按既有 schema 拒绝；与 `export.retry` 不竞争；零模型调用；输出文件不覆盖已有产物；Path B digest 自校验通过 |
| W28 | P1 | 全部 | 在 NSIS 安装版上按 `batch-video-production-agent-playbook.md` §Windows Adaptation 启动隔离 worker（独立 CDP 端口、独立 `%APPDATA%` 子目录），跑 1 个版本的 Path B 完整链路 | worker 与用户应用不竞争 userData；CDP `127.0.0.1:<port>` 连接成功并暴露 `window.jianji.*`；W21–W27 同样适用于该 worker；`packaged-runtime-smoke` 继续通过 |
| W29 | P1 | 2 | 选择「本地随机」模式制作 2 素材 × 各 1 版本；全程观察网络面板或日志确认零模型请求 | 每个素材版本四角各 1 款互不重复的随机贴纸（池 = 内置 + 上传）、价格花字来自 `PRICE_STYLES` 随机、滤镜与强度在规则范围内随机；两个素材版本组合不同（允许小概率相同，记录即可）；展示文字仍按共享 schema 在 IPC 入口拒绝空白/超行；规则模板页隐藏模板网格与具体花字选择器；导出文件通过既有验证 |
```

- [ ] **Step 5: 在表下方加测试机制说明**

紧接 W29 行后增加一段（与规格中"测试机制"行内容一致）：

```markdown
**测试机制**：W21–W29 与既有 W01–W20 共享同一验证基础。`packaged-runtime-smoke`、`desktop-smoke`、`feedback-smoke` 复用；模型、登录、CC Switch、GitHub 继续用隔离 fixture，遵循 §Environment Record 的禁止项（不消耗真实账号、不提交真实 Issue）。W29 不依赖任何模型 fixture（路径本身零模型调用）。
```

保持既有 Media Verification / Result And Exit Criteria / References 顺序不动。

- [ ] **Step 6: 在 References 段补新规格链接**

在文件末尾 References 列表（`## References` 之后）追加一项：

```markdown
- [Windows Agent Lifecycle Verification Spec](superpowers/specs/2026-09-22-windows-agent-lifecycle-verification-design.md) — W21–W29 设计契约
```

- [ ] **Step 7: 渲染校验**

```bash
git diff docs/windows-acceptance-spec.md
grep -nE '^##|^| ID \|' docs/windows-acceptance-spec.md | head -40
```

人工核对：

1. 表头是 5 列（`ID | Priority | Stage | Action | Acceptance`）。
2. W01–W29 共 29 行全部存在；W21–W29 共 9 行的内容与上面粘贴的字符串逐字一致。
3. 既有 W01–W20 行的内容字符未改变（仅多插入 `| n/a`）。
4. References 段尾新增一行且无重复。
5. 标题层级仍是 `## Status And Scope`、`## Environment Record`、`## Installation Preparation`、`## First Pass`、`## Test Cases`、`## Media Verification`、`## Result And Exit Criteria`、`## References`。

- [ ] **Step 8: 提交**

```bash
git add docs/windows-acceptance-spec.md
git commit -m "docs(windows-acceptance-spec): add W21-W29 Agent lifecycle test cases

- W21 模型连接与角色档位
- W22 创作方案与价格准入（3 帧抽帧）
- W23 自动四角补齐（覆盖关闭；开关锚点 = 规则模板页 CoverStickerPanel）
- W24 自动覆盖与主管样片
- W25 原贴纸自动识别与跟随轨迹
- W26 半自动审阅证据与批准
- W27 应用内 Path B IPC 表面
- W28 隔离 worker Path B 端到端
- W29 本地随机路径（零模型调用）

既有的 W01-W20 不动；Stage 列以 n/a 兼容旧基础测试。

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

期望：`git log --oneline -1` 出现该 commit；`git status` 无本任务残留。

---

### Task 2: 回写 `docs/batch-video-production-agent-playbook.md`：追加 Windows Adaptation 小节（WA.1–WA.6）

**Files:**

- Modify: `docs/batch-video-production-agent-playbook.md:451-`（末尾的"应用内 Path B" 章节后追加新一级 `##`）

**Interfaces:**

- Consumes: [`docs/superpowers/specs/2026-09-22-windows-agent-lifecycle-verification-design.md`](../specs/2026-09-22-windows-agent-lifecycle-verification-design.md) §External Agent Windows Adaptation（WA.1–WA.6 完整内容，WA.6 已按 addendum 改为 W21–W29）
- Produces: 既有"应用内 Path B（2026-09-21 起）"小节与"## References"之间插入一级标题 `## Windows Adaptation`，下面六个 `###` 子节（WA.1–WA.6）。

- [ ] **Step 0: 先把未跟踪的 playbook 作为基线单独提交**

`docs/batch-video-production-agent-playbook.md` 当前**未被 git 跟踪**（`git ls-files` 查无此文件）。若跳过本步直接做 Step 1–5，WA 增量 commit 会把整个 444 行文件首次入库，diff 不可审。先原样导入基线：

```bash
git ls-files docs/batch-video-production-agent-playbook.md   # 期望：无输出
wc -l docs/batch-video-production-agent-playbook.md          # 期望：444
git add docs/batch-video-production-agent-playbook.md
git commit -m "docs: import batch video production agent playbook baseline

既有 Linux 外部 agent 操作脚本原样入库（444 行，内容与磁盘一致），
为后续 Windows Adaptation 增量提交提供可审基线；本次不改动任何字符。

Co-Authored-By: Claude Code <noreply@anthropic.com>"
git diff HEAD~1 --stat   # 期望：仅该文件，444 insertions
```

确认基线 commit 只含这一份文件、内容未改。之后才进入 Step 1。

- [ ] **Step 1: 定位现有结构**

```bash
grep -n '^##\|^###' docs/batch-video-production-agent-playbook.md | tail -20
```

应能看到 `### 覆盖保存的 agent 序列` 在某行；下一步把新章节插在该小节之后、`## References` 之前。

- [ ] **Step 2: 在 `### 覆盖保存的 agent 序列` 段后插入新一级 `## Windows Adaptation`**

使用 Edit 工具精确匹配最后一段（`### 覆盖保存的 agent 序列` 段）正文末行（含 `…落盘，无需额外保存动作。）` 或下一段开始前），把规格的 `## Windows Adaptation` 与六个 `### WA.x` 章节原样粘贴在其后。

新一级 `## Windows Adaptation` 内容（一段引言 + 6 个子节标题）严格取自规格：

```markdown
## Windows Adaptation

原 playbook 是 Linux 路径，本小节给出 Windows 适配；不替换原内容。读者交叉对照原 §Prerequisites / §Machine Layout / §Step 1–§4，将 `bash + python3 + taskset` 替换为下列 PowerShell + 隔离 worker。

### WA.1 路径与二进制

- **app 仓库**：checkout 到与产生源批次相同的 commit；`npm ci`、`npm run build`，产物 `dist-electron\main.cjs`。
- **FFmpeg**：NSIS 安装包路径 `<install>\resources\ffmpeg\bin\ffmpeg.exe` 与 `ffprobe.exe`；隔离 worker 也可使用 `JIANJI_FFMPEG_PATH=C:\Users\<user>\AppData\Local\jianji\tools\ffmpeg\bin\ffmpeg.exe`。
- **userData 隔离**：worker 启动通过 `app.setPath('userData', '<worker-run>\.app-profile')` 与 `app.setPath('documents', '<worker-run>')` 重定向；不得使用用户主 APPDATA。
- **Codex 二进制**：NSIS 包内 `app.asar.unpacked\resources\codex\win32-x64\codex.exe` 由包自带；开发版需要从源码构建。

### WA.2 启动 worker（PowerShell）

（按规格中的 PowerShell 代码块原样粘贴，包括 `$ErrorActionPreference`、`$env:JIANJI_FFMPEG_PATH`、`Start-Process` 与 `Out-File -Encoding utf8` 五处必填项。）

### WA.3 CDP 驱动脚本（Node.js，对应原 §Step 1 `cdp.mjs`）

（按规格中的 `cdp.mjs` 代码块原样粘贴，含 `import { readFile } from 'node:fs/promises';`、`const port = 9541;`、`await (await fetch(\`http://127.0.0.1:${port}/json\`)).json();`、`ws.send(JSON.stringify({...}))`。）

### WA.4 taskset 不可用时的 CPU 限制

Windows 没有 `taskset`。可选：

1. `start /affinity <mask>` 启动 electron 进程（按位掩码选核）。
2. 用 PowerShell `[System.Diagnostics.Process]` 设 `ProcessorAffinity`；脚本需要至少 `SeIncreaseQuotaPrivilege` 才能跨进程修改，多数普通用户权限足够改自己启动的子进程。

WA 文档不强求做 CPU 限速；只在需要复刻 Linux 的固定核行为时启用。

### WA.5 端口与编码

- 端口：与 Linux 同；`netstat -ano | findstr :9541` 看占用；`Stop-Process -Id <pid>` 释放。
- 编码：所有 JSON 写入用 `UTF8`（含 BOM 由 `Out-File -Encoding utf8` 处理）；PowerShell 5.1 默认 ANSI，需要显式指定 `utf8` 或 `utf8BOM`。
- 路径分隔符：用 `Path.Combine` 或 `Join-Path`；脚本里避免硬编码 `\`。

### WA.6 闸口

- W21–W29 同样适用；任一 FAIL/BLOCKED/NOT_RUN 不能宣布「Windows Agent 验证完成」。
- `verify.py` 的 ffprobe 在 Windows 上改用 `ffprobe.exe`，从 `JIANJI_FFPROBE_PATH` 取绝对路径；不能用 `which ffprobe`。
- 残留临时文件：`Remove-Item -Force -Recurse` 删 `*.partial.mp4` 与 `.jianji-*.txt`；与 `verify.py` §file-set mismatch 检查一致。
```

WA.2 与 WA.3 的代码块必须按规格原样粘贴，不要把变量替换成 `${...}` 之外的形态。

- [ ] **Step 3: 在 References 段补新规格链接**

`## References` 段位于文件末尾（包含 `[batch-video-production-runbook.md]…`、`[AGENTS.md]…` 与 `## 应用内 Path B：…` 内部跳转链接），在该段末尾追加一项：

```markdown
- Windows 验收契约与运行清单：[docs/windows-acceptance-spec.md#test-cases](../windows-acceptance-spec.md)，设计契约 [Windows Agent Lifecycle Verification Spec](../superpowers/specs/2026-09-22-windows-agent-lifecycle-verification-design.md)
```

不要重复既有链接。

- [ ] **Step 4: 渲染校验**

```bash
git diff docs/batch-video-production-agent-playbook.md
grep -n '^## ' docs/batch-video-production-agent-playbook.md
```

人工核对：

1. 新 `## Windows Adaptation` 在 `## 应用内 Path B…` 之后、`## References` 之前出现且仅出现一次。
2. `### WA.1` 到 `### WA.6` 六个子节齐全，无子节数量增减。
3. WA.2 代码块的 PowerShell、`Start-Process` 行保留；WA.3 代码块的 `import` 语句保留。
4. 既有"应用内 Path B"与 `### 覆盖保存的 agent 序列` 字符未变。
5. References 列表新增一条；既有的 4–5 条不重复。

- [ ] **Step 5: 提交**

```bash
git add docs/batch-video-production-agent-playbook.md
git commit -m "docs(batch-playbook): add Windows Adaptation (WA.1-WA.6) for external agent

- WA.1 路径与二进制（NSIS、APPDATA、Codex 二进制）
- WA.2 PowerShell 启动 worker（隔离 userData、CDP 端口）
- WA.3 Node.js CDP 驱动脚本
- WA.4 taskset 不可用时的 CPU 限制
- WA.5 端口与编码
- WA.6 闸口（W21-W29 适用、临时文件清理）

既有的 Linux 操作步骤不动；新增章节供 Windows worker 复用。

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

期望：`git log --oneline -1` 出现该 commit；`git status` 无本任务残留。

---

### Task 3: 双文档一致性核对 + dual-review gate 准备

**Files:**

- Modify: 无（只读 + commit-message）
- Snapshot: 在仓库根创建 `git tag`（按 dual-review 要求封存 immutable snapshot）

**Interfaces:**

- Consumes: Task 1 与 Task 2 的 commit（两份文档当前 working tree 状态）
- Produces: 一份不可变 snapshot（tag）+ dual-review 启动材料

- [ ] **Step 1: 三文档相互引用核对**

```bash
grep -nE 'Windows Agent Lifecycle|Windows Adaptation|W21|W28|WA\.[1-6]' \
  docs/windows-acceptance-spec.md \
  docs/batch-video-production-agent-playbook.md \
  docs/superpowers/specs/2026-09-22-windows-agent-lifecycle-verification-design.md | sort
```

人工核对：

1. 在 `windows-acceptance-spec.md` References 段能找到新规格的相对路径（`superpowers/specs/2026-09-22-windows-agent-lifecycle-verification-design.md`）。
2. 在 `batch-video-production-agent-playbook.md` References 段能找到该规格与 `windows-acceptance-spec.md` 两条链接。
3. 在规格的 References 段标注的 `windows-acceptance-spec.md` 与 `batch-video-production-agent-playbook.md` 的相对路径与它们实际位置一致。
4. 没有出现失效的相对路径（不需要在仓库内运行 `grep` 找错链，但需肉眼比对 `(` 与 `)` 是否成对、`./` 与 `../` 层级数正确）。

如发现不一致，先停在 Task 1 或 Task 2 上修复相关 commit（用 `git rebase -i` 改 commit message 或内容），不要在这里改 working tree。

- [ ] **Step 2: 相对路径渲染 smoke**

```bash
grep -nE '\][^(]*\(' docs/windows-acceptance-spec.md | tail -10
grep -nE '\][^(]*\(' docs/batch-video-production-agent-playbook.md | tail -10
```

每条链接的 `(…)` 必须以 `/` 开头或 `./`、`../` 相对路径，绝对 URL 也可，但不能留 `()]()` 或 `][broken]`。

- [ ] **Step 3: 封存 immutable snapshot**

按 dual-review gate 要求，单一 commit + 单一 tree。执行：

```bash
git status --short
git log --oneline -3
git tag docs/windows-agent-verification-snapshot-$(date +%Y%m%d-%H%M%S)
```

确认 tag 指向 Task 2 的 commit（即最后一个 commit）。记录 tag 名供后续 reviewer 引用：

```text
snapshot_tag = <上面输出的 tag 名>
```

- [ ] **Step 4: 准备 reviewer 启动材料**

在仓库根写一份临时文件 `docs/.windows-agent-review-brief.md`（不 commit，供 reviewer 读取），内容：

```markdown
# Dual-Review Brief: Windows Agent Lifecycle Verification

## Snapshot

- Snapshot tag: docs/windows-agent-verification-snapshot-YYYYMMDD-HHMMSS（实际值见 Task 3 §3）
- Base commit: `git rev-parse HEAD`
- Files changed (vs base before Task 1):
  - `docs/windows-acceptance-spec.md`（新增 Stage 列；新增 W21–W29；新增 References 一条）
  - `docs/batch-video-production-agent-playbook.md`（基线导入 commit + 新增 `## Windows Adaptation` 及六个子节 + References 一条）
- Spec: `docs/superpowers/specs/2026-09-22-windows-agent-lifecycle-verification-design.md`

## Reviewers

- Codex native reviewer (read-only)：请在本次 snapshot 上独立审查，按 spec / completion evidence 评估上述两份改动。
- Kimi deep reviewer (read-only)：同上，独立审查；不要读取另一侧 review。

## Outputs

- 各自产出 findings 列表（severity、file:line、summary、failure_scenario）。
- 两侧 blocking findings 的合集须为 0 才可宣布 acceptance；任一 blocker 修复后必须重建 snapshot 并重审。
```

该 brief 文件不进入 commit，只作为 reviewer prompt 与封存材料的一部分。

- [ ] **Step 5: 启动 dual-review（按用户授权执行）**

```text
- 等用户确认是否启动 Codex native reviewer 与 Kimi reviewer；
- 启动后 reviewer 各自只读 snapshot；parent 在收到两侧 findings 后裁定 blocker；
- 任一 blocker 即修复（只改文档），重建 snapshot，再走一遍 dual-review。
```

不在此 Task 中擅自启动 reviewer。

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-22-windows-agent-lifecycle-verification.md`. Three tasks; each is small and Markdown-only.

Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration; suitable because each Task is a self-contained doc change with a verifiable diff.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints for review.

Which approach?
