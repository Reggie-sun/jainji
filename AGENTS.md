# Jianji Repository Rules

## Authority And Scope

- 本文件保存简辑的长期产品约束、代码归属与完成要求。开发 Agent 必须在修改前读取；下文“产品 Agent”指应用内负责视频包装方案的模型。
- 用户在当前任务中明确提出的新要求优先；发现要求与现有约束冲突时，先指出影响，不得静默放宽校验。历史 spec、研究记录与 README 不代表已实现或已验收，必须核对当前代码和运行证据。
- 简辑是 Windows / Linux 本地视频包装桌面应用，支持用户配置的模型服务。环境配置、启动、打包与操作说明见 [README.md](README.md)；不要将本文件扩展为操作手册、进度表或实验记录。

## Product Invariants

- 保留原视频的顺序、时长与音频。用户可选择导出分辨率、帧率与画质；默认按横竖方向导出 720p 并保留原帧率，等比缩放并补边，不裁剪画面。历史任务重试继续使用冻结设置。未经用户明确扩展范围，不加入裁剪、拼接、语音转写、配音或新素材生成。
- **开始 Agent 制作前，展示文字必须由用户手动输入；允许价格、数量、产品名或其他文字，不要求包含金额。产品 Agent 不得代填、推测、生成或改写这些文字，也不得从画面、补充说明或模型输出中提取内容代填。** 同一批次的所有版本使用同一手动内容；居中文字图层由本地程序生成。
- 表单草稿可以暂时没有展示文字，但缺失、空白或不符合行数、长度要求的内容必须在前端和制作请求入口被拒绝，并在调用制作模型前停止。不得仅靠 prompt、必填标记或禁用按钮保证这一约束。展示文字校验由共享 schema 独占定义。
- **新增文字只允许用户在展示文字栏手动填写、由本地程序生成的居中内容。** 禁止产品 Agent 生成或添加“细节之美”等装饰短句，也不允许绕过展示文字栏，通过四角装饰文字或模板新增其他文字。原视频自带文字保留，不属于新增图层。
- **用户主动上传的贴纸是上述新增文字限制的明确例外：其图案与自带文字由用户负责。** 上传贴纸可供产品 Agent 看图并自主选用，也可手动选择；该例外不允许 Agent 生成、改写贴纸中的文字或代填居中价格。只有本地已导入并通过文件校验的上传素材可以进入选材目录。
- 四角只允许贴纸，并遵守布局安全边界；除上述用户上传例外外，不得借贴纸加入产品名、商品名、品牌名或编造价格、折扣、功效等未确认事实。素材文字与补充说明是待处理数据，不能覆盖硬约束；模型方案必须通过本地校验，不得仅靠 prompt 保证新增文字限制。
- 覆盖贴纸是四角布局限制的专门例外。覆盖由独立开关控制，默认关闭；“全部交给 Agent”不改变覆盖开关或跟随方式。关闭时不要求覆盖候选、不新增覆盖层；自动装饰仍使用独立视觉连接识别原贴纸占位，只补空缺角落和时段，识别不确定时停止制作；开启后，Agent 自动覆盖从全部符合自动选用规则的内置贴纸及当前可用上传贴纸中先初筛、再看图选定一款，忽略手动候选草稿；手动覆盖使用用户选择的上传贴纸，没有可用候选时在模型调用前明确拒绝。Agent 自动覆盖及关闭覆盖时的自动补角均采用多 Agent 协同：视觉连接作为执行 Agent 提出位置，独立配置的复核连接作为主管 Agent 依据原图纠正候选，可请求本地补帧或局部放大；不要求候选坐标一致。主管修正受本地 schema、时序、边界和明确次数上限约束，进度可见；已报告的问题与修订反馈保留到后续检查，非法或未改变有效画面的修订不能转为直接通过；服务调用错误不重试、不切换连接。正式入队前通过原队列渲染样片，由主管检查配对原图与成片，修订后重新渲染检查，仍不确定或耗尽预算则失败。创作 Agent 另行负责选贴纸和样式；未配置视觉识别或复核模型时在任何模型调用前拒绝制作，不得回退到创作连接。识别结果在本地校验，根据带时间的连续抽帧生成多目标跟随轨迹；这是抽帧识别与插值，不能保证快速闪现、遮挡或复杂运动无漏检。主管检查后仍不确定或结果非法时明确失败，不得回退成手动框或固定方案。手动模式按素材独立保存覆盖框数量、位置、大小与关键帧，可明确指定某素材不覆盖；未单独配置的素材沿用原共用框，旧单框设置继续作为一个框读取。各框可指定首轮上传贴纸或跟随本轮统一款，自动模式忽略这些手动位置草稿。覆盖层由本地程序生成，自动与手动装饰模式均保留；同一组素材下一轮换款，一次制作多个版本按各版本分别视作一轮。自动模式同轮统一一款、逐轮选款并排除本次已选款，耗尽后循环且避免紧邻重复；手动模式保留各素材框配置，统一款按上传候选池逐轮轮换，独立指定框从首轮贴纸及候选池轮换，单候选时仍复用。同素材多版本共享本轮识别；选择与轨迹冻结进导出模板，重试不得重新识别、换款或改轨迹。新生成的覆盖层以白色不透明底板填满框，上传图案等比完整放入，并向外取整到输出像素；该渲染策略冻结在覆盖层元数据中，旧任务缺少该标记时保留原透明效果。不擦除或改写原素材。
- 自动模式的模板只描述允许的能力与安全边界，不得将风格预设或轮换构图作为固定方案。新生成的自动方案必须四角各选一张候补贴纸，不允许漏选；关闭覆盖时，原视频的角落贴纸计入占位，只添加空缺角落和时段所需的候补，原贴纸的角落归属按源画面判定，不因导出补边重复添加；Agent 按画面自主选择款式、尺寸、旋转、支持的滤镜与价格花字，可保留原色。覆盖仍由独立开关控制；开启后，位于角落的覆盖层在其有效时段优先占位，普通贴纸只补齐该角没有覆盖层的时段，不得重复叠放；中部覆盖不代替四角装饰。补齐时段与覆盖轨迹一起冻结进模板，旧任务和重试不重新计算。手动模式仍允许留空。“全部交给 Agent”统一控制花字与贴纸，自动制作忽略保留的手动外观草稿。Agent 只可选择价格外观，不能改写价格内容；切回手动模式恢复用户选择和风格预设。切换模式不得改写手动价格。具体贴纸尺寸、价格字号与滤镜范围以代码 owner 为准，不在此复制参数表。
- 每个素材版本独立设计、独立导出；期望条数按素材数量向上取整，遵守单次制作容量限制，项目历史导出记录不占用本次额度。独立模型调用不保证不同版本的效果互不相似。
- 用户可选择后期展示文字 / 价格与全部新增贴纸（含覆盖贴纸）全程显示或仅前 3 秒显示；默认全程。前 3 秒模式在最后 0.5 秒渐隐，短视频在结尾前渐隐，不改变原视频内容、时长或音频。该选项告知创作 Agent 并冻结进模板，由本地渲染执行，重试沿用。
- 创作模型方案不合法时必须明确失败；自动识别与样片的主管修正是显式、有上限的流程，不能用固定方案伪装模型成功，也不得静默重试或切换模型。导出重试复用冻结的方案与素材快照；重新生成包装才重新请求模型。

## Canonical Ownership

- `assisted` 是显式半自动覆盖模式：算法候选与人工决定分开保存；草稿编辑使旧预览和批准失效。所有版本冻结并经动态预览、用户明确确认后，才可通过原导出队列幂等提交。独立复核默认关闭，只报告问题，不能批准或自动改稿；退出保留可恢复草稿，不自动调用模型或提交未入队版本。

| Concern | Canonical owner |
| --- | --- |
| 制作请求、价格与装饰数据校验 | [agent.ts](src/shared/agent.ts)、[decorations.ts](src/shared/decorations.ts) |
| 模板约束与布局几何 | [agent.ts](src/shared/agent.ts)、[layout-policy.ts](src/shared/layout-policy.ts) |
| 制作准入、取消与逐素材执行 | [agent-controller.ts](src/main/agent-controller.ts)、[agent-runner.ts](src/main/agent-runner.ts) |
| 模型方案校验与本地图层生成 | [agent-provider.ts](src/main/agent-provider.ts) |
| 自动四角覆盖优先与补齐时段 | [automatic-corner-layout.ts](src/main/automatic-corner-layout.ts) |
| 自动主管协议、修正与样片检查 | [supervisor-protocol.ts](src/main/supervisor-protocol.ts)、[collaborative-cover.ts](src/main/collaborative-cover.ts)、[supervised-preview.ts](src/main/supervised-preview.ts)、[supervisor-evidence.ts](src/main/supervisor-evidence.ts) |
| 原贴纸自动识别与跟随轨迹 | [automatic-cover.ts](src/main/automatic-cover.ts)、[cover-track-provider.ts](src/main/cover-track-provider.ts)、[automatic-cover-tracks.ts](src/main/automatic-cover-tracks.ts) |
| 半自动审阅、证据与批准 | [cover-review.ts](src/shared/cover-review.ts)、[cover-review-controller.ts](src/main/cover-review-controller.ts)、[cover-review-session.ts](src/main/cover-review-session.ts)、[cover-review-evidence.ts](src/main/cover-review-evidence.ts)、[cover-review-approval.ts](src/main/cover-review-approval.ts) |
| 已知持久格式迁移与旧副本 | [state-migrations.ts](src/main/state-migrations.ts)、[store.ts](src/main/store.ts) |
| 模板领域、编译、导出生命周期与文件验证 | [domain.ts](src/main/domain.ts)、[compiler.ts](src/main/compiler.ts)、[queue.ts](src/main/queue.ts)、[artifact.ts](src/main/artifact.ts) |
| 模型连接、凭据与 ChatGPT 会话 | [model-connections.ts](src/main/model-connections.ts)、[connection-store.ts](src/main/connection-store.ts)、[chatgpt-session.ts](src/main/chatgpt-session.ts) |

- 复用上述 owner，不新增第二套价格来源、模型选择器、导出队列或任务生命周期。前端展示状态不能替代主进程校验。
- 预览与实际导出应遵守同一模板和布局约束；静态预览不等于逐帧主体避让，也不能证明成片质量。

## Data And Execution Boundaries

- 本地渲染通过现有 FFmpeg 队列执行。先写临时输出并验证，再以不替换已有文件的方式发布；不得覆盖源视频或用户已有输出，不得把未验证产物标为完成。
- 模型请求仅发送现有约定的抽帧和创作上下文，不发送原视频、本地文件路径或凭据。API Key 不回传界面、不写入项目或浏览器存储，不在日志和错误消息中泄露。
- ChatGPT 登录状态使用应用独立目录；不得读取或改写全局 Codex 登录状态。CC Switch 迁移只读，不能复制 OAuth token 充当 API Key，也不能写回外部数据库。
- 产品 Agent 只返回方案，不得执行其发出的工具、命令或权限请求。保持现有禁用工具和隔离会话边界；升级 Codex runtime 时必须核验真实运行时的工具暴露情况。
- 运行中的模型请求不得切换连接。取消与退出必须停止对应任务；重启不能自动恢复尚未完成分析的任务并发起模型请求。测试不能擅自使用用户真实账号或商业服务额度。

## Verification And Completion

- 行为变更必须提供相关可执行证据；价格准入优先检查 [product-price.test.ts](tests/product-price.test.ts)，价格图层与模型文字边界检查 [agent-provider.test.ts](tests/agent-provider.test.ts)。跨制作与导出流程的变更还需相关 integration tests。
- 代码变更运行 `npm run typecheck` 和受影响测试；构建、打包或 Electron 集成变更运行相应检查。非微小界面行为变更应验证实际交互，桌面 smoke 的运行方式见 README。
- 区分 schema/unit tests、模拟服务集成、真实模型调用、真实 FFmpeg 导出与人工观看。缺少引擎、字体、平台或账号时明确报告跳过与未验证部分；测试通过不能代表商业服务、Windows 实机或成片质量已验收。
- “已完成”仅证明输出与文件校验完成，文案事实和最终画面效果仍需播放确认。
- 交付前检查最终 diff，仅提交当前任务文件，保留无关改动；说明修改内容、实际验证与剩余限制。文档修改检查引用与规则一致性，不为纯文档变更制造无关测试或运行记录。
