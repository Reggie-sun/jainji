# Scope

用户明确授权历史成片真实上传，并要求每次最多选择 9 条、连续处理到该批结束。随后改为滴耳康今天最新视频，眼贴交由用户自行上传。本记录证明这次独立浏览器操作，不替代 [应用生产适配器记录](qianchuan-production-adapter-2026-09-28.md) 中仍被 required review 阻断的 implementation checkpoint。

# Result

2026-09-28 15:29（Asia/Hong_Kong）只读复核 PASS：滴耳康 `/home/reggie/电商/滴耳康/视频/9.28 15:06` 的 84 条 MP4 全部在原上传面板显示成功。有效文件选择共 10 组，组大小为 `9,9,9,9,9,9,9,9,9,3`；每组全体 ready 后才开始下一组。

使用已配置的本机 Chrome CDP 9224；账户 `1876131703522649`、已有计划 `1877122107497536`。每个操作核对同源 URL、可见账户与计划 ID、唯一计划 drawer，以及原 target/modal 的归属标记。没有更换计划或修改广告设置。

最终页面显示 `已选择 84/434：`，文件名集合与冻结的 84 个输入精确一致，无重复；每行均有成功图标与成功 progress 标记，没有取消上传状态，独立“确定”按钮可用。按钮只观察，未点击；准备步骤之后的确认点击与广告设置点击计数均为 0。保持原面板打开供用户手动确认，不宣称平台已经接受计划变更、发布或投放。

# File Delivery And Transport Diagnosis

操作前对全部输入复制私有快照，核对源文件与快照 SHA-256、文件身份与 ffprobe 视频结果，快照权限为 0400。每个文件的永久 selection fence 在送入浏览器前以 exclusive-create、fsync 和目录同步落盘；结果不明确时禁止盲目重传。

最初 9 条的 Playwright `FileChooser.setFiles` 调用返回 `Cannot transfer files larger than 50Mb to a browser not co-located with the server`。Parent 核对本机安装的 `playwright-core/lib/coreBundle.js`：`prepareFilesForUpload` 在 19801 行抛出该大小限制错误，调用方在 20429 行等待它，直到 20431 行才进入 `_setInputFiles`。因此该次明确在浏览器文件动作之前被拒绝，并非已送出后的未知上传；原面板同时为零行、零选择。

保留原报告、错误、九个 fence，并记录 `NOT_SENT_CLIENT_GUARD` 及 library SHA-256 后，改用同一台主机 Chrome 的原生 `Page.fileChooserOpened` / `DOM.setFileInputFiles`。仅通过唯一的“点击上传”控件打开选择器，核对其属于原 target 的主 frame、`selectMultiple` 模式、原生 multiple file input 的 backendNodeId；持久记录每次 CDP 文件动作后才送入本机快照路径。没有调用网页内部上传 API、伪造 File 对象或伪造成功状态。旧九个 fence 保留并用于实际首次文件选择，其余文件各自先写 fence。

# Evidence

本机运行目录为 `.agent/harness/runs/20260928-dierkang-nine-fe9f792a/`，不提交运行状态、截图或私有媒体。目录内包含：

- `report-before-native-cdp9.json`：原 Playwright 大小限制错误 checkpoint。
- `report.json`：84 条 READY、零 unknown、十次原生 CDP 文件动作、原 target/modal 归属及逐文件 fence。
- `native-cdp9-driver.cjs`：SHA-256 `39c851badbfc3ffb1a3b41f9a3125492de27df1cdb794859f776c4725a30b13d`。
- `readonly-final-check.cjs` 与 `verification.json`：在上传进程正常退出后独立连接原 target；12 项检查全部 true，2026-09-28T07:29:03.262Z，PASS。
- `page.png`：Parent 已查看实际页面截图，列表为绿色成功状态、计数 84，停在“确定”前。

私有快照及永久 fence 位于 `/tmp/jianji-dierkang-upload-files-friOSy`，未删除。临时证据可能随环境清理消失，本记录保留已实际观测的最低结论；不依赖这些文件自动恢复或重选。

# Delegation And Boundaries

操作准备采用受管、sealed read-only Kimi deep route。滴耳康原 Playwright 九条脚本的 receipt 为 `6d7f70aa-4b1c-4807-8802-532115ad974b`，PARSED，两个 authenticated k3/max requests、两个 observed Reads；Parent 逐项裁决见运行目录 `qa-resolution.md`。该回执绑定原脚本，不声称审过后来原生 CDP 脚本。最终结果依据 Parent 源码诊断、十组实际上传和独立只读页面复核；该操作 QA 不补齐应用 implementation 的 required review，也不是其第四轮 review。

眼贴此前运行 `.agent/harness/runs/20260928-eye-manual-2bf04c4b/` 在交还用户时记录 10 条 ready、第 11 条结果未知、73 条未选择。用户切换滴耳康后没有再选择、确认、取消、删除或重传眼贴；这只是交还时证据，不声称用户手动操作后的眼贴现状。

Chrome MCP 的 `new_page` / `navigate_page` approval 配置修正并重开后，实际创建、导航与 `list_pages` 不再报原 approval-policy 错误；其独立 profile 显示千川登录页。真实账户上传使用已登录的 Chrome 9224，不能把 MCP 登录页当作已接入真实账户的证据。

本次未修改应用源码或改变上传 service/store 合同。应用正式导出后自动上传的真实账号端到端验收、Windows 权限与目录同步仍未评估；这里不把历史文件独立操作当作上述验收通过。

# Ownership And Completion

Repository 未提供专用 session-record/capture skill，本记录承担这次 external media effects 的持久记录。只提交本文件，保留既有其他 staged/unstaged 修改及用户项目删除，不写全局 memory。记录核查以运行报告、只读验证、截图及文件引用为准；文档本身不改变产品行为，未为此重复运行无关代码测试。
