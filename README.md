# HUD5 Overlay

一个基于 React + Vite 的赛车 HUD 叠加层工具，用于把车辆遥测、路线轨迹和视频素材同步播放，并导出可用于剪辑软件的透明 HUD 视频。

![HUD5 Overlay preview](public/preview.png)

项目当前的视觉方向参考了 Forza Horizon 风格：速度表、进度/时间、右上角名次、小地图轨迹、玩家名称和海拔等信息都会以固定 16:9 HUD 舞台渲染。

## 功能

- 加载并播放遥测数据：支持 `.csv` 和 `.json`
- 加载路线数据：支持 `.gpx` 和 `.geojson`
- 加载视频：支持 `.mp4`、`.mov`、`.webm`、`.m4v`
- 视频与遥测时间同步
- 小地图显示路线、方向、已行驶轨迹和比例尺
- 支持 WGS-84 / GCJ-02 / BD-09 轨迹坐标系，导入后统一转换为 WGS-84
- 支持 OSM 路网补全、轨迹点吸附到参考道路、可调小地图视野/俯视角/线宽
- 支持 `km/h` / `MPH` 切换
- 支持拖拽调整 HUD 组件位置，并保存到 `localStorage`
- 支持用 Puppeteer + FFmpeg 导出透明 WebM / ProRes 视频
- 提供 OBD 长格式日志转换脚本

## 快速开始

安装依赖：

```bash
npm install
```

启动开发服务器：

```bash
npm run dev
```

打开 Vite 输出的本地地址后，可以直接拖入：

- 视频文件
- `telemetry.csv` / `telemetry.json`
- `track.gpx` / `track.geojson`

也可以点击界面中的“加载示例数据”使用 `public/samples` 里的示例。

## 常用命令

```bash
# 开发
npm run dev

# 类型检查并构建
npm run build

# 本地预览构建产物
npm run preview

# 导出 HUD 帧/视频
npm run export
```

## 数据格式

### 遥测 CSV

CSV 至少需要包含：

| 字段                       | 必填 | 说明                                               |
| -------------------------- | ---- | -------------------------------------------------- |
| `t`                      | 是   | 时间，单位秒                                       |
| `speed_kmh` 或 `speed` | 是   | 车速，单位 km/h                                    |
| `rpm`                    | 否   | 发动机转速                                         |
| `rpm_max`                | 否   | 转速表最大值                                       |
| `gear`                   | 否   | 档位，支持数字、`N`、`R`                       |
| `throttle`               | 否   | 油门，`0` 到 `1`                               |
| `brake`                  | 否   | 刹车，`0` 到 `1`                               |
| `abs`                    | 否   | ABS 状态，支持 `1/0`、`true/false`、`yes/no` |
| `tcs`                    | 否   | TCS 状态                                           |
| `progress`               | 否   | 赛道进度，`0` 到 `1`                           |
| `position_current`       | 否   | 当前名次                                           |
| `position_total`         | 否   | 总参赛车辆数                                       |

示例：

```csv
t,speed_kmh,rpm,rpm_max,gear,throttle,brake,abs,tcs,progress,position_current,position_total
0.00,55.00,1883,6000,2,0.30,0,0,0,0.0000,5,12
0.10,56.20,1940,6000,2,0.35,0,0,0,0.0010,5,12
```

### 遥测 JSON

可以传入数组，或包含 `samples` 字段的对象。字段支持 camelCase 和 snake_case 混用：

```json
{
  "samples": [
    {
      "t": 0,
      "speedKmh": 55,
      "rpm": 1883,
      "progress": 0,
      "positionCurrent": 5,
      "positionTotal": 12
    }
  ]
}
```

### 轨迹 GPX / GeoJSON

路线会被投影到本地平面坐标后用于小地图。

默认会把 GPX / GeoJSON 坐标当作 WGS-84。若轨迹来自国内地图或其他 GCJ-02 / BD-09 来源，可以在顶部工具栏的“高级设置”里把“原始坐标系”改为对应值。应用会在投影、小地图渲染、OSM 路网补全和道路吸附前统一转换到 WGS-84。

GeoJSON 图层可以通过 `properties.kind` 或 `properties.type` 指定：

- `driven`：实际行驶轨迹
- `planned`：计划路线
- `reference`：背景参考线

GPX route 会被识别为 `planned`；普通 track 默认作为 `driven`。

### GPX 路网补全

`scripts/enrich-gpx-with-osm.mjs` 可以从 GPX 轨迹范围下载 OpenStreetMap 路网，并输出适配小地图的 GeoJSON：

```bash
npm run enrich:gpx -- local/activity_256997965.gpx output
```

Web UI 中也可以先拖入 GPX，再点击顶部工具栏的“补全路网”按钮；应用会通过本地 Vite 开发服务器把补全结果保存到 `output/`，并立即加载带 `reference` 周边道路的小地图数据。

如果 GPX 来源不是 WGS-84，先在“高级设置”里选择正确的原始坐标系，再点击“补全路网”。命令行脚本也支持 `--coord`：

```bash
node scripts/enrich-gpx-with-osm.mjs local/activity.gpx output --coord=gcj02
```

输出文件：

- `*_enriched.geojson`：推荐加载到小地图；主轨迹为 `driven`，周边 OSM 道路为 `reference`
- `*_enriched.gpx`：保留 GPX 轨迹，并在点位扩展里写入最近 OSM 道路信息
- `*_enriched_points.csv`：每个轨迹点匹配到的最近 OSM 道路、距离和道路标签
- `*_osm_bbox.osm`：OSM bbox 缓存；再次运行默认复用，传 `--refresh-osm` 可重新下载

## OBD 日志转换

`scripts/convert-obd-log.mjs` 可以把 OBD recorder 的长格式 CSV 转成项目遥测 CSV。

输入格式预期类似：

```csv
SECONDS;PID;VALUE;UNITS
0.00;车速;55;km/h
0.02;发动机转速;1883;rpm
```

基本用法：

```bash
node scripts/convert-obd-log.mjs input.csv public/samples/telemetry.csv
```

固定输出采样率：

```bash
node scripts/convert-obd-log.mjs input.csv output.csv --rate=10
```

设置右上角名次：

```bash
node scripts/convert-obd-log.mjs input.csv output.csv --position-current=3 --position-total=12
```

未传名次参数时，默认输出 `10 / 12`。

> [!NOTE]
> 如果 OBD 日志里有总行驶距离字段，脚本会自动归一化生成 `progress`。否则 `progress` 会留空，小地图和进度条会依赖轨迹时间或默认值。

## 导出透明 HUD

导出脚本会用 Puppeteer 驱动浏览器逐帧截图，再用 FFmpeg 合成为视频。

先构建并启动预览服务：

```bash
npm run build
npm run preview
```

再执行导出：

```bash
node scripts/export-frames.mjs \
  --telemetry /samples/telemetry.csv \
  --track /samples/track.gpx \
  --duration 120 \
  --fps 60 \
  --width 1920 \
  --height 1080 \
  --coord wgs84 \
  --out out/hud.webm
```

输出格式：

- `.webm`：VP9 透明视频
- `.mov` / `.mp4`：ProRes 4444 透明视频
- 其他扩展名：保留 PNG 序列到 `out/frames`

> [!IMPORTANT]
> 导出 `.webm`、`.mov` 或 `.mp4` 需要本机安装 `ffmpeg`，并确保它在 `PATH` 中。

## URL 参数

应用支持通过 URL 参数加载数据，便于导出和自动化：

```text
/?telemetry=/samples/telemetry.csv&track=/samples/track.gpx&player=ANNA&unit=kmh&t=0
```

| 参数           | 说明                                             |
| -------------- | ------------------------------------------------ |
| `telemetry`  | 遥测文件 URL                                     |
| `track`      | GPX 或 GeoJSON 文件 URL                          |
| `player`     | 玩家名称                                         |
| `unit`       | `kmh` 或 `mph`                               |
| `coord`      | 轨迹原始坐标系：`wgs84`、`gcj02` 或 `bd09` |
| `t`          | 初始时间，单位秒                                 |
| `exporter=1` | 开启透明导出模式，隐藏控制栏                     |

## 布局编辑

点击顶部工具栏的“编辑布局”后，可以拖动 HUD 元素。

布局偏移会保存到浏览器 `localStorage`：

```text
hud5.layout.v1
```

布局预设会保存到浏览器 `localStorage`：

```text
hud5.presets.v1
```

高级 HUD 设置会保存到浏览器 `localStorage`：

```text
hud5.settings.v1
```

高级设置当前包括：

- 轨迹原始坐标系：`WGS-84`、`GCJ-02`、`BD-09`
- 路径吸附：是否把实际行驶点吸附到 `reference` 道路，以及最大吸附距离
- 小地图：可视半径、俯视角和道路线宽

如果布局错乱，可以点击“重置”恢复默认位置。

## 项目结构

```text
src/
  App.tsx                 # 应用外壳、文件加载、视频同步、工具栏和时间轴
  hud/                    # HUD 组件
    Hud.tsx
    Minimap.tsx
    Speedometer.tsx
    TopLeftStatus.tsx
    TopRightPosition.tsx
    Draggable.tsx
  data/                   # 遥测和轨迹解析
  playback/               # 播放状态、布局状态和 rAF 播放循环
  util/                   # 单位换算、坐标系转换、投影和导出 URL 工具
scripts/
  convert-obd-log.mjs     # OBD 长格式日志转换
  enrich-gpx-with-osm.mjs # GPX 路网补全和 OSM 匹配
  export-frames.mjs       # 透明 HUD 导出
  generate-sample.mjs     # 生成示例数据
public/samples/           # 示例 telemetry 和 track
design-ref/               # 视觉参考图
```
## 技术栈

- React 18
- TypeScript
- Vite
- Zustand
- Papa Parse
- `@tmcw/togeojson`
- Puppeteer
