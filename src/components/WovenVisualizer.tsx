import React, { useRef, useEffect, useState } from "react";
import { YarnColor, ImageParams, TechSpecs, GridNudge } from "../types";
import { snapToPalette, hexToRgb } from "../utils/color";
import { ZoomIn, ZoomOut, Move, Grid, Check, Download, Info } from "lucide-react";

interface WovenVisualizerProps {
  imageElement: HTMLImageElement | null;
  params: ImageParams;
  specs: TechSpecs;
  nudge: GridNudge;
  palette: YarnColor[];
  showGridLines: boolean;
  lurexThreshold: number;
  onReferenceGenerated: (canvas1x1: HTMLCanvasElement | null) => void;
  syncCursor: { col: number; row: number } | null;
  setSyncCursor: (pos: { col: number; row: number } | null) => void;
}

export const WovenVisualizer: React.FC<WovenVisualizerProps> = ({
  imageElement,
  params,
  specs,
  nudge,
  palette,
  showGridLines,
  lurexThreshold,
  onReferenceGenerated,
  syncCursor,
  setSyncCursor,
}) => {
  const sourceCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const refCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Layout calculations
  const warpCells = Math.max(1, Math.round((specs.widthMm / 10) * specs.warpDensity));
  const weftPicks = Math.max(1, Math.round((specs.heightMm / 10) * specs.weftDensity));

  // Zooming and Panning state
  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState<boolean>(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [hoveredCell, setHoveredCell] = useState<{ col: number; row: number; colorHex: string; colorName: string } | null>(null);

  // Hidden 1x1 cell-mapping canvas for export
  const hiddenCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Keep track of the processed cell colors to provide instant cursor lookup
  const [gridColorMap, setGridColorMap] = useState<string[][]>([]);

  // Draw and process pipeline
  useEffect(() => {
    if (!imageElement || !sourceCanvasRef.current || !refCanvasRef.current) return;

    const srcCanvas = sourceCanvasRef.current;
    const refCanvas = refCanvasRef.current;
    const srcCtx = srcCanvas.getContext("2d");
    const refCtx = refCanvas.getContext("2d");

    if (!srcCtx || !refCtx) return;

    // 1. Setup Source canvas size based on original image but constrained to reasonable desktop bounds
    const maxDimension = 800;
    let viewW = imageElement.naturalWidth;
    let viewH = imageElement.naturalHeight;

    if (viewW > maxDimension || viewH > maxDimension) {
      const ratio = Math.min(maxDimension / viewW, maxDimension / viewH);
      viewW = Math.round(viewW * ratio);
      viewH = Math.round(viewH * ratio);
    }

    srcCanvas.width = viewW;
    srcCanvas.height = viewH;

    // Render rotated and cropped scan into source canvas
    srcCtx.clearRect(0, 0, viewW, viewH);
    srcCtx.save();
    srcCtx.translate(viewW / 2, viewH / 2);
    srcCtx.rotate((params.rotation * Math.PI) / 180);
    srcCtx.drawImage(imageElement, -viewW / 2, -viewH / 2, viewW, viewH);
    srcCtx.restore();

    // Apply brightness, contrast & denoise filters to the raw image pixels
    const imgData = srcCtx.getImageData(0, 0, viewW, viewH);
    const d = imgData.data;

    // A. Brightness and Contrast
    const bValue = params.brightness;
    const cValue = params.contrast;
    const factor = (259 * (cValue + 255)) / (255 * (259 - cValue));

    for (let i = 0; i < d.length; i += 4) {
      let r = d[i] + bValue;
      let g = d[i + 1] + bValue;
      let b = d[i + 2] + bValue;

      r = factor * (r - 128) + 128;
      g = factor * (g - 128) + 128;
      b = factor * (b - 128) + 128;

      d[i] = Math.max(0, Math.min(255, r));
      d[i + 1] = Math.max(0, Math.min(255, g));
      d[i + 2] = Math.max(0, Math.min(255, b));
    }

    // B. Noise Reduction (Simple Edge-preserving Box Blur/Filter based on Denoise factor)
    if (params.denoise > 0) {
      const dCopy = new Uint8ClampedArray(d);
      const radius = Math.min(4, Math.floor(params.denoise));
      const w = viewW;
      const h = viewH;

      for (let y = radius; y < h - radius; y++) {
        for (let x = radius; x < w - radius; x++) {
          let rSum = 0, gSum = 0, bSum = 0, count = 0;
          for (let ky = -radius; ky <= radius; ky++) {
            for (let kx = -radius; kx <= radius; kx++) {
              const idx = ((y + ky) * w + (x + kx)) * 4;
              rSum += dCopy[idx];
              gSum += dCopy[idx + 1];
              bSum += dCopy[idx + 2];
              count++;
            }
          }
          const destIdx = (y * w + x) * 4;
          d[destIdx] = Math.round(rSum / count);
          d[destIdx + 1] = Math.round(gSum / count);
          d[destIdx + 2] = Math.round(bSum / count);
        }
      }
    }

    srcCtx.putImageData(imgData, 0, 0);

    // 2. Map grid cells over the image and perform Color Snapping to Palette
    const gridOffsetX = nudge.offsetX;
    const gridOffsetY = nudge.offsetY;
    const gridScaleX = nudge.scaleX;
    const gridScaleY = nudge.scaleY;

    // Grid boundary bounds relative to source canvas
    const startX = (viewW - viewW * gridScaleX) / 2 + gridOffsetX;
    const startY = (viewH - viewH * gridScaleY) / 2 + gridOffsetY;
    const gridW = viewW * gridScaleX;
    const gridH = viewH * gridScaleY;

    const cellW = gridW / warpCells;
    const cellH = gridH / weftPicks;

    // Create 1x1 master reference image representation
    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = warpCells;
    exportCanvas.height = weftPicks;
    const expCtx = exportCanvas.getContext("2d");
    if (!expCtx) return;

    const refGridColorMap: string[][] = Array(weftPicks)
      .fill(null)
      .map(() => Array(warpCells).fill("#ffffff"));

    // Extract average colors per cell and snap to palette
    for (let r = 0; r < weftPicks; r++) {
      for (let c = 0; c < warpCells; c++) {
        const cellX1 = startX + c * cellW;
        const cellY1 = startY + r * cellH;
        const cellX2 = startX + (c + 1) * cellW;
        const cellY2 = startY + (r + 1) * cellH;

        // Sampling pixel average in that rectangle
        let rSum = 0, gSum = 0, bSum = 0, count = 0;

        const ix1 = Math.max(0, Math.floor(cellX1));
        const ix2 = Math.min(viewW - 1, Math.floor(cellX2));
        const iy1 = Math.max(0, Math.floor(cellY1));
        const iy2 = Math.min(viewH - 1, Math.floor(cellY2));

        for (let py = iy1; py <= iy2; py++) {
          for (let px = ix1; px <= ix2; px++) {
            const idx = (py * viewW + px) * 4;
            rSum += d[idx];
            gSum += d[idx + 1];
            bSum += d[idx + 2];
            count++;
          }
        }

        const avgR = count > 0 ? Math.round(rSum / count) : 128;
        const avgG = count > 0 ? Math.round(gSum / count) : 128;
        const avgB = count > 0 ? Math.round(bSum / count) : 128;

        // Snapping using CIELAB deltaE76
        const { hex } = snapToPalette(avgR, avgG, avgB, palette, lurexThreshold);
        refGridColorMap[r][c] = hex;

        // Draw 1x1 pixel on the master reference grid
        expCtx.fillStyle = hex;
        expCtx.fillRect(c, r, 1, 1);
      }
    }

    setGridColorMap(refGridColorMap);
    hiddenCanvasRef.current = exportCanvas;
    onReferenceGenerated(exportCanvas);

    // 3. Render Thread-Accurate visualizer canvas (upscaled reference grid)
    refCanvas.width = viewW;
    refCanvas.height = viewH;
    refCtx.imageSmoothingEnabled = false; // Crisp nearest neighbor representation!

    // Draw reference cells upscaled to fill canvas
    const refCellW = viewW / warpCells;
    const refCellH = viewH / weftPicks;

    for (let r = 0; r < weftPicks; r++) {
      for (let c = 0; c < warpCells; c++) {
        refCtx.fillStyle = refGridColorMap[r][c];
        refCtx.fillRect(c * refCellW, r * refCellH, refCellW + 0.5, r * refCellH + refCellH + 0.5);

        // Grid lines drawn optionally on reference view
        if (showGridLines) {
          refCtx.strokeStyle = "rgba(100, 116, 139, 0.25)";
          refCtx.lineWidth = 0.5;
          refCtx.strokeRect(c * refCellW, r * refCellH, refCellW, refCellH);
        }
      }
    }

    // 4. Draw overlays (interactive grid lines) on source canvas if toggled
    if (showGridLines) {
      srcCtx.save();
      srcCtx.strokeStyle = "rgba(16, 185, 129, 0.65)"; // emerald-500 tint
      srcCtx.lineWidth = 1;

      // Draw Warp columns
      for (let c = 0; c <= warpCells; c++) {
        const x = startX + c * cellW;
        if (x >= startX && x <= startX + gridW) {
          srcCtx.beginPath();
          srcCtx.moveTo(x, startY);
          srcCtx.lineTo(x, startY + gridH);
          srcCtx.stroke();
        }
      }

      // Draw Weft rows
      for (let r = 0; r <= weftPicks; r++) {
        const y = startY + r * cellH;
        if (y >= startY && y <= startY + gridH) {
          srcCtx.beginPath();
          srcCtx.moveTo(startX, y);
          srcCtx.lineTo(startX + gridW, y);
          srcCtx.stroke();
        }
      }
      srcCtx.restore();
    }

    // Draw visual indicators for synchronization cursor
    if (syncCursor) {
      // Source Highlight
      const highlightX = startX + syncCursor.col * cellW;
      const highlightY = startY + syncCursor.row * cellH;
      srcCtx.save();
      srcCtx.strokeStyle = "#fbbf24"; // amber-400
      srcCtx.lineWidth = 2.5;
      srcCtx.strokeRect(highlightX, highlightY, cellW, cellH);
      srcCtx.restore();

      // Reference Highlight
      refCtx.save();
      refCtx.strokeStyle = "#fbbf24"; // amber-400
      refCtx.lineWidth = 2.5;
      refCtx.strokeRect(syncCursor.col * refCellW, syncCursor.row * refCellH, refCellW, refCellH);
      refCtx.restore();
    }
  }, [imageElement, params, specs, nudge, palette, showGridLines, warpCells, weftPicks, syncCursor, lurexThreshold]);

  // Handle cursor hover & coordinate extraction on source canvas
  const handleSourceMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!sourceCanvasRef.current || !imageElement) return;
    const rect = sourceCanvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Convert screen layout coordinate to canvas pixel space
    const canvasX = (x / rect.width) * sourceCanvasRef.current.width;
    const canvasY = (y / rect.height) * sourceCanvasRef.current.height;

    const gridOffsetX = nudge.offsetX;
    const gridOffsetY = nudge.offsetY;
    const gridScaleX = nudge.scaleX;
    const gridScaleY = nudge.scaleY;

    const viewW = sourceCanvasRef.current.width;
    const viewH = sourceCanvasRef.current.height;

    const startX = (viewW - viewW * gridScaleX) / 2 + gridOffsetX;
    const startY = (viewH - viewH * gridScaleY) / 2 + gridOffsetY;
    const gridW = viewW * gridScaleX;
    const gridH = viewH * gridScaleY;

    const cellW = gridW / warpCells;
    const cellH = gridH / weftPicks;

    const col = Math.floor((canvasX - startX) / cellW);
    const row = Math.floor((canvasY - startY) / cellH);

    if (col >= 0 && col < warpCells && row >= 0 && row < weftPicks) {
      setSyncCursor({ col, row });
      const hex = gridColorMap[row]?.[col] || "#ffffff";
      const matchedYarn = palette.find((p) => p.hex.toLowerCase() === hex.toLowerCase());
      setHoveredCell({
        col,
        row,
        colorHex: hex,
        colorName: matchedYarn ? matchedYarn.name : "Background/Yarn",
      });
    } else {
      setSyncCursor(null);
      setHoveredCell(null);
    }
  };

  // Handle cursor hover on Reference canvas
  const handleRefMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!refCanvasRef.current || !imageElement) return;
    const rect = refCanvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const canvasX = (x / rect.width) * refCanvasRef.current.width;
    const canvasY = (y / rect.height) * refCanvasRef.current.height;

    const cellW = refCanvasRef.current.width / warpCells;
    const cellH = refCanvasRef.current.height / weftPicks;

    const col = Math.floor(canvasX / cellW);
    const row = Math.floor(canvasY / cellH);

    if (col >= 0 && col < warpCells && row >= 0 && row < weftPicks) {
      setSyncCursor({ col, row });
      const hex = gridColorMap[row]?.[col] || "#ffffff";
      const matchedYarn = palette.find((p) => p.hex.toLowerCase() === hex.toLowerCase());
      setHoveredCell({
        col,
        row,
        colorHex: hex,
        colorName: matchedYarn ? matchedYarn.name : "Background/Yarn",
      });
    } else {
      setSyncCursor(null);
      setHoveredCell(null);
    }
  };

  const handleMouseLeave = () => {
    setSyncCursor(null);
    setHoveredCell(null);
  };

  // Zoom / Pan handlers
  const handleZoomIn = () => setZoom((prev) => Math.min(4, prev + 0.25));
  const handleZoomOut = () => setZoom((prev) => Math.max(0.75, prev - 0.25));
  const handleResetZoom = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 1 || e.shiftKey) {
      // Middle click or shift key for panning
      setIsPanning(true);
      setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
      e.preventDefault();
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isPanning) {
      setPan({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y,
      });
    }
  };

  const handleMouseUp = () => {
    setIsPanning(false);
  };

  // Trigger high-res PNG download
  const handleDownloadHighRes = () => {
    if (!hiddenCanvasRef.current) return;
    const tempCanvas = document.createElement("canvas");
    const scaleFactor = 10; // 10x scale
    tempCanvas.width = warpCells * scaleFactor;
    tempCanvas.height = weftPicks * scaleFactor;
    const ctx = tempCanvas.getContext("2d");
    if (!ctx) return;

    ctx.imageSmoothingEnabled = false;

    for (let r = 0; r < weftPicks; r++) {
      for (let c = 0; c < warpCells; c++) {
        ctx.fillStyle = gridColorMap[r][c];
        ctx.fillRect(c * scaleFactor, r * scaleFactor, scaleFactor, scaleFactor);

        // draw neat high-res visual lines
        if (showGridLines) {
          ctx.strokeStyle = "rgba(0, 0, 0, 0.15)";
          ctx.lineWidth = 0.5;
          ctx.strokeRect(c * scaleFactor, r * scaleFactor, scaleFactor, scaleFactor);
        }
      }
    }

    const link = document.createElement("a");
    link.download = `woven_reference_${warpCells}x${weftPicks}_highres.png`;
    link.href = tempCanvas.toDataURL("image/png");
    link.click();
  };

  const handleDownloadLossless = () => {
    if (!hiddenCanvasRef.current) return;
    const link = document.createElement("a");
    link.download = `woven_reference_${warpCells}x${weftPicks}_1to1.png`;
    link.href = hiddenCanvasRef.current.toDataURL("image/png");
    link.click();
  };

  return (
    <div className="flex flex-col space-y-4" id="visualizer-root">
      {/* Visualizer controls toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-800/80 backdrop-blur-md p-3 rounded-lg border border-slate-700">
        <div className="flex items-center space-x-2">
          <button
            onClick={handleZoomIn}
            className="p-1.5 bg-slate-700 hover:bg-slate-600 rounded-md text-slate-200 transition-colors"
            title="Zoom In"
            id="btn-zoom-in"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          <button
            onClick={handleZoomOut}
            className="p-1.5 bg-slate-700 hover:bg-slate-600 rounded-md text-slate-200 transition-colors"
            title="Zoom Out"
            id="btn-zoom-out"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <button
            onClick={handleResetZoom}
            className="px-2 py-1 bg-slate-700 hover:bg-slate-600 rounded-md text-slate-200 text-xs font-mono transition-colors"
            id="btn-zoom-reset"
          >
            {Math.round(zoom * 100)}% Reset
          </button>
          <span className="text-xs text-slate-400 flex items-center gap-1">
            <Move className="w-3.5 h-3.5 text-slate-500" />
            <kbd className="px-1 py-0.5 bg-slate-900 rounded text-[10px] font-mono text-slate-300">Shift + Drag</kbd> to pan
          </span>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={handleDownloadLossless}
            disabled={!imageElement}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-md text-white text-xs font-medium transition-all shadow-md"
            id="btn-download-lossless"
          >
            <Download className="w-3.5 h-3.5" />
            Export Lossless PNG (1:1)
          </button>
          <button
            onClick={handleDownloadHighRes}
            disabled={!imageElement}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 disabled:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-md text-slate-200 text-xs font-medium transition-all border border-slate-600"
            id="btn-download-highres"
          >
            <Download className="w-3.5 h-3.5 text-slate-400" />
            High-Res Grid (10x)
          </button>
        </div>
      </div>

      {/* Main Dual Stage comparison container */}
      <div
        className="grid grid-cols-1 lg:grid-cols-2 gap-6"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        {/* Left Side: Original Pre-processed Scan */}
        <div className="relative flex flex-col bg-slate-950 rounded-xl border border-slate-800 shadow-2xl overflow-hidden min-h-[450px]">
          <div className="absolute top-3 left-3 z-10 bg-slate-900/90 text-slate-300 px-3 py-1.5 rounded-md border border-slate-700 flex items-center space-x-2 shadow-lg">
            <span className="w-2.5 h-2.5 bg-emerald-500 rounded-full animate-pulse"></span>
            <span className="text-xs font-medium font-sans">1. Scan View with Grid Alignment</span>
          </div>

          {!imageElement ? (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-500 p-8 text-center">
              <Grid className="w-12 h-12 text-slate-700 mb-2" />
              <p className="text-sm">Please upload a label scan to calibrate</p>
              <p className="text-xs text-slate-600 mt-1">Automatic alignment will display here</p>
            </div>
          ) : (
            <div className="flex-1 overflow-hidden flex items-center justify-center p-4 relative cursor-crosshair select-none">
              <div
                style={{
                  transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                  transition: isPanning ? "none" : "transform 0.15s cubic-bezier(0.2, 0.8, 0.2, 1)",
                  transformOrigin: "center center",
                }}
              >
                <canvas
                  ref={sourceCanvasRef}
                  onMouseMove={handleSourceMouseMove}
                  onMouseLeave={handleMouseLeave}
                  className="shadow-2xl rounded max-w-full max-h-[400px] object-contain"
                  style={{ imageRendering: "pixelated" }}
                  id="source-canvas"
                />
              </div>
            </div>
          )}
        </div>

        {/* Right Side: Pixel-accurate Trace Reference Map */}
        <div className="relative flex flex-col bg-slate-950 rounded-xl border border-slate-800 shadow-2xl overflow-hidden min-h-[450px]">
          <div className="absolute top-3 left-3 z-10 bg-slate-900/90 text-slate-300 px-3 py-1.5 rounded-md border border-slate-700 flex items-center space-x-2 shadow-lg">
            <span className="w-2.5 h-2.5 bg-amber-500 rounded-full"></span>
            <span className="text-xs font-medium font-sans">2. MÜCAD Thread-Accurate Reference</span>
          </div>

          {!imageElement ? (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-500 p-8 text-center">
              <Check className="w-12 h-12 text-slate-700 mb-2" />
              <p className="text-sm">Processed output map will generate instantly</p>
              <p className="text-xs text-slate-600 mt-1">1 pixel on map = 1 thread on loom</p>
            </div>
          ) : (
            <div className="flex-1 overflow-hidden flex items-center justify-center p-4 relative cursor-crosshair select-none">
              <div
                style={{
                  transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                  transition: isPanning ? "none" : "transform 0.15s cubic-bezier(0.2, 0.8, 0.2, 1)",
                  transformOrigin: "center center",
                }}
              >
                <canvas
                  ref={refCanvasRef}
                  onMouseMove={handleRefMouseMove}
                  onMouseLeave={handleMouseLeave}
                  className="shadow-2xl rounded max-w-full max-h-[400px] object-contain"
                  style={{ imageRendering: "pixelated" }}
                  id="reference-canvas"
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Synchronized Hover readout details */}
      {imageElement && hoveredCell && (
        <div
          className="bg-slate-850 border border-slate-700 rounded-lg p-3 grid grid-cols-2 md:grid-cols-4 gap-4 items-center shadow-lg transition-all animate-fade-in text-xs font-mono text-slate-200"
          id="synced-cursor-readout"
        >
          <div className="flex items-center space-x-2 border-r border-slate-700 pr-2">
            <span className="text-slate-400">Warp End:</span>
            <span className="font-bold text-amber-400">#{hoveredCell.col + 1}</span>
            <span className="text-slate-500">/{warpCells}</span>
          </div>
          <div className="flex items-center space-x-2 border-r border-slate-700 px-2">
            <span className="text-slate-400">Weft Pick:</span>
            <span className="font-bold text-amber-400">#{hoveredCell.row + 1}</span>
            <span className="text-slate-500">/{weftPicks}</span>
          </div>
          <div className="flex items-center space-x-2 border-r border-slate-700 px-2">
            <span className="text-slate-400">Yarn Color:</span>
            <span className="font-bold">{hoveredCell.colorName}</span>
          </div>
          <div className="flex items-center space-x-2 pl-2 justify-between">
            <div className="flex items-center space-x-2">
              <div
                className="w-4 h-4 rounded-sm border border-white/20"
                style={{ backgroundColor: hoveredCell.colorHex }}
              ></div>
              <span className="font-bold">{hoveredCell.colorHex.toUpperCase()}</span>
            </div>
            <div className="text-[10px] bg-slate-900 text-slate-400 px-1.5 py-0.5 rounded">
              Sync Active
            </div>
          </div>
        </div>
      )}

      {/* Synchronized status bar explaining 1:1 map */}
      {imageElement && (
        <div className="bg-slate-800/40 px-4 py-2.5 rounded-lg border border-slate-700/60 flex items-center gap-2 text-xs text-slate-400 font-sans">
          <Info className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>
            <strong>Deterministic Resolution:</strong> This diagram measures exactly{" "}
            <span className="text-emerald-400 font-mono font-bold">{warpCells}</span> pixels wide (warp ends) by{" "}
            <span className="text-emerald-400 font-mono font-bold">{weftPicks}</span> pixels high (weft picks). Use the
            lossless download to import this directly into MÜCAD as a pixel-perfect background layer.
          </span>
        </div>
      )}
    </div>
  );
};
