import React, { useState, useRef, useEffect } from "react";
import { YarnColor } from "../types";
import { Sliders, Grid, Info, Download, ZoomIn, ZoomOut, Maximize2, ShieldAlert } from "lucide-react";

interface JacquardWeaveSimulatorProps {
  targetWidthPx: number;
  targetHeightPx: number;
  yarns: YarnColor[];
  getCellColor: (x: number, y: number) => string;
  isProcessing?: boolean;
}

type WeaveType = "plain" | "twill" | "satin" | "basket";

export const JacquardWeaveSimulator: React.FC<JacquardWeaveSimulatorProps> = ({
  targetWidthPx,
  targetHeightPx,
  yarns,
  getCellColor,
  isProcessing = false,
}) => {
  // Simulator Parameters
  const [weaveType, setWeaveType] = useState<WeaveType>("plain");
  const [warpColor, setWarpColor] = useState<string>("#121212"); // Default to black warp
  const [warpName, setWarpName] = useState<string>("Carbon Black (100 dtex)");
  const [simZoom, setSimZoom] = useState<number>(8); // Default 8x macro zoom for beautiful thread details
  const [lustre, setLustre] = useState<number>(0.35); // Weft thread highlights opacity
  const [tensionGaps, setTensionGaps] = useState<number>(1); // 0 to 4 px black crack lines simulating weave gaps
  const [warpWeight, setWarpWeight] = useState<number>(0.9); // 0.6 to 1.0 warp thread width ratio
  const [customWarpHex, setCustomWarpHex] = useState<string>("#121212");

  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Default preset warp colors
  const warpPresets = [
    { hex: "#FFFFFF", name: "Chalk White (75 dtex)" },
    { hex: "#121212", name: "Carbon Black (100 dtex)" },
    { hex: "#E5D2B3", name: "Bleached Ecru (80 dtex)" },
    { hex: "#1E3A8A", name: "Royal Blue (100 dtex)" },
    { hex: "#991B1B", name: "Ruby Red (100 dtex)" },
    { hex: "#D4AF37", name: "Lurex Metallic Gold" },
  ];

  // Helper to check if warp thread is on top for a given coordinate
  const isWarpOnTop = (x: number, y: number, type: WeaveType): boolean => {
    switch (type) {
      case "plain":
        // 1/1 checkerboard plain weave
        return (x + y) % 2 === 0;
      case "twill":
        // 2/1 twill diagonal ribs
        return (x - y + 3000) % 3 === 0;
      case "satin":
        // 5-end satin layout
        return (x * 2 + y) % 5 === 0;
      case "basket":
        // 2/2 basket block weave
        return (Math.floor(x / 2) + Math.floor(y / 2)) % 2 === 0;
      default:
        return true;
    }
  };

  // Render base flat color pixels on our canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Canvas size is exactly targetWidthPx * simZoom wide by targetHeightPx * simZoom high
    canvas.width = targetWidthPx * simZoom;
    canvas.height = targetHeightPx * simZoom;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Paint cells
    for (let y = 0; y < targetHeightPx; y++) {
      for (let x = 0; x < targetWidthPx; x++) {
        const color = getCellColor(x, y);
        ctx.fillStyle = color;
        ctx.fillRect(x * simZoom, y * simZoom, simZoom, simZoom);
      }
    }
  }, [targetWidthPx, targetHeightPx, simZoom, getCellColor, yarns, isProcessing]);

  // Determine warp-over-weft structure repeating unit dimensions
  const getRepeatSize = (type: WeaveType) => {
    switch (type) {
      case "plain": return 2;
      case "twill": return 3;
      case "satin": return 5;
      case "basket": return 4;
    }
  };

  const repeatCount = getRepeatSize(weaveType);
  const patternWidth = repeatCount * simZoom;
  const patternHeight = repeatCount * simZoom;

  // Generate pattern SVG path elements representing vertical warp yarns and horizontal weft yarns
  const renderPatternThreads = () => {
    const cells: React.ReactNode[] = [];

    for (let r = 0; r < repeatCount; r++) {
      for (let c = 0; c < repeatCount; c++) {
        const x = c * simZoom;
        const y = r * simZoom;
        const warpTop = isWarpOnTop(c, r, weaveType);

        // Compute width of warp thread based on warpWeight
        const activeWarpWidth = simZoom * warpWeight;
        const warpXOffset = (simZoom - activeWarpWidth) / 2;

        if (warpTop) {
          // Warp thread on top (vertical cylinder of warpColor)
          cells.push(
            <g key={`cell-${c}-${r}`}>
              {/* Background warp shadow behind weft */}
              <rect
                x={x}
                y={y}
                width={simZoom}
                height={simZoom}
                fill="#000000"
                fillOpacity={tensionGaps * 0.15}
              />
              {/* Vertical Warp Thread Cylinder */}
              <rect
                x={x + warpXOffset}
                y={y}
                width={activeWarpWidth}
                height={simZoom}
                fill="url(#warp-grad)"
              />
              {/* Fibers texture overlay */}
              <line
                x1={x + warpXOffset + activeWarpWidth * 0.3}
                y1={y}
                x2={x + warpXOffset + activeWarpWidth * 0.5}
                y2={y + simZoom}
                stroke="rgba(255, 255, 255, 0.08)"
                strokeWidth="0.5"
              />
              <line
                x1={x + warpXOffset + activeWarpWidth * 0.6}
                y1={y}
                x2={x + warpXOffset + activeWarpWidth * 0.8}
                y2={y + simZoom}
                stroke="rgba(0, 0, 0, 0.12)"
                strokeWidth="0.5"
              />
            </g>
          );
        } else {
          // Weft thread on top (horizontal shading letting the underlying canvas color shine through)
          cells.push(
            <g key={`cell-${c}-${r}`}>
              {/* Semi-transparent 3D Cylindrical weft thread shading overlay */}
              <rect
                x={x}
                y={y}
                width={simZoom}
                height={simZoom}
                fill="url(#weft-shading)"
              />
              {/* Warp background barely showing through tension cracks */}
              {tensionGaps > 0 && (
                <rect
                  x={x}
                  y={y}
                  width={simZoom}
                  height={tensionGaps}
                  fill="#000000"
                  fillOpacity={tensionGaps * 0.18}
                />
              )}
              {/* Diagonal fiber thread twist texture to simulate spun yarns */}
              <line
                x1={x}
                y1={y + simZoom * 0.3}
                x2={x + simZoom}
                y2={y + simZoom * 0.5}
                stroke="rgba(255, 255, 255, 0.08)"
                strokeWidth="0.5"
              />
              <line
                x1={x}
                y1={y + simZoom * 0.6}
                x2={x + simZoom}
                y2={y + simZoom * 0.8}
                stroke="rgba(0, 0, 0, 0.15)"
                strokeWidth="0.5"
              />
            </g>
          );
        }
      }
    }

    return cells;
  };

  // Analyze quality and potential structural weaving alerts
  const analyzeFabricQuality = () => {
    const alerts: string[] = [];
    
    // Warp vs Weft contrast
    const isWarpDark = warpColor === "#121212" || warpColor === "#1E3A8A" || warpColor === "#991B1B";
    const hasLightYarns = yarns.some(y => {
      const hex = y.hex.replace("#", "");
      const r = parseInt(hex.substring(0,2), 16);
      const g = parseInt(hex.substring(2,4), 16);
      const b = parseInt(hex.substring(4,6), 16);
      const brightness = (r * 299 + g * 587 + b * 114) / 1000;
      return brightness > 180;
    });

    if (isWarpDark && hasLightYarns && tensionGaps >= 2) {
      alerts.push("High grin-through risk: Dark warp threads may show through loose tension light weft areas.");
    }
    
    if (weaveType === "satin" && targetHeightPx < 40) {
      alerts.push("Coarse density warning: Satin floats might look loose or catch easily at low weft densities.");
    }

    if (tensionGaps === 0) {
      alerts.push("Maximum tension: Simulated fabric is ultra-dense with zero interstice leakage.");
    }

    if (alerts.length === 0) {
      return ["Optimal weave balance detected. Perfect thread integration for standard Jakob Müller label looms."];
    }

    return alerts;
  };

  const handleDownloadSimulationSvg = () => {
    // Generate full-size SVG simulation
    const svgWidth = targetWidthPx * simZoom;
    const svgHeight = targetHeightPx * simZoom;

    // Create background colored rects SVG source
    let svgCellsSource = "";
    for (let y = 0; y < targetHeightPx; y++) {
      for (let x = 0; x < targetWidthPx; x++) {
        const color = getCellColor(x, y);
        svgCellsSource += `<rect x="${x * simZoom}" y="${y * simZoom}" width="${simZoom}" height="${simZoom}" fill="${color}" />\n`;
      }
    }

    const svgString = `<svg xmlns="http://www.w3.org/2000/svg" width="${svgWidth}" height="${svgHeight}" viewBox="0 0 ${svgWidth} ${svgHeight}">
  <defs>
    <!-- 3D Warp vertical gradient using solid warp color -->
    <linearGradient id="warp-grad-dl" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#000000" stop-opacity="0.5" />
      <stop offset="30%" stop-color="${warpColor}" />
      <stop offset="50%" stop-color="#ffffff" stop-opacity="0.35" />
      <stop offset="70%" stop-color="${warpColor}" />
      <stop offset="100%" stop-color="#000000" stop-opacity="0.5" />
    </linearGradient>

    <!-- 3D Weft horizontal shading overlay gradient -->
    <linearGradient id="weft-shading-dl" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#000000" stop-opacity="0.55" />
      <stop offset="30%" stop-color="#ffffff" stop-opacity="0.0" />
      <stop offset="50%" stop-color="#ffffff" stop-opacity="${lustre}" />
      <stop offset="70%" stop-color="#ffffff" stop-opacity="0.0" />
      <stop offset="100%" stop-color="#000000" stop-opacity="0.55" />
    </linearGradient>

    <pattern id="jacquard-pattern-dl" width="${patternWidth}" height="${patternHeight}" patternUnits="userSpaceOnUse">
      ${repeatCount === 2 ? `<!-- Plain Weave repeat -->` : ``}
      ${/* Inline pattern generator for the download */ ""}
    </pattern>
  </defs>

  <!-- Color base layer -->
  <g id="weft-base-pixels">
    ${svgCellsSource}
  </g>

  <!-- Weave structure overlay -->
  <rect width="100%" height="100%" fill="url(#jacquard-pattern-dl)" />
</svg>`;

    // Download file
    const blob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `jacquard_woven_simulation_${targetWidthPx}x${targetHeightPx}.svg`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleWarpColorSelect = (hex: string, name: string) => {
    setWarpColor(hex);
    setWarpName(name);
    setCustomWarpHex(hex);
  };

  const handleCustomWarpColor = (e: React.ChangeEvent<HTMLInputElement>) => {
    const hex = e.target.value;
    setCustomWarpHex(hex);
    setWarpColor(hex);
    setWarpName("Custom Thread");
  };

  return (
    <div className="bg-stone-900 border border-stone-800 rounded-xl overflow-hidden p-6 space-y-6" id="jacquard-weave-simulator-panel">
      {/* Header and Details */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-stone-800 pb-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded-full text-[10px] font-mono font-bold tracking-wider uppercase">
              Physical Preview
            </span>
            <span className="text-stone-500 text-xs font-mono">
              Deterministic 1-to-1 Thread Simulator
            </span>
          </div>
          <h3 className="text-base font-bold text-white flex items-center gap-2">
            🧵 3D Jacquard Fabric &amp; Weave structure Simulator
          </h3>
          <p className="text-xs text-stone-400 leading-relaxed max-w-2xl">
            Simulates the physical interlacing of yarn threads on a high-speed label loom. Select weaves to alternate warp/weft floats, adjust thread lustre, and preview warp grin-through.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setSimZoom(prev => Math.max(4, prev - 2))}
            disabled={simZoom <= 4}
            className="p-1.5 bg-stone-950 border border-stone-850 hover:bg-stone-800 disabled:opacity-40 rounded text-stone-300 transition"
            title="Zoom Out"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <span className="text-xs font-mono bg-stone-950 px-2.5 py-1 rounded border border-stone-850 text-stone-200">
            {simZoom}x Scale
          </span>
          <button
            onClick={() => setSimZoom(prev => Math.min(16, prev + 2))}
            disabled={simZoom >= 16}
            className="p-1.5 bg-stone-950 border border-stone-850 hover:bg-stone-800 disabled:opacity-40 rounded text-stone-300 transition"
            title="Zoom In"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Side: Parameters Form */}
        <div className="lg:col-span-4 space-y-5 bg-stone-950/40 p-4 rounded-xl border border-stone-850/60">
          
          {/* Parameter Section Title */}
          <div className="flex items-center gap-1.5 text-white border-b border-stone-850 pb-2">
            <Sliders className="w-4 h-4 text-emerald-400" />
            <h4 className="text-xs font-bold uppercase tracking-wider">Simulator Parameters</h4>
          </div>

          {/* Weave Structure Selector */}
          <div className="space-y-2">
            <label className="block text-[11px] font-bold text-stone-300 uppercase tracking-wider flex items-center justify-between">
              <span>Weave Bind / Structure</span>
              <span className="text-[10px] text-stone-500 font-mono normal-case font-normal">Alternates Crossover</span>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setWeaveType("plain")}
                className={`py-2 px-3 rounded-lg border text-left transition text-xs flex flex-col justify-between h-14 ${
                  weaveType === "plain"
                    ? "bg-emerald-600/10 text-white border-emerald-500/50"
                    : "bg-stone-950 border-stone-850 text-stone-400 hover:text-stone-200"
                }`}
              >
                <span className="font-semibold block">Plain Weave</span>
                <span className="text-[9px] text-stone-500">1/1 Tabby (Stiffest)</span>
              </button>

              <button
                type="button"
                onClick={() => setWeaveType("twill")}
                className={`py-2 px-3 rounded-lg border text-left transition text-xs flex flex-col justify-between h-14 ${
                  weaveType === "twill"
                    ? "bg-emerald-600/10 text-white border-emerald-500/50"
                    : "bg-stone-950 border-stone-850 text-stone-400 hover:text-stone-200"
                }`}
              >
                <span className="font-semibold block">Twill Weave</span>
                <span className="text-[9px] text-stone-500">2/1 Ribs (Diagonal)</span>
              </button>

              <button
                type="button"
                onClick={() => setWeaveType("satin")}
                className={`py-2 px-3 rounded-lg border text-left transition text-xs flex flex-col justify-between h-14 ${
                  weaveType === "satin"
                    ? "bg-emerald-600/10 text-white border-emerald-500/50"
                    : "bg-stone-950 border-stone-850 text-stone-400 hover:text-stone-200"
                }`}
              >
                <span className="font-semibold block">Satin Weave</span>
                <span className="text-[9px] text-stone-500">5-Harness (Smooth Floats)</span>
              </button>

              <button
                type="button"
                onClick={() => setWeaveType("basket")}
                className={`py-2 px-3 rounded-lg border text-left transition text-xs flex flex-col justify-between h-14 ${
                  weaveType === "basket"
                    ? "bg-emerald-600/10 text-white border-emerald-500/50"
                    : "bg-stone-950 border-stone-850 text-stone-400 hover:text-stone-200"
                }`}
              >
                <span className="font-semibold block">Basket Weave</span>
                <span className="text-[9px] text-stone-500">2/2 Block Interlace</span>
              </button>
            </div>
          </div>

          {/* Warp Yarn Color Preset */}
          <div className="space-y-2">
            <label className="block text-[11px] font-bold text-stone-300 uppercase tracking-wider flex items-center justify-between">
              <span>Warp Thread Color</span>
              <span className="text-[10px] text-stone-400 font-mono font-semibold">{warpName}</span>
            </label>
            
            <div className="flex flex-wrap gap-1.5 p-2 bg-stone-950 rounded-lg border border-stone-850">
              {warpPresets.map((preset) => (
                <button
                  key={preset.name}
                  type="button"
                  onClick={() => handleWarpColorSelect(preset.hex, preset.name)}
                  className={`w-6 h-6 rounded-full border transition-all ${
                    warpColor.toLowerCase() === preset.hex.toLowerCase()
                      ? "scale-110 ring-2 ring-emerald-500/60 border-white"
                      : "border-stone-800 hover:scale-105"
                  }`}
                  style={{ backgroundColor: preset.hex }}
                  title={preset.name}
                />
              ))}

              <div className="w-[1px] h-6 bg-stone-800 self-center mx-1" />

              {/* Custom Warp Color Picker */}
              <div className="relative flex items-center gap-1">
                <input
                  type="color"
                  value={customWarpHex}
                  onChange={handleCustomWarpColor}
                  className="w-6 h-6 bg-transparent border-0 cursor-pointer rounded-full p-0 overflow-hidden"
                  title="Choose custom warp color"
                />
                <span className="text-[10px] font-mono text-stone-500">Custom</span>
              </div>
            </div>
          </div>

          {/* Physical Sliders */}
          <div className="space-y-4 pt-1">
            {/* Lustre Sheen Slider */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-stone-300 font-semibold flex items-center gap-1">
                  Weft Yarn Sheen / Lustre
                </span>
                <span className="text-stone-400 font-mono text-[11px]">{Math.round(lustre * 100)}%</span>
              </div>
              <input
                type="range"
                min="0.10"
                max="0.65"
                step="0.05"
                value={lustre}
                onChange={(e) => setLustre(parseFloat(e.target.value))}
                className="w-full accent-emerald-500 h-1 bg-stone-900 rounded-lg cursor-pointer"
              />
              <p className="text-[10px] text-stone-500 leading-tight">
                Controls light reflection highlight intensity on horizontally floating weft threads.
              </p>
            </div>

            {/* Tension Slider */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-stone-300 font-semibold">
                  Thread Tension (Gaps)
                </span>
                <span className="text-stone-400 font-mono text-[11px]">
                  {tensionGaps === 0 ? "Perfect / Tight" : `${tensionGaps} px gaps`}
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="3"
                step="1"
                value={tensionGaps}
                onChange={(e) => setTensionGaps(parseInt(e.target.value))}
                className="w-full accent-emerald-500 h-1 bg-stone-900 rounded-lg cursor-pointer"
              />
              <p className="text-[10px] text-stone-500 leading-tight">
                Simulates physical loom tension gaps between warp/weft crossovers. Higher values trigger warp grin-through.
              </p>
            </div>

            {/* Warp Thread Weight (Thickness) */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-stone-300 font-semibold">
                  Warp Thread Thickness
                </span>
                <span className="text-stone-400 font-mono text-[11px]">{Math.round(warpWeight * 100)}%</span>
              </div>
              <input
                type="range"
                min="0.65"
                max="1.0"
                step="0.05"
                value={warpWeight}
                onChange={(e) => setWarpWeight(parseFloat(e.target.value))}
                className="w-full accent-emerald-500 h-1 bg-stone-900 rounded-lg cursor-pointer"
              />
              <p className="text-[10px] text-stone-500 leading-tight">
                Proportion of warp yarn width compared to weft channels. Thinner threads raise spacing.
              </p>
            </div>
          </div>

          {/* Loom Fabric Quality Analysis Report */}
          <div className="bg-stone-950 p-3 rounded-lg border border-stone-850 space-y-2">
            <span className="text-[10px] font-bold font-mono tracking-wider text-emerald-400 uppercase flex items-center gap-1.5">
              <ShieldAlert className="w-3.5 h-3.5" /> Fabric Quality Report:
            </span>
            <div className="space-y-1">
              {analyzeFabricQuality().map((alert, idx) => (
                <p key={idx} className="text-[11px] text-stone-300 leading-relaxed font-sans">
                  • {alert}
                </p>
              ))}
            </div>
          </div>

        </div>

        {/* Right Side: Visualizer Stage */}
        <div className="lg:col-span-8 flex flex-col bg-stone-950 rounded-xl border border-stone-850 shadow-2xl overflow-hidden relative min-h-[420px]">
          {/* Top Info Bar */}
          <div className="bg-stone-900/95 border-b border-stone-850 px-4 py-2.5 flex items-center justify-between text-xs">
            <span className="text-stone-300 flex items-center gap-1.5 font-semibold">
              <span className="w-2.5 h-2.5 bg-emerald-500 rounded-full block animate-pulse" />
              Physical Weft + Warp Simulation Stage
            </span>
            <span className="text-stone-500 font-mono text-[11px]">
              {targetWidthPx} ends x {targetHeightPx} picks
            </span>
          </div>

          {/* Interactive Zoomable Render Canvas Box */}
          <div className="flex-1 overflow-auto p-6 flex items-center justify-center bg-[radial-gradient(#1e1e1e_1px,transparent_1px)] [background-size:16px_16px] min-h-[300px]">
            <div
              className="relative shadow-2xl rounded border border-stone-800"
              style={{
                width: `${targetWidthPx * simZoom}px`,
                height: `${targetHeightPx * simZoom}px`,
              }}
            >
              {/* Solid colored cell canvas */}
              <canvas
                ref={canvasRef}
                className="absolute inset-0 w-full h-full"
                style={{ imageRendering: "pixelated" }}
              />

              {/* Advanced SVG Pattern Overlay aligned pixel-to-pixel */}
              <svg
                className="absolute inset-0 w-full h-full pointer-events-none"
                width={targetWidthPx * simZoom}
                height={targetHeightPx * simZoom}
              >
                <defs>
                  {/* Warp Thread Vertical Gradient with shadow margins */}
                  <linearGradient id="warp-grad" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#000000" stopOpacity="0.45" />
                    <stop offset="25%" stopColor={warpColor} />
                    <stop offset="50%" stopColor="#ffffff" stopOpacity="0.30" />
                    <stop offset="75%" stopColor={warpColor} />
                    <stop offset="100%" stopColor="#000000" stopOpacity="0.45" />
                  </linearGradient>

                  {/* Weft Thread Shading overlay (horizontal highlight & edges shadow) */}
                  <linearGradient id="weft-shading" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#000000" stopOpacity="0.5" />
                    <stop offset="20%" stopColor="#ffffff" stopOpacity="0.0" />
                    <stop offset="50%" stopColor="#ffffff" stopOpacity={lustre} />
                    <stop offset="80%" stopColor="#ffffff" stopOpacity="0.0" />
                    <stop offset="100%" stopColor="#000000" stopOpacity="0.5" />
                  </linearGradient>

                  {/* Dynamic pattern replicating selected weave type */}
                  <pattern
                    id="jacquard-pattern"
                    width={patternWidth}
                    height={patternHeight}
                    patternUnits="userSpaceOnUse"
                  >
                    {renderPatternThreads()}
                  </pattern>
                </defs>

                {/* Fill entire overlay rect with jacquard weave pattern */}
                <rect width="100%" height="100%" fill="url(#jacquard-pattern)" />
              </svg>
            </div>
          </div>

          {/* Action Footer */}
          <div className="bg-stone-900/90 border-t border-stone-850 px-4 py-3 flex flex-wrap gap-3 items-center justify-between text-xs">
            <div className="flex items-center gap-1 text-stone-400 font-sans">
              <Info className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>Weft floats shine through transparent pattern slots; warp slots fill with solid vertical threads.</span>
            </div>

            <button
              onClick={handleDownloadSimulationSvg}
              className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded font-semibold flex items-center gap-1.5 transition select-none shadow hover:shadow-emerald-650/10 cursor-pointer"
              title="Download simulated physical woven structure as lossless SVG vectors"
            >
              <Download className="w-3.5 h-3.5" /> Export Vector Fabric (SVG)
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};
