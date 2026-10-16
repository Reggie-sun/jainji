# Asset Library Integration

## Usage

模板页的“贴纸与字体”从 3,144 个 Microsoft Fluent Emoji 资源中精选 56 款电商视频贴纸，以及 7 款 Google Fonts 中文字体。精选名单只保留促销、指引、强调、轻装饰和正向情绪，每个概念使用一个默认版本；不展示旗帜、无关职业人物、复杂场景、负面表情及重复肤色变体。支持中文用途、名称和英文名称搜索，每页 24 个预览。选中的素材用于本轮每条视频，沿用原有角落、小面积和避让文字约束。

`src/shared/curated-stickers.ts` 独占前端精选名单；筛选不删除完整 manifest 或已有缓存，旧任务的素材 ID 和当前已选素材仍可读取。以后新增资源也不会自动进入精选区，需明确加入名单。

在线字体：站酷快乐体、站酷小薇体、马善政毛笔体、站酷庆科黄油体、龙藏手写体、刘建毛草体、志莽行书。首次使用需要联网，下载成功后可离线使用；失败时保留之前的字体并允许重试。

## Ownership

`src/shared/asset-manifest.json` 是素材版本、文件身份与许可证的唯一登记表。`src/main/asset-library.ts` 负责下载、校验、缓存与在线字体解析，renderer 只传白名单 ID，不传任意 URL 或路径。缓存位于 Electron `userData/asset-library`，MIT/OFL 原文随缓存保留；不会向系统安装字体。

下载最多并发 4 个，等待队列最多 64 个；相同 ID 的并发请求合并。按固定 Git commit URL 下载，校验文件大小和 Git blob hash，完整文件以原子重命名写入缓存。导出贴纸另计算 SHA-256。素材未就绪时不会静默回退到其他资源。

## Cover Matching Index

上传贴纸入库时，通过 `human-region-artwork-index.ts` 在 `userData/sticker-cover-index` 为原图 SHA-256 保存派生索引，包括透明边裁切结果及已经实际计算的各尺寸 alpha。旧上传和内置素材库缺少索引时在首次人工框匹配中自动补建；相同图片和尺寸跨制作运行复用，不在制作准备阶段强制预热整库。索引绑定格式版本、原图指纹及 FFmpeg / ffprobe 身份，损坏或失效时由原图重建；索引不可写时仍可执行原本地计算。普通贴纸入库不因覆盖索引或解码器不可用而失败，覆盖制作仍须独立校验实际素材。索引不保存摆放、人工决定、覆盖准入或冻结图层，手动框的匹配不调用 Agent。

本地匹配仍须对实际缩放后的像素验证完整不透明覆盖，再生成和验证冻结 PNG。没有合适图案时继续明确失败，索引不会扩大允许的遮挡范围，也不会制造白底或修改原贴纸。缓存命中只证明减少重复计算，不代表整批制作、真实成片视觉或人工验收已经通过。

## Verification

```sh
npm run build
npm test
JIANJI_LIVE_ASSETS=1 npx vitest run tests/asset-library.integration.test.ts
node scripts/desktop-smoke.mjs
```

在线集成验证下载真实蝴蝶贴纸和站酷快乐体，离线解析缓存后，经生产 compiler/FFmpeg 输出 720×1280 H.264 视频；不调用模型。普通测试默认跳过网络验证。

`node scripts/library-browser-smoke.mjs` 提供 `http://127.0.0.1:5187/__library-proof`，用于真实 picker、StrictMode、无系统字体及下载失败行为的 Chrome 检查；不接入用户项目或模型。

## Maintenance Limits

`node scripts/update-asset-manifest.mjs` 是显式维护工具，不在启动时运行。当前字体版本固定，但旧任务只保存 family，未保存字体 blob。**下次更新同名字体前，必须先确定旧任务字体身份保留策略**；不能把升级 manifest 当作无影响的数据刷新。UI 生命周期及队列边界已进行人工/独立检查，尚未全部纳入持久自动回归测试。
