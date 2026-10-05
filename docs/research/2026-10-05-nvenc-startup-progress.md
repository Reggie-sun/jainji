# FFmpeg 8 NVENC Startup Progress and GIF Input Scanning

## Scope

本记录只依据 FFmpeg 官方文档与 FFmpeg `n8.0` 上游源码。没有运行本地 FFmpeg、NVENC 或 GIF 性能测试，因此不报告任何实测启动耗时，也不代表简辑实现已修复或验收。

## Progress Signal

`-progress` 按 `key=value` 周期输出，更新间隔由 `-stats_period` 控制，默认 0.5 秒；因此它提供的是轮询快照，不是精确的初始化事件时间戳。[FFmpeg `-progress` 文档](https://ffmpeg.org/ffmpeg.html)

在 FFmpeg `n8.0` 中，`frame=` 取第一个输出视频流的 `ost->packets_written`，不是送入编码器的帧数；同一报告中的 `out_time_ms=` 则直接输出传给报告函数的 `pts` 参数。`transcode()` 将 scheduler 的 `transcode_ts` 传入该函数。所以 `frame` 是视频输出包计数，`out_time_ms` 是非视频流专属的时间字段，两者不是同一类信号。[`ffmpeg.c` 的进度生成](https://github.com/FFmpeg/FFmpeg/blob/n8.0/fftools/ffmpeg.c#L590-L618)；[`out_time_ms` 的生成](https://github.com/FFmpeg/FFmpeg/blob/n8.0/fftools/ffmpeg.c#L656-L664)；[`transcode_ts` 传入报告](https://github.com/FFmpeg/FFmpeg/blob/n8.0/fftools/ffmpeg.c#L891-L900)

FFmpeg CLI 在打开编码器时调用 `avcodec_open2()`；FFmpeg 8 的 NVENC 设备设置路径调用 `nvenc_open_session()`，后者执行 `nvEncOpenEncodeSessionEx()`。编码流程随后从编码器接收包并送往 mux 调度路径。由此可推断：若已确认第一个输出视频流确实选择 `h264_nvenc`，观察到 `frame > 0` 表示 NVENC 会话已打开，且至少一个视频包已从编码器到达输出 mux 路径。[CLI 打开输出编码器](https://github.com/FFmpeg/FFmpeg/blob/n8.0/fftools/ffmpeg_enc.c#L330-L345)；[NVENC 会话打开函数](https://github.com/FFmpeg/FFmpeg/blob/n8.0/libavcodec/nvenc.c#L408-L432)；[NVENC 初始化调用设备设置](https://github.com/FFmpeg/FFmpeg/blob/n8.0/libavcodec/nvenc.c#L2248-L2287)；[NVENC 设备设置中的会话路径](https://github.com/FFmpeg/FFmpeg/blob/n8.0/libavcodec/nvenc.c#L758-L856)；[编码包接收与转发](https://github.com/FFmpeg/FFmpeg/blob/n8.0/fftools/ffmpeg_enc.c#L650-L718)；[视频包送往 mux 调度](https://github.com/FFmpeg/FFmpeg/blob/n8.0/fftools/ffmpeg_enc.c#L715-L718)

该计数在 `av_interleaved_write_frame()` 调用前递增，因此它证明包已到 mux 写入路径，不证明该调用成功、文件已持久写入或导出已完成。若输出视频采用 stream copy，`frame > 0` 也不证明视频编码器曾打开；必须先确认实际输出流和编码器。[mux 路径中的计数与写入顺序](https://github.com/FFmpeg/FFmpeg/blob/n8.0/fftools/ffmpeg_mux.c#L224-L242)

因此，`frame > 0` 是“视频包已到达输出 mux 路径”的可靠下游信号，可作为已打开 NVENC 会话的保守证据；它不能证明会话打开早于**首次** `out_time_ms > 0`。由于 `out_time_ms` 来自 scheduler 时间而非视频包计数，在带音频的任务中，音频进度先于首个视频包是合理推断，但本次核对的源码片段不保证每种调度与时间戳组合的先后顺序。若两字段在同一快照变正，快照也不能给出它们的先后时刻。[FFmpeg 的音频/视频转码路径说明](https://ffmpeg.org/ffmpeg.html#Transcoding)；[FFmpeg 8 报告字段实现](https://github.com/FFmpeg/FFmpeg/blob/n8.0/fftools/ffmpeg.c#L590-L618)；[报告时间字段实现](https://github.com/FFmpeg/FFmpeg/blob/n8.0/fftools/ffmpeg.c#L656-L664)

只靠 `-progress`，适合采用的判断是：在已知输出映射和 `h264_nvenc` 编码器的前提下，等待 `frame > 0` 来确认“首个视频包已到 mux 路径”。不要把它叫作精确的 session-open 时间，也不要据此认定 mux 写入或最终产物成功。若必须观测更早的 session-open 事件，需要在 NVENC 会话打开处增加独立的显式遥测；`-progress` 当前报告字段没有该事件。[FFmpeg 8 报告字段实现](https://github.com/FFmpeg/FFmpeg/blob/n8.0/fftools/ffmpeg.c#L590-L618)；[NVENC 会话打开实现](https://github.com/FFmpeg/FFmpeg/blob/n8.0/libavcodec/nvenc.c#L408-L432)

## GIF Input Startup and Probing

FFmpeg 8 的 GIF `read_probe` 只检查 GIF 签名和非零宽高；对可 seek 的 GIF，`gif_read_header()` 随后从头扫描到 GIF trailer，累计帧数和时长以填写流信息，再 seek 回起点。由此可推断，大型 seekable GIF 可能在转码进度开始前产生与文件长度相关的打开成本；源码能证明扫描行为，但没有给出耗时。非 seekable 输入走跳过该扫描的分支。[GIF probe](https://github.com/FFmpeg/FFmpeg/blob/n8.0/libavformat/gifdec.c#L73-L84)；[GIF header 与 seekability 分支](https://github.com/FFmpeg/FFmpeg/blob/n8.0/libavformat/gifdec.c#L114-L148)；[GIF header 全程扫描、帧/时长统计与回到起点](https://github.com/FFmpeg/FFmpeg/blob/n8.0/libavformat/gifdec.c#L146-L219)

GIF demuxer 的 `ignore_loop` 默认值是 `1`，即忽略文件内循环设置；设为 `0` 才按 GIF 中的循环次数处理。源码只在可 seek 输入读到 EOF、循环未被忽略且循环次数仍允许时 seek 回文件开头，因此该选项改变播放循环行为，不能作为缩短打开扫描的依据。GIF 头部扫描本身只处理一次文件内容并回到起点。[GIF 选项和 EOF 重绕条件](https://github.com/FFmpeg/FFmpeg/blob/n8.0/libavformat/gifdec.c#L244-L274)；[GIF demuxer 文档](https://ffmpeg.org/ffmpeg-formats.html#gif)

`-probesize` 限制用于获取流信息的探测字节数；文档说明值更大可能发现更多分散信息，同时增加延迟。`-analyzeduration` 设置输入分析时长，文档同样说明更大值会提高检测准确度并增加延迟。`-fpsprobesize` 的文档含义是用于探测帧率的帧数。源码没有显示降低这些通用探测限制会跳过 seekable GIF `read_header()` 内的完整扫描，因此不据此推荐任何值或声称能修复 GIF 打开延迟。[FFmpeg 输入探测选项文档](https://ffmpeg.org/ffmpeg-formats.html#Format-Options)；[GIF header 扫描实现](https://github.com/FFmpeg/FFmpeg/blob/n8.0/libavformat/gifdec.c#L114-L219)

`min_delay`、`default_delay` 与 `max_gif_delay` 是 GIF 帧间延时规则，不是打开或探测时长控制；没有证据支持调整它们来缩短启动。[GIF demuxer 选项文档](https://ffmpeg.org/ffmpeg-formats.html#gif)

## Verification Boundary

核对了 FFmpeg 当前官方 `-progress` 与格式选项文档，以及 FFmpeg GitHub `n8.0` 的 CLI 进度、编码器初始化、NVENC 会话、mux 计数和 GIF demuxer 实现。此次研究未做性能基准或真实素材运行；首次 `out_time_ms` 是否先于 `frame > 0` 仍须由目标命令的运行记录确认。

## Raw Source Line Audit

以下行数来自本次下载 FFmpeg 官方 GitHub `n8.0` raw 文件后按源文件换行计数；行号按 raw 文件计数，不采用 GitHub 网页显示的偏移。关键函数/语句位置可由同一 tag 的行锚点复核。

| Official source | Raw lines | Verified key positions |
| --- | ---: | --- |
| [`fftools/ffmpeg.c` raw](https://raw.githubusercontent.com/FFmpeg/FFmpeg/n8.0/fftools/ffmpeg.c) | 1036 | `print_report` 555；`packets_written` 读取 600；`out_time_ms` 输出 658、662；`transcode()` 等待与报告 891、900。[源码锚点](https://github.com/FFmpeg/FFmpeg/blob/n8.0/fftools/ffmpeg.c#L555-L600) · [时间字段](https://github.com/FFmpeg/FFmpeg/blob/n8.0/fftools/ffmpeg.c#L656-L664) · [报告调用](https://github.com/FFmpeg/FFmpeg/blob/n8.0/fftools/ffmpeg.c#L891-L900) |
| [`fftools/ffmpeg_enc.c` raw](https://raw.githubusercontent.com/FFmpeg/FFmpeg/n8.0/fftools/ffmpeg_enc.c) | 937 | `avcodec_open2` 337；`avcodec_receive_packet` 655；`sch_enc_send` 717。[源码锚点](https://github.com/FFmpeg/FFmpeg/blob/n8.0/fftools/ffmpeg_enc.c#L330-L345) · [收包与转发](https://github.com/FFmpeg/FFmpeg/blob/n8.0/fftools/ffmpeg_enc.c#L650-L718) |
| [`libavcodec/nvenc.c` raw](https://raw.githubusercontent.com/FFmpeg/FFmpeg/n8.0/libavcodec/nvenc.c) | 3332 | `nvenc_open_session` 408；`nvEncOpenEncodeSessionEx` 425；`nvenc_setup_device` 758；`ff_nvenc_encode_init` 2248，并于 2283 调用设备设置。[会话打开](https://github.com/FFmpeg/FFmpeg/blob/n8.0/libavcodec/nvenc.c#L408-L432) · [初始化调用](https://github.com/FFmpeg/FFmpeg/blob/n8.0/libavcodec/nvenc.c#L2248-L2287) · [设备设置路径](https://github.com/FFmpeg/FFmpeg/blob/n8.0/libavcodec/nvenc.c#L758-L856) |
| [`fftools/ffmpeg_mux.c` raw](https://raw.githubusercontent.com/FFmpeg/FFmpeg/n8.0/fftools/ffmpeg_mux.c) | 892 | `packets_written` 递增 229；`av_interleaved_write_frame` 236。[源码锚点](https://github.com/FFmpeg/FFmpeg/blob/n8.0/fftools/ffmpeg_mux.c#L224-L242) |
| [`libavformat/gifdec.c` raw](https://raw.githubusercontent.com/FFmpeg/FFmpeg/n8.0/libavformat/gifdec.c) | 295 | `gif_probe` 73；`gif_read_header` 114；seekable scan 146；帧累计 210；seek 回起点 216–219；packet reader 244；`ignore_loop` 默认值 273。[probe/header](https://github.com/FFmpeg/FFmpeg/blob/n8.0/libavformat/gifdec.c#L73-L148) · [扫描与回位](https://github.com/FFmpeg/FFmpeg/blob/n8.0/libavformat/gifdec.c#L146-L219) · [packet reader 与选项](https://github.com/FFmpeg/FFmpeg/blob/n8.0/libavformat/gifdec.c#L244-L274) |

## Snapshot Cost

当前 `status()` 每次先读取 `records = this.store.tasks()`，再从这份快照构造 `open`、项目任务、批次和暂停消息；`pausedMessage()` 将同一 `open` 传给阻塞查询。因此 status 内部这些分支共用一次新鲜任务快照，不跨调用或通知缓存。`tasks()` 仍对完整 `this.data.tasks` 执行 `structuredClone()`，所以即使只投影一个项目，每次 `status()` 仍克隆完整任务图。以上是源码调用结构，不代表已测得的耗时或内存收益。[`status()` 和快照传递（106–117）](../../src/main/douyin-upload-service.ts)；[暂停/阻塞查询复用 `open`（145–172）](../../src/main/douyin-upload-service.ts)；[`tasks()` 的克隆边界（73–79）](../../src/main/douyin-upload-store.ts)

Node 文档将全局 `structuredClone()` 指向 WHATWG structured clone 方法；调用返回该算法创建的克隆数据图。官方 API 资料没有给出此仓库负载下的复杂度或耗时，不能据此量化收益。[Node.js `structuredClone`](https://nodejs.org/docs/latest/api/globals.html#structuredclonevalue-options)；[WHATWG structured clone algorithm](https://html.spec.whatwg.org/multipage/structured-data.html#structured-cloning)

可比的成熟实践是 Redux selectors：其文档将过滤和汇总视为从 state 派生的视图数据，并示范一次读取 state 后把该 state 交给 selector。它与“一个调用内从同一快照派生多个投影”结构相近，但不涉及 `structuredClone`，也不能证明本仓库的性能收益或支持跨通知缓存。[Redux 派生数据与 selectors](https://redux.js.org/usage/deriving-data-selectors#reading-state-once)
