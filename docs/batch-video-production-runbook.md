# Batch Video Production Runbook

## Purpose

本文记录简辑批量商品视频的实际制作方法，覆盖两条路径：新素材首次制作，以及已经有合格成片后按同一要求追加批次。后者是近期蝴蝶贴、氨糖膏、马油、肥皂和滴耳康批次采用的自动化方式。

无论走哪条路径，最终渲染都必须进入 `ExportQueue`，由本地 FFmpeg 生成临时文件、验证视频轨道后再发布。准备脚本只负责建立项目和冻结任务，不能直接把自行拼出的 MP4 标记为完成。

## Fixed Production Contract

每次开始前先写清以下输入，并把它们保存在本轮 `production-plan.json`：

| Input | Rule |
| --- | --- |
| 素材集合 | 只使用当前产品的本地视频；同一产品内尽量均衡轮换原素材 |
| 期望条数 | 按素材数向上取整分配版本；追加批次可以精确选择已有的逐素材版本 |
| 展示文字 | 必须来自用户手工确认，原样保存；程序和模型都不能推测或改写 |
| 文字时序 | 当前批次使用 `decorationDisplayMode: "first-5s"`，最后 0.5 秒渐隐 |
| 贴纸时序 | 当前批次使用 `stickerDisplayMode: "full"`；普通贴纸全程保留，覆盖贴纸按冻结轨迹显示 |
| 输出设置 | 默认随横竖方向输出 720p、保留原帧率、等比缩放并补边，不裁剪 |
| 输出目录 | 按 `<产品目录>/视频/M.D HH:mm` 新建；重名时追加 ` (2)`、` (3)`，不覆盖旧目录 |

近期产品使用的手工展示文字如下。这些值是制作记录，不是程序默认值；以后价格或活动改变时，必须由用户重新给出。

| Product | Display text |
| --- | --- |
| 蝴蝶贴 | `19.9元30贴` |
| 氨糖膏 | `19.9元2支` |
| 马油 | `9.9元到手5卷` 换行 `19.9元拍一发三` |
| 肥皂 | `19.9元拍一发三` |
| 滴耳康 | `19.9元拍一发三` |

## Path A: First Production

首次处理某批素材时，通过应用完成完整制作流程：

1. 打开或新建产品项目，导入素材并等待探测完成。
2. 手工填写展示文字，选择 `前 5 秒显示`，并确认贴纸全程保留。
3. 选择输出目录、分辨率、帧率与画质，然后填写期望成片数。
4. 自动模式由创作连接为每个版本分别选择四角贴纸、尺寸、旋转、价格外观和滤镜。展示文字仍由本地程序生成。
5. 开启覆盖时，视觉连接先找原贴纸，复核连接检查真实动态样片；只有检查通过的模板才进入正式队列。没有合格覆盖证据时停止该版本，不能使用固定框代替。
6. 应用把每个版本的素材快照、模板、输出设置和资源指纹冻结到导出批次，再由 `ExportQueue` 渲染。
7. 保存项目。项目文件和持久化队列共同构成以后追加批次或中断恢复的来源。

如果产品没有已批准的覆盖轨迹，例如某批素材只有普通四角装饰，就只制作四角贴纸，不伪造覆盖层。

## Path B: Add Another Batch From Completed Templates

近期的追加批次没有重新调用模型，而是从同一产品、同一原素材身份的已完成任务中选择已经验证过的冻结模板，再建立新的本地导出任务。这样能够保留原覆盖位置，同时更换贴纸款式和输出目录。

### 1. Select eligible source batches

候选任务必须同时满足：

- 批次和任务状态均为 `completed`。
- `mediaSnapshots` 中的源文件仍存在，且源路径和指纹对应同一素材。
- 模板资源仍存在，贴纸和字体指纹有效。
- 需要复用覆盖位置时，模板来自该精确源素材的已完成自动覆盖版本。

按源素材分组后，先打乱素材顺序，再轮询各组选择版本。这样可以让 70 条成片尽量均匀地来自现有素材，而不是连续复制同一个视频。

### 2. Clone and freeze each version

每个新版本都复制一个合格的 `ExportBatch`，然后只做以下受控修改：

- 生成新的 project、batch、task、template 和 layer ID。
- 把文字层内容和 `productPrice` 设置为本轮手工展示文字。
- 设置 `decorationDisplayMode: "first-5s"` 与 `stickerDisplayMode: "full"`。
- 指向本轮新建的输出目录。
- 保留原 `mediaSnapshots`、导出 preset、滤镜、布局和覆盖轨迹。
- 把任务初始化为可恢复的 `interrupted`，之后只通过应用的 `retryExport(taskIds)` 进入原队列。

不得把其他产品或其他源素材的覆盖坐标移植过来，也不得在复制时改变覆盖框、关键帧、起止时间、白色底板策略或普通四角位置。

### 3. Randomize stickers without moving geometry

近期批次从 78 个已经审阅且资源仍有效的本地贴纸中进行平衡随机：

1. 为本轮生成并记录随机种子。
2. 打乱贴纸池，循环取值；一轮用尽后重新打乱。
3. 同一模板内排除已经选择的 ID，避免四角出现重复款式。
4. 优先选择本轮使用次数较少的贴纸，使总使用量尽量接近。

存在冻结覆盖层时，只替换该层的 `assetPath`、`assetFingerprint` 和 `cover.stickerId`。替换前后对移除 ID 与资源字段的覆盖层数据计算摘要，摘要必须完全相同，以证明位置、大小、时序和关键帧没有变化。

“随机贴纸”有两种范围，必须在计划中显式记录：

- `covers`：只随机覆盖层，保留该版本原有的普通四角搭配。
- `all-stickers`：用于没有覆盖轨迹、只有四角装饰的模板，随机四个角的贴纸，同时保持每角一张且互不重复。

每个版本的来源批次、源视频、覆盖层数量、随机贴纸 ID 和覆盖轨迹摘要写入 `random-sticker-selections.json`，便于追溯。

### 4. Create isolated render workers

每个产品批次使用独立的应用 `userData` 和 `jobs` 目录，防止不同批次的队列状态互相覆盖。worker 目录至少保存：

```text
<run-root>/<worker>/
  .app-profile/jobs/
  <project>.jianji-project.json
  random-sticker-selections.json
  live-status.json
  completed-tasks.json
  electron.log
```

worker 启动构建后的 Electron 主进程，加载本轮项目，读取所有 `interrupted` 或 `failed` task ID，并调用 `retryExport(ids)`。编码器和并发度由应用启动探测决定；如需指定本地引擎，通过 `JIANJI_FFMPEG_PATH` 和 `JIANJI_FFPROBE_PATH` 同时设置，具体查找顺序见 [README](../README.md)。

监控程序每隔一段时间读取公开队列状态，并更新 `live-status.json`。只有全部任务都为 `completed` 时才生成 `completed-tasks.json`；出现 `failed`、`cancelled` 或运行时错误时，写出 blocker 并停止声称成功。

## Render and Publication Lifecycle

每个任务由 [queue.ts](../src/main/queue.ts) 依次执行：

1. 校验冻结模板、源文件指纹、输出目录和模板资源。
2. [compiler.ts](../src/main/compiler.ts) 把文字、贴纸、覆盖轨迹、滤镜和缩放规则编译成 FFmpeg 参数。
3. FFmpeg 先写隐藏的 `.partial` 文件；文字使用的临时文件以 `.jianji-` 开头。
4. FFmpeg exit code 为 0 后，[artifact.ts](../src/main/artifact.ts) 用 ffprobe 确认文件非空、视频轨道可读且时长有效。
5. 临时文件落盘同步后，以不替换既有文件的方式发布到最终路径；若文件名冲突，分配新名称。
6. 最终路径和验证结果写入 `outputArtifact`，任务才转换为 `completed`。

应用异常退出时，正在执行的任务会恢复为 `interrupted`。再次执行只重试 `failed` 或 `interrupted` 任务，已经完成且产物仍有效的任务保持不动；重试继续使用原素材快照和冻结模板，不重新调用模型、换贴纸或改轨迹。

## Run Artifacts

一轮自动化生产应保留以下证据：

| Artifact | Purpose |
| --- | --- |
| `production-plan.json` | 记录产品、数量、输出目录、随机种子、时序、worker 和贴纸使用统计 |
| `setup_*.py` | 记录本轮项目与任务的建立方式；其中不得包含 API Key |
| `<project>.jianji-project.json` | 可重新打开的项目，保存素材和批次快照 |
| `.app-profile/jobs/*.json` | 队列的持久化真相，包括 task 状态和 `outputArtifact` |
| `random-sticker-selections.json` | 记录每版随机贴纸及覆盖轨迹摘要 |
| `manifest*.json` | 从完成任务生成的最终文件清单 |
| `verification-report*.json` | 数量、容器、音视频、时长、尺寸和临时文件检查结果 |
| `visual-samples*/contact-sheet.png` | 同一代表视频在文字显示期和 5 秒后截图的对照 |

这些运行 artifact 放在仓库外的 run root 中；仓库只保存本操作文档和产品代码。

## Verification Gate

完成数量必须从持久化 queue task 和实际输出目录两侧核对，不能只看 Electron 按钮或进程退出码。

### Queue and file-set checks

- 本轮 task 数等于请求数，且全部为 `completed`。
- 每个 task 都有 `outputArtifact`，其路径位于本轮输出目录内。
- 输出目录中的 MP4 集合与 task `outputPath` 集合完全一致。
- 不存在遗留 `.partial` 或 `.jianji-*` 临时文件。
- 多产品或多批次同时运行时，逐 worker 单独核对数量，不能只检查总数。

### Full ffprobe checks

对全部成片运行 ffprobe，并与各自 `mediaSnapshots` 中的原素材比较：

- 视频轨道可读，编码为 H.264。
- 输出有音频时，原素材也必须有音频；原素材有音频时，输出不能丢失音频。
- 输出时长与原素材时长差不超过 500 ms。
- 默认 720p 时，竖版为 720×1280，横版为 1280×720。
- 文件大小大于 0，最终路径均可读取。

项目带有冻结 `mediaSnapshots` 时，也可以运行只读 Harness：

```bash
npm run harness -- media --project /absolute/path/project.jianji-project.json --batch <batch-id>
```

Harness 只验证它声明覆盖的合同；它不能替代下面的画面检查。

### Visual checks

每个 worker 至少抽一个代表视频，在约 1.0 秒和 5.3 秒各取一帧：

- 1.0 秒：手工展示文字可读，四角贴纸存在，覆盖层确实遮住原贴纸且不挡主体。
- 5.3 秒：展示文字已经消失，普通贴纸仍在，覆盖贴纸仍按其冻结有效时段显示。
- 对比源帧：画面没有被裁剪，主体、字幕和商品关键信息没有被新增图层遮挡。

联系表只是抽样证据。最终画面质量仍需播放成片确认，尤其是移动贴纸、快速闪现、遮挡变化和短视频结尾。

## Failure Recovery

### App or worker stopped

保留输出目录、项目文件和 `.app-profile/jobs`。重新启动同一 worker，读取持久化任务，仅把 `failed` 或 `interrupted` ID 交给 `retryExport`。不要删除已完成文件，也不要重建全部任务。

### FFmpeg or hardware encoder failed

先检查 `electron.log` 和 task 的 `errorCode`。确认 FFmpeg / ffprobe 路径成对有效后重启 worker；应用会重新探测 NVENC、AMF、QSV，均不可用时才使用 `libx264`。不要在同一任务运行中切换引擎。

### Sticker asset missing or changed

停止该批次。不能用同名文件冒充原资源。恢复与 `assetFingerprint` 一致的素材，或重新建立新模板和任务。

### Model or cover review failed

首次制作时直接保留失败状态，不静默重试或切换连接。追加批次只有在存在精确源身份的已完成模板时才能跳过模型；没有合格模板就回到 Path A。

### Output name already exists

不要覆盖。队列会分配新的文件名；整个目标目录重名时，在目录名后追加序号。

## Ownership and Boundaries

- 制作输入与展示文字约束：[agent.ts](../src/shared/agent.ts)、[decorations.ts](../src/shared/decorations.ts)
- 模型方案和本地图层：[agent-provider.ts](../src/main/agent-provider.ts)
- 逐素材版本执行：[agent-runner.ts](../src/main/agent-runner.ts)
- 模板编译：[compiler.ts](../src/main/compiler.ts)
- 队列、恢复与安全发布：[queue.ts](../src/main/queue.ts)
- 产物读取验证：[artifact.ts](../src/main/artifact.ts)
- 覆盖合同与源贴纸知识：[source-sticker-knowledge-spec.md](source-sticker-knowledge-spec.md)
- 视频证据口径：[video-validation-harness-spec.md](video-validation-harness-spec.md)

本手册不授权覆盖源视频、从画面推测价格、把别的素材坐标移植为覆盖轨迹、绕过队列发布产物，或把抽样截图当作全部成片的人工验收。
