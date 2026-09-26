/**
 * Custom lightweight-charts v5 primitives for drawing SMC zones on the chart.
 * Uses ISeriesPrimitive with IPrimitivePaneView + IPrimitivePaneRenderer.
 */
import {
  ISeriesPrimitive,
  ISeriesApi,
  SeriesType,
  Time,
  IPrimitivePaneView,
  IPrimitivePaneRenderer,
  IChartApi,
} from 'lightweight-charts';

// ─── Shared types ────────────────────────────────────────────

interface BoxZone {
  startTime: Time;
  endTime: Time;
  high: number;
  low: number;
  fillColor: string;
  borderColor: string;
  borderStyle?: 'solid' | 'dashed';
  label?: string;
  labelColor?: string;
}

interface LabeledLine {
  price: number;
  time: Time;
  endTime?: Time;
  color: string;
  lineStyle?: 'solid' | 'dashed' | 'dotted';
  lineWidth?: number;
  label: string;
  labelColor?: string;
  labelBg?: string;
}

// ─── Box Zone Renderer ──────────────────────────────────────

class BoxZoneRenderer implements IPrimitivePaneRenderer {
  private _zones: {
    x1: number; x2: number; y1: number; y2: number;
    fillColor: string; borderColor: string; borderStyle: string;
    label?: string; labelColor?: string;
  }[] = [];

  update(zones: typeof this._zones) {
    this._zones = zones;
  }

  draw(target: any) {
    target.useBitmapCoordinateSpace((scope: any) => {
      const ctx = scope.context;
      const ratio = scope.horizontalPixelRatio;
      const vRatio = scope.verticalPixelRatio;

      for (const zone of this._zones) {
        const x1 = Math.round(zone.x1 * ratio);
        const x2 = Math.round(zone.x2 * ratio);
        const y1 = Math.round(zone.y1 * vRatio);
        const y2 = Math.round(zone.y2 * vRatio);

        // Fill
        ctx.fillStyle = zone.fillColor;
        ctx.fillRect(x1, y1, x2 - x1, y2 - y1);

        // Border
        ctx.strokeStyle = zone.borderColor;
        ctx.lineWidth = 1.5 * ratio;
        if (zone.borderStyle === 'dashed') {
          ctx.setLineDash([6 * ratio, 4 * ratio]);
        } else {
          ctx.setLineDash([]);
        }
        ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
        ctx.setLineDash([]);

        // Label
        if (zone.label) {
          const fontSize = Math.round(11 * ratio);
          ctx.font = `bold ${fontSize}px sans-serif`;
          ctx.fillStyle = zone.labelColor || zone.borderColor;
          const textWidth = ctx.measureText(zone.label).width;
          const padding = 4 * ratio;
          const labelX = x1 + padding;
          const labelY = y1 + fontSize + padding;

          // Label background
          ctx.fillStyle = 'rgba(0,0,0,0.6)';
          ctx.fillRect(labelX - 2 * ratio, y1 + 2 * ratio, textWidth + 6 * ratio, fontSize + 4 * ratio);
          ctx.fillStyle = zone.labelColor || '#ffffff';
          ctx.fillText(zone.label, labelX, labelY);
        }
      }
    });
  }
}

// ─── Labeled Line Renderer ──────────────────────────────────

class LabeledLineRenderer implements IPrimitivePaneRenderer {
  private _lines: {
    x1: number; x2: number; y: number;
    color: string; lineStyle: string; lineWidth: number;
    label: string; labelColor: string; labelBg: string;
  }[] = [];

  update(lines: typeof this._lines) {
    this._lines = lines;
  }

  draw(target: any) {
    target.useBitmapCoordinateSpace((scope: any) => {
      const ctx = scope.context;
      const ratio = scope.horizontalPixelRatio;
      const vRatio = scope.verticalPixelRatio;

      for (const line of this._lines) {
        const x1 = Math.round(line.x1 * ratio);
        const x2 = Math.round(line.x2 * ratio);
        const y = Math.round(line.y * vRatio);

        ctx.strokeStyle = line.color;
        ctx.lineWidth = (line.lineWidth || 1) * ratio;

        if (line.lineStyle === 'dashed') {
          ctx.setLineDash([8 * ratio, 4 * ratio]);
        } else if (line.lineStyle === 'dotted') {
          ctx.setLineDash([2 * ratio, 3 * ratio]);
        } else {
          ctx.setLineDash([]);
        }

        ctx.beginPath();
        ctx.moveTo(x1, y);
        ctx.lineTo(x2, y);
        ctx.stroke();
        ctx.setLineDash([]);

        // Label
        if (line.label) {
          const fontSize = Math.round(10 * ratio);
          ctx.font = `bold ${fontSize}px sans-serif`;
          const textWidth = ctx.measureText(line.label).width;
          const padding = 3 * ratio;
          const labelX = x1 + padding;
          const labelY = y - 4 * vRatio;

          ctx.fillStyle = line.labelBg || 'rgba(0,0,0,0.7)';
          ctx.fillRect(labelX - padding, labelY - fontSize - padding, textWidth + padding * 3, fontSize + padding * 2);
          ctx.fillStyle = line.labelColor || line.color;
          ctx.fillText(line.label, labelX, labelY);
        }
      }
    });
  }
}

// ─── Box Zone Primitive ─────────────────────────────────────

class BoxZonePaneView implements IPrimitivePaneView {
  private _renderer = new BoxZoneRenderer();
  private _zones: BoxZone[] = [];
  private _series: ISeriesApi<SeriesType>;
  private _chart: IChartApi;

  constructor(series: ISeriesApi<SeriesType>, chart: IChartApi) {
    this._series = series;
    this._chart = chart;
  }

  setZones(zones: BoxZone[]) {
    this._zones = zones;
  }

  zOrder(): 'bottom' {
    return 'bottom';
  }

  renderer() {
    const ts = this._chart.timeScale();
    const mapped = this._zones
      .map((zone) => {
        const x1 = ts.timeToCoordinate(zone.startTime);
        const x2 = ts.timeToCoordinate(zone.endTime);
        const y1 = this._series.priceToCoordinate(zone.high);
        const y2 = this._series.priceToCoordinate(zone.low);
        if (x1 === null || x2 === null || y1 === null || y2 === null) return null;
        return {
          x1, x2, y1, y2,
          fillColor: zone.fillColor,
          borderColor: zone.borderColor,
          borderStyle: zone.borderStyle || 'solid',
          label: zone.label,
          labelColor: zone.labelColor,
        };
      })
      .filter(Boolean) as any[];
    this._renderer.update(mapped);
    return this._renderer;
  }
}

export class SMCBoxPrimitive implements ISeriesPrimitive<Time> {
  private _paneView: BoxZonePaneView;

  constructor(series: ISeriesApi<SeriesType>, chart: IChartApi) {
    this._paneView = new BoxZonePaneView(series, chart);
  }

  setZones(zones: BoxZone[]) {
    this._paneView.setZones(zones);
  }

  paneViews() {
    return [this._paneView];
  }
}

// ─── Labeled Line Primitive ─────────────────────────────────

class LabeledLinePaneView implements IPrimitivePaneView {
  private _renderer = new LabeledLineRenderer();
  private _lines: LabeledLine[] = [];
  private _series: ISeriesApi<SeriesType>;
  private _chart: IChartApi;

  constructor(series: ISeriesApi<SeriesType>, chart: IChartApi) {
    this._series = series;
    this._chart = chart;
  }

  setLines(lines: LabeledLine[]) {
    this._lines = lines;
  }

  zOrder(): 'top' {
    return 'top';
  }

  renderer() {
    const ts = this._chart.timeScale();
    const visibleRange = ts.getVisibleLogicalRange();
    const chartWidth = (this._chart as any).options?.().width || 800;

    const mapped = this._lines
      .map((line) => {
        const x1 = ts.timeToCoordinate(line.time);
        const x2 = line.endTime ? ts.timeToCoordinate(line.endTime) : null;
        const y = this._series.priceToCoordinate(line.price);
        if (x1 === null || y === null) return null;
        return {
          x1,
          x2: x2 ?? (x1 + chartWidth * 0.6),
          y,
          color: line.color,
          lineStyle: line.lineStyle || 'solid',
          lineWidth: line.lineWidth || 1.5,
          label: line.label,
          labelColor: line.labelColor || line.color,
          labelBg: line.labelBg || 'rgba(0,0,0,0.7)',
        };
      })
      .filter(Boolean) as any[];
    this._renderer.update(mapped);
    return this._renderer;
  }
}

export class SMCLinePrimitive implements ISeriesPrimitive<Time> {
  private _paneView: LabeledLinePaneView;

  constructor(series: ISeriesApi<SeriesType>, chart: IChartApi) {
    this._paneView = new LabeledLinePaneView(series, chart);
  }

  setLines(lines: LabeledLine[]) {
    this._paneView.setLines(lines);
  }

  paneViews() {
    return [this._paneView];
  }
}

// ─── Helper: Build zones from analysis data ─────────────────

export interface SMCChartData {
  orderBlocks: { type: 'bullish' | 'bearish'; high: number; low: number; epoch: number; strength: string; mitigated: boolean; timeframe?: string }[];
  fairValueGaps: { type: 'bullish' | 'bearish'; high: number; low: number; epoch: number; timeframe?: string }[];
  swingPoints: { price: number; epoch: number; type: 'high' | 'low' }[];
  choch: { direction: 'bullish' | 'bearish'; price: number; epoch: number; timeframe?: string }[];
  bos: { direction: 'bullish' | 'bearish'; price: number; epoch: number; timeframe?: string }[];
  liquidityZones: { price: number; type: 'buy_stops' | 'sell_stops'; swept: boolean }[];
  lastCandleEpoch: number;
}

export function buildBoxZones(data: SMCChartData): BoxZone[] {
  const zones: BoxZone[] = [];
  const extendTime = data.lastCandleEpoch as Time;

  // Order Blocks — colored rectangles
  for (const ob of data.orderBlocks) {
    if (ob.mitigated) continue;
    const isBull = ob.type === 'bullish';
    const tf = ob.timeframe || '4H';
    zones.push({
      startTime: ob.epoch as Time,
      endTime: extendTime,
      high: ob.high,
      low: ob.low,
      fillColor: isBull ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)',
      borderColor: isBull ? 'rgba(34, 197, 94, 0.7)' : 'rgba(239, 68, 68, 0.7)',
      borderStyle: 'dashed',
      label: `OB ${isBull ? '▲' : '▼'} [${tf}]`,
      labelColor: isBull ? '#22c55e' : '#ef4444',
    });
  }

  // FVGs — semi-transparent filled zones
  for (const fvg of data.fairValueGaps) {
    const isBull = fvg.type === 'bullish';
    const tf = fvg.timeframe || '4H';
    zones.push({
      startTime: fvg.epoch as Time,
      endTime: extendTime,
      high: fvg.high,
      low: fvg.low,
      fillColor: isBull ? 'rgba(59, 130, 246, 0.12)' : 'rgba(168, 85, 247, 0.12)',
      borderColor: isBull ? 'rgba(59, 130, 246, 0.5)' : 'rgba(168, 85, 247, 0.5)',
      borderStyle: 'dashed',
      label: `FVG [${tf}]`,
      labelColor: isBull ? '#3b82f6' : '#a855f7',
    });
  }

  return zones;
}

export function buildLabeledLines(data: SMCChartData): LabeledLine[] {
  const lines: LabeledLine[] = [];

  // CHoCH lines
  for (const c of data.choch) {
    lines.push({
      price: c.price,
      time: c.epoch as Time,
      color: '#f59e0b',
      lineStyle: 'dashed',
      lineWidth: 2,
      label: `CHoCH [${c.timeframe || '4H'}]`,
      labelColor: '#fbbf24',
      labelBg: 'rgba(120, 80, 0, 0.8)',
    });
  }

  // BOS lines
  for (const b of data.bos) {
    const isBull = b.direction === 'bullish';
    lines.push({
      price: b.price,
      time: b.epoch as Time,
      color: isBull ? '#22c55e' : '#ef4444',
      lineStyle: 'dashed',
      lineWidth: 2,
      label: `BOS [${b.timeframe || '4H'}]`,
      labelColor: isBull ? '#22c55e' : '#ef4444',
      labelBg: isBull ? 'rgba(0, 80, 30, 0.8)' : 'rgba(100, 0, 0, 0.8)',
    });
  }

  // Liquidity zones as dotted lines
  for (const lz of data.liquidityZones) {
    const isBuyStops = lz.type === 'buy_stops';
    lines.push({
      price: lz.price,
      time: data.swingPoints[0]?.epoch as Time ?? (data.lastCandleEpoch - 200 * 14400) as Time,
      endTime: data.lastCandleEpoch as Time,
      color: isBuyStops ? 'rgba(255, 165, 0, 0.6)' : 'rgba(0, 200, 200, 0.6)',
      lineStyle: 'dotted',
      lineWidth: 1.5,
      label: isBuyStops ? 'Buy side liquidity' : 'Sell side liquidity',
      labelColor: isBuyStops ? '#ffa500' : '#00c8c8',
      labelBg: 'rgba(0,0,0,0.6)',
    });
  }

  return lines;
}
