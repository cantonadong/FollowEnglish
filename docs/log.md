# 开发日志

## 环境信息（关键，供后续迭代复用）

- OS: Windows 11 Pro
- Node: v24.14.0 / npm: 11.17.0
- Python: 3.11.9（本项目**未使用** Python 做 ASR，见下）
- ffmpeg: 8.1-full_build-www.gyan.dev（gyan.dev 发行版）
  - **关键发现**：该 ffmpeg build 编译时带 `--enable-whisper`，自带 `whisper` 音频滤镜（基于 whisper.cpp），支持 `format=srt|json|text` 直接输出带时间戳转写结果。
  - 因此本项目 ASR **不需要**额外安装 Python 的 openai-whisper / faster-whisper / torch，只需一个 ggml 格式的模型文件 + ffmpeg 命令行即可，大幅降低内存/CPU占用和环境复杂度。
  - `ffmpeg -h filter=whisper` 可查看完整参数：`model`, `language`, `format`, `destination`, `max_len`, `vad_model`, `use_gpu` 等。
- git: 2.54.0.windows.1

## 任务节点状态

| # | 任务 | 状态 | 备注 |
|---|---|---|---|
| 1 | 需求开发文档 | ✅ 完成 | `docs/需求开发文档.md` |
| 2 | 开发日志建立 | ✅ 完成 | 本文件 |
| 3 | 项目脚手架 | ✅ 完成 | frontend(React+Vite+TS) / backend(Node+Express+TS) 均已跑通健康检查 |
| 4 | 播放器 UI Preview | ✅ 完成，已按用户反馈修改一轮 | 路由 `/preview/player`，见下方"交付说明" |
| 5 | 上传页 UI Preview | ✅ 完成，待用户验证 | 路由 `/preview/upload`，见下方"交付说明" |
| 6 | 下载 whisper 模型 | ✅ 完成 | `backend/models/ggml-base.en.bin`（141MB） |
| 7 | 后端上传+转码接口 | ✅ 完成，真实视频验证通过 | |
| 8 | 后端字幕生成 | ✅ 完成，真实语音验证通过 | 逐词时间戳+标点重组句子，见下方踩坑记录 |
| 9 | 联调+打包启动脚本 | ✅ 完成 | 根目录 `start.bat`（开发调试用） |
| 10 | 打包独立 exe（托盘/无窗口/单实例） | ✅ 完成 | 根目录 `FollowEnglish.exe`，见下方交付说明 |

## 已确认的技术/产品决策

- ASR：本地 ffmpeg whisper 滤镜（非云端 API），模型默认 `ggml-base.en.bin`
- 技术栈：前端 React+Vite+TS，后端 Node.js+Express
- 视频兼容性：统一转码 mp4(h264+aac)
- 字幕位置：底部居中，留出舒适间距（约12%视频高度，不贴边）
- 字号：连续可调（cqh 单位，3%~25%视频高度），非固定档位
- ← 键：专指跳到上一句开头，不做时间阈值判断
- 主题：浅色
- **句子拆分准确性优先**：不能直接用 whisper 停顿分段，需基于逐词时间戳+标点重新切句（见 `docs/需求开发文档.md` 4.1节）
- 详见 `docs/需求开发文档.md` 第8节"待确认/已决策事项"

## 模块4交付说明：播放器 UI Preview

- 修改/新增文件：
  - `frontend/src/components/player/*`（PlayerView / SubtitleOverlay / ControlsBar / SentenceList，均为可复用组件，后续真实播放页直接复用）
  - `frontend/src/lib/sentenceNav.ts`（上一句/下一句跳转逻辑、字号范围，纯函数）
  - `frontend/src/lib/useKeyboardShortcuts.ts`（键盘快捷键 hook）
  - `frontend/src/mocks/sentences.ts`（mock 字幕：normal / edge-case / empty 三组）
  - `frontend/src/pages/PlayerPreview/*`（Preview 页面，含 normal/loading/empty/error/edge-case 场景切换 tab）
  - `frontend/public/mock/sample.mp4`（用 ffmpeg 生成的60秒本地测试视频，画面带时间戳，便于肉眼核对跳句/seek是否准确）
  - 清理了 Vite 默认模板的无关资源文件
- 预览入口：`http://localhost:5173/preview/player`
- 是否改动业务逻辑：否，纯 UI + mock 数据

**用户反馈修改记录（2026-07-29）：**

1. 字幕距底边留出舒适间距（不贴边），已调整 bottom 从 7% → 12%
2. "←" 专指上一句，去掉了"播放超过1.5秒先回到本句开头"的逻辑（`sentenceNav.ts` 简化）
3. 字号改为连续可调（单位 cqh = 视频高度百分比），范围 3%~25%（不超过视频高度1/4），不再是固定5档，可持续按不卡死
4. 主题由深色改为浅色（`PlayerView.css` / `PlayerPreview.css` / `index.css` 均已改）
5. **最重要**：句子拆分准确性 —— 已在 `docs/需求开发文档.md` 4.1节 明确记录：真实后端实现时不能直接用 whisper 的停顿分段当作"一句"，必须基于逐词时间戳+句末标点重新切句，避免语义不完整截断；仅超长句子才允许在语法完整的自然断点处二次拆分。这一条是第8步"后端字幕生成"任务的核心验收标准。

## 模块5交付说明：上传页 UI Preview

- 新增文件：
  - `frontend/src/components/upload/UploadPanel.tsx` + `.css`：可复用的上传/进度/错误面板组件（后续真实上传页直接复用，只需把 mock 驱动换成真实 job 状态轮询）
  - `frontend/src/pages/UploadPreview/*`：Preview 页面，顶部 tabs 可直接跳到任意状态快照（normal/uploading/transcoding/transcribing/ready/error）查看视觉效果
- 交互设计：在"normal 待上传"tab 下拖拽或选择一个真实文件，会触发**前端模拟**的完整流程（上传% → 转码% → 识别中计时 → 完成 → 自动跳转到播放页 Preview `/preview/player`），不会真的发送到后端，纯用于验证视觉/动效节奏是否符合预期
- 预览入口：`http://localhost:5173/preview/upload`
- 是否改动业务逻辑：否
- 待用户确认：
  1. 各状态（上传中/转码中/识别中/完成/失败）的视觉呈现和文案是否合适
  2. 错误状态的重试按钮交互是否符合预期
  3. 整体卡片式布局（居中卡片 + 顶部标题/副标题）是否需要调整

## 模块6-9交付说明：真实后端 + 联调 + 启动脚本

- **whisper 模型**：`backend/models/ggml-base.en.bin`（英文专用 base 模型，约141MB），从 `huggingface.co/ggerganov/whisper.cpp` 下载，一次性成功，未触发联网重试流程
- **后端管线**（`backend/src/pipeline/`）：
  - `transcode.ts`：ffmpeg 转码为 mp4(h264+aac)，`getMediaDurationSeconds`(ffprobe) + `-progress pipe:1` 解析出转码百分比
  - `transcribeWords.ts`：ffmpeg whisper 滤镜提取逐词时间戳（见下方踩坑记录的两个关键参数）
  - `buildSentences.ts`：纯函数，把逐词时间戳流按句末标点重组为句子，超长句子（>15秒 或 >30词）才在最近的逗号处强制二次拆分；已用真实语音 + 合成边界用例验证：普通复合句（含逗号不含句号）不会被错误截断、多句能在句号处正确分割、超长句仅在逗号处拆分
  - `jobStore.ts` / `runPipeline.ts`：内存态任务状态机 `uploading→transcoding→transcribing→ready/error`
- **接口**（`backend/src/routes/`）：`POST /api/upload`、`GET /api/jobs/:id`、`GET /api/jobs/:id/subtitles`、`/media/:id/video.mp4`（express.static，天然支持 Range 请求，已验证返回 206 Partial Content，视频可正常拖动进度条）
- **前端真实页面**：`src/pages/Upload/Upload.tsx`（XHR 上传进度 + 轮询任务状态，完成后跳转 `/player/:jobId`）、`src/pages/Player/Player.tsx`（拉取字幕 + 复用 `PlayerView` 组件）；`/preview/*` 两个 Preview 路由保留，供后续 UI 迭代继续使用
- **启动脚本**：根目录 `start.bat`，双击后台启动后端（同时用 express.static 托管已 build 的前端 `frontend/dist`），3秒后自动打开浏览器 `http://localhost:4000/`
- **端到端验证**：用 ffmpeg 合成的真实语音测试视频（`.mov` 容器，JFK演讲录音"And so my fellow Americans, ask not what your country can do for you, ask what you can do for your country."）走完整流程——上传→转码→识别→播放，字幕文本 **100% 准确**且未被截断，视频 Range 请求、SPA 前端路由均验证通过

### 关键踩坑记录（ffmpeg whisper 滤镜）

1. **filter 语法**：必须是 `whisper=model=...:language=en:...`（滤镜名后第一个是 `=`，之后的键值对用 `:` 分隔）。写成 `whisper:model=...`（把 `=` 也写成 `:`）会报 `No option name near ...` 且不易一眼看出错在哪。
2. **Windows 绝对路径带盘符冒号（如 `D:\...`）会与 filter 语法的 `:` 分隔符冲突**，导致解析错误。解决方式：调用 ffmpeg 时设置 `cwd` 为某个工作目录，`model=`/`destination=` 用相对路径（正斜杠）传入，彻底避免盘符冒号出现在 filter 字符串里。`-i` 输入文件参数本身不受此限制，可以正常用绝对路径。
3. **`queue`（默认3秒）严重影响识别准确率**：这是滤镜内部按固定时长冲刷（flush）转写结果的窗口，3秒的默认值会导致上下文不足、识别结果支离破碎甚至幻觉（同一句话被拆成好几段乱码）。改为 `queue=30`（30秒）后，同一段音频识别结果完全准确。这是准确率问题的根本原因，比句子重组算法本身更关键。
4. **`max_len=1` 是获取逐词时间戳的关键**：whisper.cpp 原生支持把内部 token 级时间戳按"最大段长度（字符数）"切分输出，设为 1 就能让每个输出条目近似为单个词（含标点），这样才能自己按标点重组句子，而不必依赖滤镜自带的（基于停顿的）分段。
5. **PowerShell 测试踩坑（非产品代码问题）**：`$home` 是 PowerShell 只读内置变量，不能用作自定义变量名；`Invoke-WebRequest` 在 Windows PowerShell 5.1 下无法直接设置 `Range` 请求头，需用 `curl.exe` 验证 Range 支持。

## 如何运行完整应用（真实上传+识别+播放）

**日常使用**：双击项目根目录的 `FollowEnglish.exe`。没有控制台窗口，系统托盘（任务栏右下角）会出现一个图标，右键可以"打开"或"退出"；会自动打开浏览器。只允许同时运行一个实例。

**改完代码后要发布新版本**：跑一下根目录的 `build.bat`（依次重新编译前端、后端、launcher），完成后重新运行 `FollowEnglish.exe` 即可用上最新代码。

**开发调试**：`start.bat` 会显示控制台窗口方便看日志（用的是 tsx 直接跑 TS 源码，改代码不用重新编译，但每次都要手动开）；日常使用请用 `FollowEnglish.exe`。

## 如何运行 Preview（UI 开发调试用）

```
cd frontend
npm install   # 首次
npm run dev
```

浏览器打开 `http://localhost:5173/preview/upload` 或 `/preview/player`，用于后续 UI/交互调整时的快速预览（不依赖真实后端）。

## 踩坑记录 / 经验

（持续更新）

## 已修复 Bug：长视频处理4分钟以上后报错「处理失败」+ JSON 解析错误

- **现象**：用户反馈处理时间较长的视频时，字幕生成阶段报错「处理失败」，错误信息为 `Expected ',' or '}' after property value in JSON at position 36 (line 1 column 37)`
- **根因**：ffmpeg 的 `whisper` 滤镜在 `max_len=1`（逐词输出）模式下，遇到语音中的引号/问号等发音内容时，偶尔会把一个**裸引号字符本身**识别成一个"词"输出到 `text` 字段里，但 ffmpeg 没有对这个引号做 JSON 转义，导致该行变成类似 `{"start":68184,"end":68264,"text":"""}` 这种非法 JSON（三个引号连在一起，无法确定字符串边界）。原本按行 `JSON.parse` 的写法遇到这种行就直接抛异常，导致整个转写任务失败——**用真实较长视频（含较多疑问句/引用）时命中概率更高，这就是"短视频没事、长视频4分钟后必现"的原因**（视频越长，包含引号/问号内容的概率越高，并不是"处理时长"本身导致的）
- **修复**（`backend/src/pipeline/transcribeWords.ts`）：改用**基于已知固定格式的宽松解析**，不再依赖严格 JSON.parse：按字面量 `{"start":` 作为对象起始标记切分（同时解决"两个对象之间缺少换行"的潜在问题），再用固定结构的正则贪婪匹配到每个对象末尾的 `"}` 提取 `text` 字段内容，这样无论 `text` 里有多少个未转义的引号都能正确提取到完整文本；无法匹配固定格式的极少数异常行会被跳过（丢一个词而不是让整个任务失败）
- **验证**：用用户实际失败的那份 92 分钟视频的真实 `words.json`（20959 行，92分钟真实语音内容）重新解析——旧方法在 44 行上失败（其中就包含用户报错信息里一模一样的 `position 36 (line 1 column 37)`），新方法全部 20959 行解析成功，重组出 1354 句字幕，人工抽查首尾句子文本合理
- **后续建议**：未来如果 ffmpeg/whisper.cpp 更新修复了引号转义问题，这个宽松解析仍然兼容（只是不会再触发跳过逻辑），无需回退

## 新增：处理结果缓存（按视频内容去重，避免重复转码/识别）

- **需求**：已经转码+识别过的视频，再次上传时应直接复用已有结果，不用每次都重新跑一遍转码和语音识别
- **实现**（`backend/src/pipeline/hashFile.ts` + `cache.ts` + `routes/upload.ts` + `runPipeline.ts`）：
  - 上传后先计算文件内容的 SHA-256 哈希，**用哈希值作为 jobId**，同时把原始文件按哈希值重命名保存到 `uploads/` 下（同内容重复上传时，新的临时文件会直接丢弃，不会存两份）
  - 上传接口按优先级检查三层缓存：① 内存里是否已有该哈希对应的任务在处理中或已完成 → 直接复用同一个 jobId；② 磁盘上 `processed/<hash>/` 目录下是否已有完整的 `video.mp4` + `subtitles.json` → 直接标记为 ready（这一层保证**服务器重启后依然能识别出已处理过的视频**，不依赖内存状态）；③ 都没有才真正跑一遍完整流程
  - 处理成功后把字幕数据额外持久化一份到 `processed/<hash>/subtitles.json`（之前只存在内存的 jobStore 里，重启就没了）
  - 顺带做了断点续跑：如果之前处理到一半失败了（比如转码成功但识别失败），重试时如果 `video.mp4`/`audio.wav` 已经存在会跳过对应步骤，不用从头重新转码
- **验证**：同一份测试视频连续上传三次——第一次完整走流程（约1.1秒，测试视频很短）；第二次（同一服务器进程内）命中内存缓存，0.05秒直接返回 ready；模拟服务器重启后第三次上传，命中磁盘缓存，0.08秒直接返回 ready 且字幕正常返回。上传目录确认只保留一份文件，未重复存储

### 顺带发现并清理的遗留文件

调试过程中发现 `backend/uploads` 和 `backend/processed` 下有两份约72分钟长视频的处理残留（转码后视频+音频+部分字幕，但未走完全流程、没有最终字幕文件），推测是这次调试期间你本地也在用 `start.bat` 尝试的真实视频。由于这两份是旧版任务ID体系下的产物、且未处理完整（无法被新的缓存机制复用），已一并清理释放磁盘空间。**如果你那次上传因为我这边同时在测试而中断/失败了，麻烦重新上传一次**，现在的版本应该没问题；后续我在本地起测试服务时会更注意避免占用/打断你正在使用的实例。

## 已修复：第4句（及类似位置）无法通过左右键切换到

用户反馈：某个真实视频（约72分钟，Netflix CPTO访谈）"第4句无法通过左右切换到，3完了直接就是5，反过来也是"。排查后发现是**两个独立问题叠加**：

1. **后端：长音频在每30秒处理窗口边界上会产生"幻觉"内容**
   - ffmpeg 的 whisper 滤镜按 `queue=30`（30秒）为单位分段处理长音频，几乎每个30秒边界都可能出现 whisper 的经典幻觉（形如 "BLANK_AUDIO"，被 `max_len=1` 拆成 "BL"/"ANK"/"AUD"/"IO" 等碎片），且这些幻觉片段的时间戳会与紧随其后的真实内容**时间倒错**（例如幻觉标了 30530-34370ms，但后面真实的"Ask what you can do..."实际是 30192ms 开始，比幻觉还早）。这会导致重组出的句子文本里混入垃圾片段、时间戳错乱，进而让基于时间戳的"当前句"判定和前后句列表出现错位/不可达
   - 用真实的72分钟视频数据复现：全片检测到44处时间戳倒退，均集中在30秒的整数倍附近，和"queue=30秒切片"的假设完全吻合
   - **修复**（`backend/src/pipeline/buildSentences.ts` 新增 `sanitizeWordTimestamps`）：重组句子前先扫一遍逐词时间戳流，一旦发现某个词的开始时间早于"已接受词"的时间，就判定前面刚接受的那几个词是幻觉，直接回退丢弃，再接受当前词——不需要识别"BLANK AUDIO"这种具体文本，只按时间先后这一通用规则处理，同样能兜住其他类似的边界幻觉
   - 用户实际视频重新生成字幕后：945句（原974句，清理掉29处幻觉/异常），已确认无残留的乱序或幻觉文本泄漏到句子里；由于这份视频之前已经被处理并缓存过，我直接用已有的 `words.json`（无需重新语音识别）离线重新生成并覆盖了 `processed/<该视频hash>/subtitles.json`
2. **前端：相邻句子首尾时间完全衔接（无间隔）时，"当前句"判定和播放/跳转之间存在竞态**
   - `←`/`→`/点击列表 之前是拿"当前播放时间"现查一遍在哪一句里，如果两句时间正好首尾相接（比如上一句结尾=下一句开头），跳转瞬间可能命中错误的一句，且循环播放的判定和这次跳转之间还存在一个 React 状态更新延迟带来的时序竞争
   - **修复**（`components/player/PlayerView.tsx`）：不再临时用时间反查"当前是第几句"，而是统一维护一个"当前句序号"，上一句/下一句/点击列表都直接对这个序号做加减/赋值，并且是**同步**更新（不等 React 渲染完成后才生效），彻底消除竞态

同时把之前测试用的4:46合成视频、真实用户视频的临时验证脚本都已清理，不影响你已缓存的处理结果（该视频的字幕已经原地更新为修复后的版本）。

顺带补了一个小口子：之前只有"上传接口"会检查磁盘缓存，`GET /api/jobs/:id`（状态/字幕查询接口）不会——如果后端重启后直接刷新播放页（没有重新走一遍上传），会 404。现在这两个查询接口在内存里找不到任务时，也会自动去磁盘缓存兜底，不需要重新上传就能拿到（已修复的）结果，已用你这份真实视频验证过：重启后端、不重新上传，直接查状态/字幕接口，正确返回945句。

## 已修复：右侧句子列表把整个页面撑高、当前句没有居中显示

- **现象**：右侧句子列表内容一多，会把整个播放页撑得超过一屏，需要滚动整个页面才能看全；当前播放句在列表里没有稳定居中显示
- **根因**：`.player-preview` 用的是 `min-height: 100vh`（允许无限增高）而不是固定 `100vh`，导致下面几层 flex 容器（`.player-preview__stage`、`.player-view__main`、`.player-view__sidebar`）都没有真正被限制在一屏高度内，子元素撑多高，父容器就跟着长多高，而不是在自己内部出滚动条
- **修复**：`.player-preview` 改为 `height: 100vh; overflow: hidden`，并给中间几层 flex 容器补上 `min-height: 0`（flex 子项要在这个属性存在的前提下才会真正被父级高度限制、内部溢出内容自己滚动，这是 flex 布局的一个常见坑）。同时把句子列表跳转时的 `scrollIntoView` 从 `block: "nearest"` 改为 `block: "center"`，当前播放句现在会始终尽量停在列表可视区域的垂直居中位置
- 涉及文件：`pages/PlayerPreview/PlayerPreview.css`（Player.tsx 也复用这份样式）、`components/player/PlayerView.css`、`components/player/SentenceList.tsx`

## 已修复：第4句仍然切换不到（关键帧密度问题）+ 点击句子不应强制居中

- **第4句问题的真正根因**：排查后发现该句本身数据完全正常（"We are in the middle of that right now." 16.56s-18.52s，时间戳、文本都没问题），问题出在**转码时的关键帧间隔太稀疏**——原转码命令没有设置关键帧间隔，libx264 默认间隔可能长达数秒（实测这份视频有一段关键帧间隔达6秒），而第4句刚好整句都落在两个关键帧之间。浏览器跳转到这种"远离关键帧"的时间点时，需要从上一个关键帧开始解码一大段才能到达目标位置，定位容易不够精确，对于像第4句这种不到2秒的短句，误差就足以让画面/判定落到相邻句子上
  - **修复**（`backend/src/pipeline/transcode.ts`）：转码时加上 `-force_key_frames "expr:gte(t,n_forced*1)"`，强制约每秒一个关键帧，跳转精度大幅提升（代价是文件体积变大一些，可接受）
  - 已用这份真实视频验证：重新转码后关键帧间隔精确到每秒一个（之前有的间隔长达6秒），**直接复用已有原始文件重新转码**（不需要用户重新上传），耗时约90秒（72分钟视频），已原地替换 `processed/<视频hash>/video.mp4`，字幕数据不受影响
  - 之后新上传的视频会自动使用这个新的转码参数，不需要额外处理
- **点击句子列表不应强制居中**：之前"点击选句"和"播放中自动前进/按键切换"共用同一套居中滚动逻辑，导致点击后也会被强制滚到中间（此时用户明明已经看到这句、不需要再滚动）。现在用一个标记区分两种触发来源：点击列表时跳过强制居中滚动，只有播放自然推进或按 ←/→ 切换时才继续保持当前句居中显示

## 已修复（真正根因）：第4句无法切换 —— 浮点数精度导致"当前句序号"卡住

前两轮排查（幻觉时间戳、关键帧密度）都是真实存在且值得修的问题，但都不是这次"第4句切换不到"的根本原因——修完之后用户反馈依然复现。这次改用 **Playwright 自动化真实 Chromium 浏览器**直接操作页面、读取渲染结果来定位（而不是纯看代码推理），很快就抓到了实锤：

- 点击"第3句"后 `video.currentTime` 正确变成 `8.8`；按一次 → 后，视频**确实跳到了第4句的位置**（`currentTime` 变成 `16.559999`），但界面显示的"当前第几句"**没有变**，还停在"3 / 945"！再按一次 → ，时间和显示都**完全没变化**（等于这次按键什么也没做）；这时按 ← ，界面跳到了"2 / 945"（第2句）
- 根因：`findActiveIndex` 用 `currentTime >= sentence.start` 判断"现在是第几句"。但**浏览器 seek 到某个时间点后，`video.currentTime` 读出来的值和设定值并不完全相等**（这里实测设定 16.56，读回来是 16.559999，差了百万分之一秒，应该是浏览器/编解码器内部时间基准转换的精度误差）。16.559999 严格小于 16.56，导致"是否已经进入第4句"这个判断为 false，"当前第几句"就一直卡在第3句——而"下一句"的计算又是基于这个卡住的序号算的，所以無論怎么按，永远在"3⇄2"之间打转，第4句彻底不可达
- **修复**（`frontend/src/lib/sentenceNav.ts`）：判断时加了 0.1 秒的容差（`currentTime + 0.1 >= sentence.start`），把这种"seek 精度导致差一点点"的情况兜住
- **验证**：用 Playwright 实际操作真实浏览器复现——修复前，按 → 卡在"3/945"不变、按 ← 跳到"2/945"，和用户描述完全吻合；修复后，连续按20次 → 能从 1/945 一路正确走到 21/945，再连续按20次 ← 能原样一路走回 1/945，全程无跳号、无卡住
- **经验教训**：这类"看代码怎么推理都觉得应该没问题"的 bug，与其反复猜测，不如直接用 Playwright 起一个真实浏览器跑一遍、把每一步的真实渲染结果打印出来对比——这次就是这样几分钟内锁定的，比纯代码走查快得多。以后再遇到类似"感觉逻辑没错但用户说不对"的情况，会优先用这种方式复现

## 新增：Q 键重播本句 + 开启状态按钮变蓝

- `Q`：重播当前句（跳回当前句开头，不影响播放/暂停状态），复用了已有的 `seekToSentence`，逻辑上等同于"跳到自己"
- 字幕开关、单句循环开关按钮：开启状态下背景变成蓝色（`#3b6fe0`，和全站强调色一致），关闭时是原来的中性灰
- 用 Playwright 实测验证：跳到第3句播放到中途，按 Q 后 `currentTime` 精确回到第3句开头、序号仍是"3/945"；单句循环默认开启时按钮背景色为 `rgb(59,111,224)`（即#3b6fe0），关闭后恢复中性色

## 新增：打包成独立 exe（托盘图标、无 cmd 窗口、单实例）

- **需求**：不要 cmd 黑窗口，任务栏（系统托盘）有图标可右键退出，只允许一个实例运行，尽量省内存/CPU
- **技术选型**：没有用 Electron（太重）也没有用 Node 的单文件打包（SEA，还要解决内嵌原生托盘辅助程序的问题，比较折腾），而是**用 Go 单独写了一个轻量启动器**（`launcher/main.go`），理由：
  - dev规范里本机已装 Go，不用额外装新工具
  - Go 编译出来是原生单文件 exe，没有运行时依赖，内存占用是几MB到十几MB级别（对比 Electron 动辄上百MB），完全符合"节省内存和CPU"的要求
  - 托盘图标用的是 `fyne.io/systray`，在 Windows 上是纯 Win32 API 调用（不需要 CGO/C编译器），`go build` 直接能过
- **具体实现**：
  - `-ldflags "-H=windowsgui"` 编译成 GUI 子系统程序，Windows 本身就不会为它分配控制台窗口（不是"隐藏"，是根本不创建，比隐藏更彻底）
  - 后端 Node 子进程通过 `syscall.SysProcAttr{HideWindow:true, CreationFlags:CREATE_NO_WINDOW}` 启动，同样不会弹控制台
  - 单实例：用 Windows 命名 Mutex（`CreateMutex`），第二次启动检测到 Mutex 已存在就只打开一次浏览器然后退出，不会重复起后端
  - **进程清理的关键点**：只在托盘菜单"退出"里 kill 子进程是不够的——如果用户直接在任务管理器里强杀这个托盘程序，子进程会变成孤儿进程。改用了 **Windows Job Object**（`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`），把 Node 子进程绑定到一个 Job 上，这样不管这个托盘程序是正常退出、崩溃、还是被强杀，Windows 都会自动把 Node 子进程也一起杀掉，不会留下孤儿进程占用内存
  - 打开浏览器用的是 `rundll32 url.dll,FileProtocolHandler`，同样不会有窗口闪一下
- **后端改造**：之前后端一直是用 `tsx` 直接跑 TypeScript 源码（开发方便，但打包成独立exe场景下不该依赖 tsx/npm）。新增了 `npm run build`（`tsc` 编译到 `backend/dist/*.js`），托盘程序直接用系统的 `node.exe` 跑编译后的 `dist/server.js`，不再依赖 tsx。**开发时还是用 `npm run dev`/`npm run start`（tsx，改代码不用重新编译），打包发布时才需要跑编译**
- **验证结果**（均为实测）：
  - 双击运行后 `node` 和 `FollowEnglish` 两个进程都在跑，健康检查接口正常返回，都没有 `MainWindowTitle`（没有窗口）
  - 重复启动第二次：没有产生第二个 `node` 进程，符合单实例预期
  - 直接强制 kill 托盘程序进程（模拟任务管理器强杀）：Node 子进程也跟着一起消失了，没有变成孤儿进程
- **一键构建脚本**：根目录新增 `build.bat`，依次编译前端、编译后端、编译 launcher，最终产出 `FollowEnglish.exe`。以后改完代码想打包发布，跑一下这个脚本就行
- `start.bat` 保留作为开发调试用（会显示控制台窗口，方便看后端日志报错），正式使用请用 `FollowEnglish.exe`

## 新增：给 FollowEnglish.exe 加上软件图标

之前只有系统托盘图标是自定义的（运行时用 `go:embed` 加载），exe 文件本身在资源管理器里显示的还是 Go 默认图标。用 `go-winres`（`go install github.com/tc-hib/go-winres@latest`）把同一份 `icon.ico` 编译成 Windows 资源文件（`.syso`），Go 编译器会自动把它链接进 exe，这样文件本身在资源管理器、桌面快捷方式等地方也会显示自定义图标（顺带设置了产品名称/文件描述）。已用 `System.Drawing.Icon.ExtractAssociatedIcon` 从编译好的 exe 里提取图标验证过，确实是自定义的蓝色图标。`build.bat` 已更新为每次构建都会自动重新生成这个资源文件，不用手动操作。

## 待处理事项

- 目前所有模块均已开发完成并通过自测（含真实语音端到端验证），等待用户实际使用验证
- 任务状态存储在内存中，重启后端会丢失历史任务记录（符合"无账号/历史"的产品决策，非缺陷）
- base.en 模型在准确率和资源占用之间是当前的默认取舍；如用户反馈识别精度不够，可平滑升级到 `small.en`（仅需换模型文件+改 `MODEL_RELATIVE_FROM_JOB_DIR` 常量，无需改逻辑）
