# HUD5 — Swift / macOS 原生端

Web 端（`../src`）负责 HUD 叠加层生成和透明视频导出；Swift 端专注于**路线编辑**（HUDRouteLab），同时提供原生 ProRes 导出管线作为 Puppeteer + FFmpeg 的替代方案。

## 包结构

| 包              | 类型      | 说明                                                                                                                                                                                                                    |
| --------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HUD5Core`    | 库 + 测试 | 从 `src/util` + `src/data` 1:1 移植的纯逻辑层：投影、航向、单位、时间码、坐标系、遥测（CSV/JSON）、GPS 降噪、路网吸附、轨迹解析（GPX/GeoJSON）、姿态采样。无 UI、无平台依赖。                                       |
| `HUD5Export`  | 库 + CLI  | `HUD5Render`（CoreGraphics HUD 渲染器）+ `hud5-export` CLI（AVFoundation ProRes 4444 **alpha** 写入器）。替代 Puppeteer + FFmpeg。                                                                            |
| `HUD5App`     | 可执行    | SwiftUI 预览 App，复用 `HUD5Core` + `HUD5Render`；回放 + 文件加载。**UI 开发在 Xcode 中进行。**                                                                                                               |
| `HUDRouteLab` | 可执行    | **主力路线编辑器。** SwiftUI/MapKit 路网路线与时间线编辑器。导入 GPX/GeoJSON 轨迹和 MOV/MP4 视频（含嵌入 `tmcd` 时间码），预览同步视频与路网吸附，在地图上编辑航点，导出 HUD 兼容的 GeoJSON 供 Web 叠加层使用。 |

## 构建与测试（命令行）

```bash
# 数据层 — 无需 Xcode 即可测试
cd HUD5Core && swift test

# 导出管线
cd HUD5Export && swift test
swift run hud5-export --track ../../local/some.gpx --out out.mov --fps 60 --duration 10

# 预览 App（编译 + 启动；正式 UI 开发请用 Xcode）
cd HUD5App && swift build && swift run

# 路线编辑器
cd HUDRouteLab && ./script/build_and_run.sh
```

### hud5-export 参数

```
--telemetry <path>   CSV 或 JSON
--track <path>       GPX 或 GeoJSON
--out <path>         输出 .mov（ProRes 4444，含 alpha）
--fps <n>            [60]
--duration <sec>     默认 = 源时长
--start <sec>        播放头起点 [0]
--unit kmh|mph       [kmh]
--width/--height     [1920x1080]
--telemetry-offset / --track-offset <sec>
--snap <m>           吸附到参考层（0 = 关闭）
```

验证 alpha 输出：

```bash
ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,profile,pix_fmt out.mov
# 预期：prores / 4444 / yuva444p12le
```

## 在 Xcode 中打开

Xcode 可直接打开 `Package.swift`，无需 `.xcodeproj`：

```bash
xed HUD5App        # 或：open HUD5App/Package.swift
```

Xcode 提供 SwiftUI Previews、View Debugger（检查 CALayer/HUD 几何）和 Instruments（逐帧计时、CVPixelBuffer 泄漏检测）——导出和 UI 阶段的必备工具。

## 进度

### HUD5Core / HUD5Export / HUD5App（HUD 渲染-未完成）

- [X] 数据层（`HUD5Core`）— 移植完成 + 通过 TS 测试套件验证
- [X] 导出管线（`HUD5Export`）— 原生 ProRes 4444 alpha，端到端验证通过
- [X] 预览 App 骨架（`HUD5App`）— 编译 + 启动；回放 + 文件加载
- [X] 设计令牌 + 字体 — oklch→sRGB 精确转换，捆绑 Archivo + JetBrains Mono
- [X] 速度表、进度面板、位置面板 — 与 TSX 源一致
- [X] 小地图 — 圆盘、环、航向窗口、图层、车辆箭头、指北针、比例尺、透视倾斜、边缘淡化 + 辉光
- [X] AVPlayer 视频时间源 + 同步
- [ ] 编辑模式：可拖拽布局 + 高级设置，持久化到 UserDefaults

### HUDRouteLab（路线编辑）— 活跃开发中

- [X] 基于 MapKit 的路线编辑器，支持交互式航点编辑
- [X] OSM 路网获取 + Dijkstra 寻路路网吸附
- [X] GPX / GeoJSON 轨迹导入，含参考道路识别
- [X] MOV/MP4 视频导入，含嵌入 `tmcd` 时间码提取
- [X] 同步视频时间线预览 + 回放控制
- [X] 轨迹时间线拖动 + 吸附预览
- [X] 绘制路径缓存与路线采样优化
- [X] GeoJSON 导出供 Web HUD 使用
- [ ] 批量路线处理
