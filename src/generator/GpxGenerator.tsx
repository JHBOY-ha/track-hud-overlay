import { useMemo, useRef, useState } from 'react';
import {
  buildHudGeoJson,
  buildTimedRoute,
  projectToRoad,
  type GeoPoint,
  type Road,
  type RouteMark,
} from './routeCore';

type BBox = { minLat: number; minLon: number; maxLat: number; maxLon: number };
type ScreenPoint = { x: number; y: number };
type MapView = { x: number; y: number; width: number; height: number };
type PanState = { pointerId: number; clientX: number; clientY: number; view: MapView; moved: boolean };

const VIEW_W = 1200;
const VIEW_H = 720;
const SAMPLE_HZ = 10;
const INITIAL_CENTER = { lat: 39.915, lon: 116.405 };

const fallbackRoads: Road[] = [
  road('r1', '北辰大道', 'primary', [[39.902,116.386],[39.908,116.394],[39.913,116.403],[39.919,116.413],[39.925,116.428]]),
  road('r2', '中轴路', 'secondary', [[39.927,116.399],[39.921,116.400],[39.913,116.403],[39.907,116.404],[39.901,116.406]]),
  road('r3', '松林路', 'secondary', [[39.905,116.385],[39.907,116.395],[39.907,116.404],[39.908,116.417],[39.909,116.431]]),
  road('r4', '湖畔东路', 'secondary', [[39.923,116.383],[39.920,116.391],[39.918,116.401],[39.917,116.411],[39.916,116.430]]),
  road('r5', '望云街', 'residential', [[39.900,116.416],[39.908,116.417],[39.917,116.411],[39.926,116.408]]),
  road('r6', '银杏路', 'residential', [[39.902,116.394],[39.910,116.392],[39.920,116.391],[39.928,116.390]]),
  road('r7', '环湖路', 'tertiary', [[39.913,116.403],[39.917,116.411],[39.914,116.416],[39.908,116.417],[39.907,116.404],[39.913,116.403]]),
  road('r8', '山前路', 'tertiary', [[39.928,116.390],[39.925,116.400],[39.926,116.408],[39.925,116.428]]),
];

function road(id: string, name: string, highway: string, coords: number[][]): Road {
  return {
    id, name, highway,
    points: coords.map(([lat, lon]) => ({ lat, lon, nodeId: `${lat.toFixed(6)},${lon.toFixed(6)}` })),
  };
}

function bboxFor(center: GeoPoint, radiusM: number): BBox {
  const latDelta = radiusM / 110540;
  const lonDelta = radiusM / (111320 * Math.cos(center.lat * Math.PI / 180));
  return { minLat: center.lat - latDelta, minLon: center.lon - lonDelta, maxLat: center.lat + latDelta, maxLon: center.lon + lonDelta };
}

function project(point: GeoPoint, bbox: BBox): ScreenPoint {
  return {
    x: ((point.lon - bbox.minLon) / (bbox.maxLon - bbox.minLon)) * VIEW_W,
    y: VIEW_H - ((point.lat - bbox.minLat) / (bbox.maxLat - bbox.minLat)) * VIEW_H,
  };
}

function unproject(point: ScreenPoint, bbox: BBox): GeoPoint {
  return {
    lon: bbox.minLon + (point.x / VIEW_W) * (bbox.maxLon - bbox.minLon),
    lat: bbox.minLat + ((VIEW_H - point.y) / VIEW_H) * (bbox.maxLat - bbox.minLat),
  };
}

function dayStartMs() {
  const date = new Date();
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function formatClock(ms: number, seconds = true) {
  const date = new Date(ms);
  const value = date.toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit', second: seconds ? '2-digit' : undefined });
  return value === '24:00:00' ? '00:00:00' : value;
}

function toLocalInput(ms: number) {
  const date = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function Icon({ name }: { name: 'pin' | 'undo' | 'download' | 'route' | 'trash' | 'clock' | 'target' }) {
  const paths = {
    pin: <><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.4"/></>,
    undo: <><path d="m9 7-5 5 5 5"/><path d="M20 17a8 8 0 0 0-11-7l-5 2"/></>,
    download: <><path d="M12 3v12m0 0 5-5m-5 5-5-5"/><path d="M5 20h14"/></>,
    route: <><circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><path d="M8 18h3a3 3 0 0 0 3-3v-6a3 3 0 0 1 3-3h-1"/></>,
    trash: <><path d="M4 7h16M10 11v5m4-5v5M6 7l1 14h10l1-14M9 7V4h6v3"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    target: <><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3"/></>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

export function GpxGenerator() {
  const startOfDay = useMemo(dayStartMs, []);
  const [center, setCenter] = useState(INITIAL_CENTER);
  const [centerDraft, setCenterDraft] = useState(INITIAL_CENTER);
  const [radiusM, setRadiusM] = useState(1000);
  const [roads, setRoads] = useState(fallbackRoads);
  const [marks, setMarks] = useState<RouteMark[]>([]);
  const [cursorMs, setCursorMs] = useState(startOfDay + 8 * 3600000);
  const [selectedMarkId, setSelectedMarkId] = useState<number | null>(null);
  const [zoomHours, setZoomHours] = useState(24);
  const [windowStartHour, setWindowStartHour] = useState(0);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('输入中心坐标和半径，获取周边路网');
  const [nextId, setNextId] = useState(1);
  const [mapView, setMapView] = useState<MapView>({ x: 0, y: 0, width: VIEW_W, height: VIEW_H });
  const panRef = useRef<PanState | null>(null);
  const bbox = bboxFor(center, radiusM);
  const orderedMarks = [...marks].sort((a, b) => a.timeMs - b.timeMs);
  const hasDuplicateTimes = orderedMarks.some((mark, i) => i > 0 && mark.timeMs <= orderedMarks[i - 1].timeMs);
  const route = useMemo(() => buildTimedRoute(roads, orderedMarks, SAMPLE_HZ), [roads, orderedMarks]);
  const canExport = route.samples.length > 1 && route.disconnectedPair === null && !hasDuplicateTimes;
  const windowStartMs = startOfDay + windowStartHour * 3600000;
  const windowEndMs = windowStartMs + zoomHours * 3600000;

  const loadRoads = async () => {
    const lat = Number(centerDraft.lat), lon = Number(centerDraft.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || radiusM < 100 || radiusM > 5000) {
      setStatus('请输入有效经纬度，半径范围为 100–5000 米');
      return;
    }
    setLoading(true);
    setStatus('正在从 OpenStreetMap 获取路网…');
    try {
      const params = new URLSearchParams({ lat: String(lat), lon: String(lon), radiusM: String(radiusM) });
      const response = await fetch(`/api/road-network?${params}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '路网请求失败');
      if (!data.roads?.length) throw new Error('指定范围内没有道路');
      setCenter({ lat, lon });
      setRoads(data.roads);
      setMarks([]);
      setMapView({ x: 0, y: 0, width: VIEW_W, height: VIEW_H });
      setStatus(`已载入 ${data.roads.length} 条道路。先选择时间，再点击道路打标`);
    } catch (error) {
      setStatus(`路网获取失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setLoading(false);
    }
  };

  const svgPointAt = (svg: SVGSVGElement, clientX: number, clientY: number): ScreenPoint => {
    const matrix = svg.getScreenCTM();
    if (!matrix) return { x: 0, y: 0 };
    const point = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
    return { x: point.x, y: point.y };
  };

  const addOrRelocateMark = (screen: ScreenPoint) => {
    const projection = projectToRoad(unproject(screen, bbox), roads);
    if (!projection) return;
    if (selectedMarkId !== null) {
      setMarks(current => current.map(mark => mark.id === selectedMarkId ? { ...mark, ...projection } : mark));
      setSelectedMarkId(null);
      setStatus('标记位置已更新');
      return;
    }
    setMarks(current => [...current, { id: nextId, timeMs: cursorMs, ...projection }]);
    setNextId(id => id + 1);
    setStatus(`已在 ${formatClock(cursorMs)} 添加道路标记`);
  };

  const clampView = (view: MapView): MapView => {
    const overscanX = view.width * 0.35;
    const overscanY = view.height * 0.35;
    return {
      ...view,
      x: Math.max(-overscanX, Math.min(VIEW_W - view.width + overscanX, view.x)),
      y: Math.max(-overscanY, Math.min(VIEW_H - view.height + overscanY, view.y)),
    };
  };

  const onMapPointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    panRef.current = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, view: mapView, moved: false };
  };

  const onMapPointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const pan = panRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const dx = event.clientX - pan.clientX;
    const dy = event.clientY - pan.clientY;
    if (Math.hypot(dx, dy) > 4) pan.moved = true;
    if (!pan.moved) return;
    setMapView(clampView({
      ...pan.view,
      x: pan.view.x - dx * (pan.view.width / rect.width),
      y: pan.view.y - dy * (pan.view.height / rect.height),
    }));
  };

  const onMapPointerUp = (event: React.PointerEvent<SVGSVGElement>) => {
    const pan = panRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    if (!pan.moved) addOrRelocateMark(svgPointAt(event.currentTarget, event.clientX, event.clientY));
    panRef.current = null;
  };

  const onMapWheel = (event: React.WheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    const cursor = svgPointAt(event.currentTarget, event.clientX, event.clientY);
    const factor = event.deltaY < 0 ? 0.82 : 1.22;
    const width = Math.max(VIEW_W / 16, Math.min(VIEW_W * 1.5, mapView.width * factor));
    const height = width * (VIEW_H / VIEW_W);
    const fx = (cursor.x - mapView.x) / mapView.width;
    const fy = (cursor.y - mapView.y) / mapView.height;
    setMapView(clampView({ x: cursor.x - fx * width, y: cursor.y - fy * height, width, height }));
  };

  const zoomMap = (factor: number) => {
    const centerX = mapView.x + mapView.width / 2;
    const centerY = mapView.y + mapView.height / 2;
    const width = Math.max(VIEW_W / 16, Math.min(VIEW_W * 1.5, mapView.width * factor));
    const height = width * (VIEW_H / VIEW_W);
    setMapView(clampView({ x: centerX - width / 2, y: centerY - height / 2, width, height }));
  };

  const exportGeoJson = () => {
    if (!canExport) return;
    const geoJson = buildHudGeoJson(roads, route, center, radiusM, SAMPLE_HZ);
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([JSON.stringify(geoJson, null, 2)], { type: 'application/geo+json' }));
    link.download = `hud-route-${new Date().toISOString().slice(0, 10)}.geojson`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const timelinePosition = (timeMs: number) => ((timeMs - windowStartMs) / (windowEndMs - windowStartMs)) * 100;
  const maxWindowStart = Math.max(0, 24 - zoomHours);
  const durationMs = orderedMarks.length > 1 ? orderedMarks[orderedMarks.length - 1].timeMs - orderedMarks[0].timeMs : 0;

  return (
    <main className="gpx-app">
      <header className="gpx-header">
        <div className="brand"><div className="brand-mark"><Icon name="route" /></div><div><strong>HUD ROUTE LAB</strong><span>路网时间轨迹生成器</span></div></div>
        <div className="coordinate-form">
          <label><span>纬度</span><input aria-label="中心纬度" type="number" step=".000001" value={centerDraft.lat} onChange={e => setCenterDraft(v => ({ ...v, lat: Number(e.target.value) }))}/></label>
          <label><span>经度</span><input aria-label="中心经度" type="number" step=".000001" value={centerDraft.lon} onChange={e => setCenterDraft(v => ({ ...v, lon: Number(e.target.value) }))}/></label>
          <label><span>半径 m</span><input aria-label="路网半径" type="number" min="100" max="5000" step="100" value={radiusM} onChange={e => setRadiusM(Number(e.target.value))}/></label>
          <button onClick={loadRoads} disabled={loading}><Icon name="target"/>{loading ? '获取中…' : '获取路网'}</button>
        </div>
        <a className="text-button" href="http://127.0.0.1:5173/">打开 HUD</a>
        <button className="export-button" onClick={exportGeoJson} disabled={!canExport}><Icon name="download" />导出 GeoJSON</button>
      </header>

      <section className="workspace">
        <aside className="tool-rail" aria-label="地图工具">
          <button className="active"><Icon name="pin"/><span>打标</span></button>
          <button onClick={() => setMarks(v => v.slice(0, -1))} disabled={!marks.length}><Icon name="undo"/><span>撤销</span></button>
          <button onClick={() => setMarks([])} disabled={!marks.length}><Icon name="trash"/><span>清空</span></button>
          <div className="tool-separator"/>
          <button onClick={() => zoomMap(.7)}><span className="zoom-symbol">+</span><span>放大</span></button>
          <button onClick={() => zoomMap(1.4)}><span className="zoom-symbol">−</span><span>缩小</span></button>
          <button onClick={() => setMapView({x:0,y:0,width:VIEW_W,height:VIEW_H})}><Icon name="target"/><span>复位</span></button>
        </aside>

        <div className="map-shell">
          <svg
            className={`route-map route ${panRef.current?.moved ? 'panning' : ''}`}
            viewBox={`${mapView.x} ${mapView.y} ${mapView.width} ${mapView.height}`}
            onPointerDown={onMapPointerDown}
            onPointerMove={onMapPointerMove}
            onPointerUp={onMapPointerUp}
            onPointerCancel={() => { panRef.current = null; }}
            onWheel={onMapWheel}
          >
            <defs><pattern id="grid" width="48" height="48" patternUnits="userSpaceOnUse"><path d="M48 0H0V48" fill="none" stroke="rgba(255,255,255,.035)" /></pattern><filter id="glow"><feGaussianBlur stdDeviation="5" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
            <rect width={VIEW_W} height={VIEW_H} fill="#08100f"/><rect width={VIEW_W} height={VIEW_H} fill="url(#grid)"/>
            {roads.map(road => <polyline key={road.id} className={`road road-${road.highway}`} points={road.points.map(point => { const p=project(point,bbox); return `${p.x},${p.y}`; }).join(' ')}/>)}
            {route.path.length > 1 && <><polyline className="route-glow" points={route.path.map(point => { const p=project(point,bbox); return `${p.x},${p.y}`; }).join(' ')}/><polyline className="route-line" points={route.path.map(point => { const p=project(point,bbox); return `${p.x},${p.y}`; }).join(' ')}/></>}
            {orderedMarks.map((mark,index) => { const p=project(mark.point,bbox); return <g className={`time-pin ${selectedMarkId===mark.id?'selected':''}`} key={mark.id} transform={`translate(${p.x} ${p.y})`}><circle r="10"/><path d="M0 10L-5 19H5Z"/><text x="15" y="4">T{index+1}</text></g>; })}
            <g className="center-cross" transform={`translate(${project(center,bbox).x} ${project(center,bbox).y})`}><circle r="8"/><path d="M-14 0H14M0-14V14"/></g>
          </svg>
          <div className="map-topline"><span>OSM / WGS 84</span><span>{center.lat.toFixed(6)}, {center.lon.toFixed(6)} · R {radiusM}m</span></div>
          <div className="map-help">拖动平移 · 滚轮缩放 · 单击道路打标</div>
          <div className="map-legend"><span><i className="legend-road"/>参考路网</span><span><i className="legend-route"/>完整路线</span><span><i className="legend-time"/>时间标记</span></div>
          {loading && <div className="loading-card"><div className="loader"/><strong>正在解析路网</strong><span>读取道路节点与连接关系</span></div>}
        </div>

        <aside className="side-panel">
          <div className="panel-heading"><div><span>HUD ROUTE DATA</span><h1>路线状态</h1></div><b>{orderedMarks.length} 个标记</b></div>
          <div className="status-line">{status}</div>
          <div className="stats">
            <div><span>完整路线</span><strong>{route.lengthM >= 1000 ? `${(route.lengthM/1000).toFixed(2)} km` : `${Math.round(route.lengthM)} m`}</strong></div>
            <div><span>持续时间</span><strong>{durationMs ? `${(durationMs/1000).toFixed(1)} s` : '—'}</strong></div>
            <div><span>10 Hz 点数</span><strong>{route.samples.length}</strong></div>
            <div><span>连接状态</span><strong className={route.disconnectedPair === null ? 'ok' : 'bad'}>{route.disconnectedPair === null ? '可导出' : `T${route.disconnectedPair+1} 断开`}</strong></div>
          </div>
          <div className="section-title"><div><Icon name="clock"/><span>时间标记</span></div></div>
          <div className="marks">
            {orderedMarks.length === 0 && <div className="empty-state">在底部时间轴选择时间，然后点击道路添加标记。</div>}
            {orderedMarks.map((mark,index) => (
              <article className={`mark-card ${selectedMarkId===mark.id?'selected':''}`} key={mark.id}>
                <div className="mark-index">T{index+1}</div>
                <div className="mark-fields">
                  <label><span>经过时间</span><input aria-label={`时间点 ${index+1} 经过时间`} type="datetime-local" step=".1" value={toLocalInput(mark.timeMs)} onChange={e => setMarks(v => v.map(m => m.id===mark.id ? {...m,timeMs:new Date(e.target.value).getTime()} : m))}/></label>
                  <div className="road-name">{roads.find(road => road.id === mark.roadId)?.name ?? mark.roadId}</div>
                  <button className="relocate" onClick={() => setSelectedMarkId(mark.id)}>{selectedMarkId===mark.id?'请点击道路…':'重新定位'}</button>
                </div>
                <button className="remove-mark" onClick={() => setMarks(v=>v.filter(m=>m.id!==mark.id))} aria-label={`删除时间点 ${index+1}`}>×</button>
              </article>
            ))}
          </div>
          {(hasDuplicateTimes || route.disconnectedPair !== null) && <div className="error-card">{hasDuplicateTimes ? '时间标记必须严格递增且不能重复。' : '相邻标记不在同一连通路网中，请重新定位。'}</div>}
          <button className="side-export" onClick={exportGeoJson} disabled={!canExport}><Icon name="download"/><span><strong>导出 HUD GeoJSON</strong><small>包含 driven 路线、逐点时间、进度与 reference 路网</small></span></button>
        </aside>
      </section>

      <section className="timeline-panel">
        <div className="timeline-toolbar">
          <div><span>CURRENT TIME</span><strong>{formatClock(cursorMs)}</strong></div>
          <label>缩放<select value={zoomHours} onChange={e => { const next=Number(e.target.value); setZoomHours(next); setWindowStartHour(v=>Math.min(v,24-next)); }}><option value="24">24 小时</option><option value="12">12 小时</option><option value="6">6 小时</option><option value="3">3 小时</option><option value="1">1 小时</option></select></label>
          <label className="pan-control">视窗起点<input aria-label="时间轴视窗起点" type="range" min="0" max={maxWindowStart} step=".25" value={windowStartHour} disabled={!maxWindowStart} onChange={e=>setWindowStartHour(Number(e.target.value))}/></label>
        </div>
        <div className="timeline-track">
          {Array.from({length: Math.max(2, Math.round(zoomHours)+1)},(_,i)=><span className="timeline-tick" key={i} style={{left:`${(i/Math.round(zoomHours))*100}%`}}><i/><b>{formatClock(windowStartMs+i*3600000,false)}</b></span>)}
          {orderedMarks.filter(mark=>mark.timeMs>=windowStartMs&&mark.timeMs<=windowEndMs).map((mark,index)=><button key={mark.id} className="timeline-mark" style={{left:`${timelinePosition(mark.timeMs)}%`}} onClick={()=>setCursorMs(mark.timeMs)} title={`T${index+1} ${formatClock(mark.timeMs)}`}><span>T{index+1}</span></button>)}
          <div className="timeline-cursor" style={{left:`${Math.max(0,Math.min(100,timelinePosition(cursorMs)))}%`}}/>
          <input aria-label="当前时间" type="range" min={windowStartMs} max={windowEndMs} step="100" value={Math.max(windowStartMs,Math.min(windowEndMs,cursorMs))} onChange={e=>setCursorMs(Number(e.target.value))}/>
        </div>
      </section>
    </main>
  );
}
