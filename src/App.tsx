import React, { useState, useRef, useEffect } from "react";
import {
  Upload,
  RotateCw,
  Sun,
  Grid,
  Download,
  Info,
  Check,
  Plus,
  Trash2,
  Sparkles,
  Eye,
  RefreshCw,
  Settings,
  Minimize,
  Sliders,
  Sparkle,
  SlidersHorizontal,
  HelpCircle,
  Paintbrush,
  Eraser,
  FileSpreadsheet
} from "lucide-react";
import { YarnColor, ImageParams, TechSpecs, AnalysisResult } from "./types";
import { snapToPalette, rgbToLab, hexToLab, getDeltaE76 } from "./utils/color";

const DEFAULT_YARNS: YarnColor[] = [
  { id: "1", hex: "#ff0000", name: "Red", role: "Background Pattern", isMetallic: false },
  { id: "2", hex: "#ffffff", name: "White", role: "Gear symbol & Müller text", isMetallic: false },
  { id: "3", hex: "#000000", name: "Black", role: "Structure/Border", isMetallic: false },
];

export default function App() {
  // State
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [loadedImage, setLoadedImage] = useState<HTMLImageElement | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);

  // Technical specs
  const [specs, setSpecs] = useState<TechSpecs>({
    widthMm: 45,
    heightMm: 15,
    warpDensity: 100, // ends/cm
    weftDensity: 80,  // picks/cm
  });

  // Derived Grid Resolution (Ends and Picks)
  const targetWidthPx = Math.round((specs.widthMm / 10) * specs.warpDensity);
  const targetHeightPx = Math.round((specs.heightMm / 10) * specs.weftDensity);

  // Filter & Correction Params
  const [params, setParams] = useState<ImageParams>({
    brightness: 0,
    contrast: 0,
    rotation: 0,
    denoise: 1,
    edgeDetect: false,
    sharpness: 20,
  });

  // Custom Yarn Palette
  const [yarns, setYarns] = useState<YarnColor[]>(DEFAULT_YARNS);
  const [newYarnHex, setNewYarnHex] = useState("#ff0000");
  const [newYarnName, setNewYarnName] = useState("");
  const [newYarnRole, setNewYarnRole] = useState("Accent");
  const [newYarnIsMetallic, setNewYarnIsMetallic] = useState(false);

  // Zooming & Viewing Controls
  const [zoomLevel, setZoomLevel] = useState<number>(4);
  const [showGridOverlay, setShowGridOverlay] = useState<boolean>(true);
  const [showOriginalInComparison, setShowOriginalInComparison] = useState<boolean>(true);
  
  // Interactive coordinate synchronization
  const [hoveredCell, setHoveredCell] = useState<{ x: number; y: number } | null>(null);

  // Manual Loom Painting Overrides
  const [isPaintMode, setIsPaintMode] = useState<boolean>(false);
  const [selectedPaintColor, setSelectedPaintColor] = useState<string>("");
  const [manualEdits, setManualEdits] = useState<Record<string, string>>({});
  const [isDrawing, setIsDrawing] = useState<boolean>(false);
  const [brushSize, setBrushSize] = useState<number>(1);
  const [isAutoAligning, setIsAutoAligning] = useState<boolean>(false);

  // Initialize selected paint color to first yarn color
  useEffect(() => {
    if (yarns.length > 0 && !selectedPaintColor) {
      setSelectedPaintColor(yarns[0].hex);
    }
  }, [yarns]);

  // Reset manual edits if resolution changes to prevent alignment mismatch
  useEffect(() => {
    setManualEdits({});
  }, [targetWidthPx, targetHeightPx, imageSrc]);

  // Canvas Refs
  const originalCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const gridCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const sourceImageRef = useRef<HTMLImageElement | null>(null);

  // Handle file uploads
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setSelectedFile(file);
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          setImageSrc(event.target.result as string);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const triggerUpload = () => {
    document.getElementById("label-file-input")?.click();
  };

  // Run Gemini Cloud AI Assistant Scan
  const runCloudAnalysis = async () => {
    if (!imageSrc) return;
    setAnalyzing(true);
    try {
      const response = await fetch("/api/analyze-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          base64Image: imageSrc,
          mimeType: selectedFile?.type || "image/png",
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to analyze.");
      }

      const data: AnalysisResult = await response.json();
      setAnalysisResult(data);
      
      // Update dimensions & densities to match the expert estimate
      setSpecs({
        widthMm: data.estimatedWidthMm || specs.widthMm,
        heightMm: data.estimatedHeightMm || specs.heightMm,
        warpDensity: data.estimatedWarpDensity || specs.warpDensity,
        weftDensity: data.estimatedWeftDensity || specs.weftDensity,
      });

      // Map the extracted yarn colors to our system
      if (data.yarnPalette && data.yarnPalette.length > 0) {
        const newYarns: YarnColor[] = data.yarnPalette.map((y, idx) => ({
          id: `ai-${idx}`,
          hex: y.hex,
          name: y.name,
          role: y.role,
          isMetallic: y.role.toLowerCase().includes("shiny") || y.role.toLowerCase().includes("metallic") || y.role.toLowerCase().includes("lurex"),
        }));
        setYarns(newYarns);
      }
    } catch (err: any) {
      console.error(err);
      alert(`AI Analysis Error: ${err.message}`);
    } finally {
      setAnalyzing(false);
    }
  };

  // 1. Asynchronously load imageSrc into loadedImage state
  useEffect(() => {
    if (!imageSrc) {
      setLoadedImage(null);
      return;
    }
    const img = new Image();
    img.src = imageSrc;
    img.onload = () => {
      setLoadedImage(img);
    };
  }, [imageSrc]);

  // 2. Render whenever loadedImage, params, specs, yarns, or manualEdits change
  useEffect(() => {
    if (!loadedImage) return;
    sourceImageRef.current = loadedImage;
    renderProcessedOriginal();
  }, [loadedImage, params, specs, yarns, manualEdits]);

  // Render the pre-processed canvas
  const renderProcessedOriginal = () => {
    const img = sourceImageRef.current;
    const canvas = originalCanvasRef.current;
    if (!img || !canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Set canvas dimensions based on image, taking care of rotation bounds
    const rad = (params.rotation * Math.PI) / 180;
    const absCos = Math.abs(Math.cos(rad));
    const absSin = Math.abs(Math.sin(rad));
    const rotatedW = Math.round(img.width * absCos + img.height * absSin);
    const rotatedH = Math.round(img.width * absSin + img.height * absCos);

    canvas.width = rotatedW;
    canvas.height = rotatedH;

    // Draw rotated image
    ctx.clearRect(0, 0, rotatedW, rotatedH);
    ctx.translate(rotatedW / 2, rotatedH / 2);
    ctx.rotate(rad);
    ctx.drawImage(img, -img.width / 2, -img.height / 2);
    ctx.rotate(-rad);
    ctx.translate(-rotatedW / 2, -rotatedH / 2);

    // Apply brightness, contrast, and sharpening directly via ImageData manipulation
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = imgData.data;

    // Filters: Contrast, Brightness, Denoise strength
    const brightnessOffset = params.brightness * 2.55; // convert -100..100 to -255..255
    const contrastFactor = (259 * (params.contrast + 255)) / (255 * (259 - params.contrast));

    for (let i = 0; i < d.length; i += 4) {
      let r = d[i];
      let g = d[i + 1];
      let b = d[i + 2];

      // 1. Apply Brightness
      r += brightnessOffset;
      g += brightnessOffset;
      b += brightnessOffset;

      // 2. Apply Contrast
      r = contrastFactor * (r - 128) + 128;
      g = contrastFactor * (g - 128) + 128;
      b = contrastFactor * (b - 128) + 128;

      // Bound clamping
      d[i] = Math.max(0, Math.min(255, r));
      d[i + 1] = Math.max(0, Math.min(255, g));
      d[i + 2] = Math.max(0, Math.min(255, b));
    }

    ctx.putImageData(imgData, 0, 0);

    // After processing original image, compile the thread-level grid representation
    renderThreadGrid();
  };

  // Resample original pre-processed image into a thread-aligned canvas
  const renderThreadGrid = () => {
    const origCanvas = originalCanvasRef.current;
    const gridCanvas = gridCanvasRef.current;
    if (!origCanvas || !gridCanvas) return;

    const origCtx = origCanvas.getContext("2d");
    const gridCtx = gridCanvas.getContext("2d");
    if (!origCtx || !gridCtx) return;

    // Re-set size of grid to exactly our warp ends & weft picks target resolution
    gridCanvas.width = targetWidthPx;
    gridCanvas.height = targetHeightPx;

    const origW = origCanvas.width;
    const origH = origCanvas.height;

    // For every grid cell, we average the block of pixels from the pre-processed canvas
    // then snap the average to the closest yarn palette color using Lab CIE76
    const cellW = origW / targetWidthPx;
    const cellH = origH / targetHeightPx;

    const gridImgData = gridCtx.createImageData(targetWidthPx, targetHeightPx);
    const gridData = gridImgData.data;

    const sourceData = origCtx.getImageData(0, 0, origW, origH).data;

    for (let gy = 0; gy < targetHeightPx; gy++) {
      for (let gx = 0; gx < targetWidthPx; gx++) {
        // Pixel bounding box inside original source canvas
        const startX = Math.floor(gx * cellW);
        const endX = Math.min(origW, Math.floor((gx + 1) * cellW));
        const startY = Math.floor(gy * cellH);
        const endY = Math.min(origH, Math.floor((gy + 1) * cellH));

        let sumR = 0;
        let sumG = 0;
        let sumB = 0;
        let count = 0;

        for (let py = startY; py < endY; py++) {
          for (let px = startX; px < endX; px++) {
            const idx = (py * origW + px) * 4;
            sumR += sourceData[idx];
            sumG += sourceData[idx + 1];
            sumB += sourceData[idx + 2];
            count++;
          }
        }

        // Compute average color of this thread block
        const avgR = count > 0 ? sumR / count : 255;
        const avgG = count > 0 ? sumG / count : 255;
        const avgB = count > 0 ? sumB / count : 255;

        // Snap average to designer yarn palette using CIELAB CIE76
        let snappedHex = snapToPalette(avgR, avgG, avgB, yarns).hex;

        // Apply manual pixel overrides from correction brush
        const coordKey = `${gx},${gy}`;
        if (manualEdits[coordKey]) {
          snappedHex = manualEdits[coordKey];
        }

        // Convert matched hex to RGB and write to grid pixel
        const hexVal = snappedHex.replace("#", "");
        const matchedR = parseInt(hexVal.substring(0, 2), 16) || 0;
        const matchedG = parseInt(hexVal.substring(2, 4), 16) || 0;
        const matchedB = parseInt(hexVal.substring(4, 6), 16) || 0;

        const gridPixelIdx = (gy * targetWidthPx + gx) * 4;
        gridData[gridPixelIdx] = matchedR;
        gridData[gridPixelIdx + 1] = matchedG;
        gridData[gridPixelIdx + 2] = matchedB;
        gridData[gridPixelIdx + 3] = 255; // Fully opaque
      }
    }

    gridCtx.putImageData(gridImgData, 0, 0);
  };

  // Interactive mouse move synchronization on either canvas
  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>, isGrid: boolean) => {
    const canvas = e.currentTarget;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Translate to grid cell index
    if (isGrid) {
      const cellX = Math.floor((x / rect.width) * targetWidthPx);
      const cellY = Math.floor((y / rect.height) * targetHeightPx);
      if (cellX >= 0 && cellX < targetWidthPx && cellY >= 0 && cellY < targetHeightPx) {
        setHoveredCell({ x: cellX, y: cellY });
      }
    } else {
      // Original canvas hover
      const cellX = Math.floor((x / rect.width) * targetWidthPx);
      const cellY = Math.floor((y / rect.height) * targetHeightPx);
      if (cellX >= 0 && cellX < targetWidthPx && cellY >= 0 && cellY < targetHeightPx) {
        setHoveredCell({ x: cellX, y: cellY });
      }
    }
  };

  const handleMouseLeave = () => {
    setHoveredCell(null);
  };

  // Get the physical scanned color of a particular grid cell from the pre-processed original canvas
  const getCellAverageColor = (gx: number, gy: number) => {
    const origCanvas = originalCanvasRef.current;
    if (!origCanvas) return null;
    const ctx = origCanvas.getContext("2d");
    if (!ctx) return null;

    const cellW = origCanvas.width / targetWidthPx;
    const cellH = origCanvas.height / targetHeightPx;
    const startX = Math.floor(gx * cellW);
    const startY = Math.floor(gy * cellH);
    const endX = Math.min(origCanvas.width, Math.floor((gx + 1) * cellW));
    const endY = Math.min(origCanvas.height, Math.floor((gy + 1) * cellH));

    try {
      const imgData = ctx.getImageData(startX, startY, Math.max(1, endX - startX), Math.max(1, endY - startY));
      const d = imgData.data;
      let r = 0, g = 0, b = 0, count = 0;
      for (let i = 0; i < d.length; i += 4) {
        r += d[i];
        g += d[i + 1];
        b += d[i + 2];
        count++;
      }
      if (count > 0) {
        return { r: Math.round(r / count), g: Math.round(g / count), b: Math.round(b / count) };
      }
    } catch (e) {
      // Return null on canvas errors
    }
    return null;
  };

  // Paint a specific coordinate, expanding according to brushSize
  const applyPaintAtCell = (cellX: number, cellY: number) => {
    if (!selectedPaintColor) return;
    setManualEdits((prev) => {
      const newEdits = { ...prev };
      const radius = Math.floor(brushSize / 2);
      const startX = Math.max(0, cellX - radius);
      const endX = Math.min(targetWidthPx - 1, cellX + radius + (brushSize % 2 === 0 ? 1 : 0));
      const startY = Math.max(0, cellY - radius);
      const endY = Math.min(targetHeightPx - 1, cellY + radius + (brushSize % 2 === 0 ? 1 : 0));

      for (let x = startX; x <= endX; x++) {
        for (let y = startY; y <= endY; y++) {
          const key = `${x},${y}`;
          if (selectedPaintColor === "eraser") {
            delete newEdits[key];
          } else {
            newEdits[key] = selectedPaintColor;
          }
        }
      }
      return newEdits;
    });
  };

  // Handle click & drag manual edits on the grid canvas
  const handleGridMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isPaintMode) return;
    setIsDrawing(true);
    const canvas = e.currentTarget;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const cellX = Math.floor((x / rect.width) * targetWidthPx);
    const cellY = Math.floor((y / rect.height) * targetHeightPx);
    if (cellX >= 0 && cellX < targetWidthPx && cellY >= 0 && cellY < targetHeightPx) {
      applyPaintAtCell(cellX, cellY);
    }
  };

  const handleGridMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    handleMouseMove(e, true);
    if (!isPaintMode || !isDrawing) return;
    const canvas = e.currentTarget;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const cellX = Math.floor((x / rect.width) * targetWidthPx);
    const cellY = Math.floor((y / rect.height) * targetHeightPx);
    if (cellX >= 0 && cellX < targetWidthPx && cellY >= 0 && cellY < targetHeightPx) {
      applyPaintAtCell(cellX, cellY);
    }
  };

  const handleGridMouseUp = () => {
    setIsDrawing(false);
  };

  // Automates rotation deskew by scanning image variance at small rotational steps
  const autoAlignImage = () => {
    const img = sourceImageRef.current;
    if (!img) return;
    setIsAutoAligning(true);

    setTimeout(() => {
      const canvas = document.createElement("canvas");
      // Scale down image for ultra-fast contrast evaluation
      const scale = Math.min(1, 200 / Math.max(img.width, img.height));
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        setIsAutoAligning(false);
        return;
      }

      let bestAngle = 0;
      let maxVariance = -1;

      // Scan angles with a step of 0.5 degrees
      for (let angle = -15; angle <= 15; angle += 0.5) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.save();
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate((angle * Math.PI) / 180);
        ctx.drawImage(img, -canvas.width / 2, -canvas.height / 2, canvas.width, canvas.height);
        ctx.restore();

        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const d = imgData.data;

        // Row projection variance (for weft threads)
        const rowSums = new Float32Array(canvas.height);
        for (let y = 0; y < canvas.height; y++) {
          let sum = 0;
          for (let x = 0; x < canvas.width; x++) {
            const idx = (y * canvas.width + x) * 4;
            sum += (d[idx] + d[idx + 1] + d[idx + 2]) / 3;
          }
          rowSums[y] = sum / canvas.width;
        }

        let rowMean = 0;
        for (let y = 0; y < canvas.height; y++) rowMean += rowSums[y];
        rowMean /= canvas.height;

        let rowVar = 0;
        for (let y = 0; y < canvas.height; y++) {
          const diff = rowSums[y] - rowMean;
          rowVar += diff * diff;
        }

        // Column projection variance (for warp threads)
        const colSums = new Float32Array(canvas.width);
        for (let x = 0; x < canvas.width; x++) {
          let sum = 0;
          for (let y = 0; y < canvas.height; y++) {
            const idx = (y * canvas.width + x) * 4;
            sum += (d[idx] + d[idx + 1] + d[idx + 2]) / 3;
          }
          colSums[x] = sum / canvas.height;
        }

        let colMean = 0;
        for (let x = 0; x < canvas.width; x++) colMean += colSums[x];
        colMean /= canvas.width;

        let colVar = 0;
        for (let x = 0; x < canvas.width; x++) {
          const diff = colSums[x] - colMean;
          colVar += diff * diff;
        }

        const totalVariance = rowVar + colVar;
        if (totalVariance > maxVariance) {
          maxVariance = totalVariance;
          bestAngle = angle;
        }
      }

      setParams((p) => ({ ...p, rotation: bestAngle }));
      setIsAutoAligning(false);
    }, 50);
  };

  // Export raw loom indices as an industrial CSV pattern format
  const exportLoomMatrixCSV = () => {
    let csvContent = "data:text/csv;charset=utf-8,";
    const gridCanvas = gridCanvasRef.current;
    if (!gridCanvas) return;
    const ctx = gridCanvas.getContext("2d");
    if (!ctx) return;

    const imgData = ctx.getImageData(0, 0, targetWidthPx, targetHeightPx);
    const d = imgData.data;

    // Create lookup table of hex to palette index
    const colorToIndex: Record<string, number> = {};
    yarns.forEach((y, idx) => {
      colorToIndex[y.hex.toLowerCase()] = idx;
    });

    const rows: string[] = [];
    for (let y = 0; y < targetHeightPx; y++) {
      const rowVals: number[] = [];
      for (let x = 0; x < targetWidthPx; x++) {
        const idx = (y * targetWidthPx + x) * 4;
        const r = d[idx];
        const g = d[idx + 1];
        const b = d[idx + 2];
        const hex = "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).toLowerCase();

        let matchedIdx = colorToIndex[hex];
        if (matchedIdx === undefined) {
          matchedIdx = snapToPalette(r, g, b, yarns).index;
        }
        rowVals.push(matchedIdx);
      }
      rows.push(rowVals.join(","));
    }

    csvContent += rows.join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.href = encodedUri;
    link.download = `woven-label-pattern-matrix-${targetWidthPx}x${targetHeightPx}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Add customized yarn to palette
  const handleAddYarn = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newYarnHex.match(/^#[0-9a-fA-F]{6}$/)) {
      alert("Please provide a valid 6-character hex color (e.g. #FFFFFF)");
      return;
    }
    const name = newYarnName.trim() || `Yarn ${yarns.length + 1}`;
    const newYarn: YarnColor = {
      id: Date.now().toString(),
      hex: newYarnHex,
      name,
      role: newYarnRole,
      isMetallic: newYarnIsMetallic,
    };
    setYarns([...yarns, newYarn]);
    setNewYarnName("");
    setNewYarnIsMetallic(false);
  };

  const removeYarn = (id: string) => {
    if (yarns.length <= 1) {
      alert("You need at least one yarn in the palette to generate a weave reference!");
      return;
    }
    setYarns(yarns.filter((y) => y.id !== id));
  };

  // Lossless export of the final 1:1 Pixel Reference Map
  const exportLosslessImage = (scaledUp: boolean) => {
    const gridCanvas = gridCanvasRef.current;
    if (!gridCanvas) return;

    let exportUrl = "";
    let filename = `woven-label-reference-${specs.widthMm}x${specs.heightMm}mm.png`;

    if (scaledUp) {
      // Export scaled version with optional visible lines
      const scale = 16; // 16x enlargement
      const outCanvas = document.createElement("canvas");
      outCanvas.width = targetWidthPx * scale;
      outCanvas.height = targetHeightPx * scale;
      const ctx = outCanvas.getContext("2d");
      if (ctx) {
        ctx.imageSmoothingEnabled = false;
        // Draw crisp enlarged pixels
        ctx.drawImage(gridCanvas, 0, 0, outCanvas.width, outCanvas.height);

        // Draw grid overlay
        if (showGridOverlay) {
          ctx.strokeStyle = "rgba(100, 116, 139, 0.3)";
          ctx.lineWidth = 1;
          for (let x = 0; x <= outCanvas.width; x += scale) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, outCanvas.height);
            ctx.stroke();
          }
          for (let y = 0; y <= outCanvas.height; y += scale) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(outCanvas.width, y);
            ctx.stroke();
          }
        }
        exportUrl = outCanvas.toDataURL("image/png");
        filename = `woven-label-reference-magnified-${targetWidthPx}x${targetHeightPx}picks.png`;
      }
    } else {
      // Pure 1:1 reference map (perfect for background alignment in MÜCAD)
      exportUrl = gridCanvas.toDataURL("image/png");
    }

    const link = document.createElement("a");
    link.href = exportUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="min-h-screen bg-stone-900 text-stone-100 font-sans selection:bg-[#ff0000] selection:text-white">
      {/* Header Banner */}
      <header className="border-b border-stone-800 bg-stone-950 px-6 py-4 sticky top-0 z-40 backdrop-blur-md bg-opacity-95">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="bg-[#ff0000] text-white p-2 rounded-lg font-bold shadow-lg shadow-red-500/10 flex items-center justify-center">
              <Grid className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-white flex items-center gap-2">
                Woven Label Scan-to-Reference Tool
                <span className="text-[10px] bg-red-500/10 text-red-500 border border-red-500/25 px-1.5 py-0.5 rounded font-mono uppercase">
                  MÜCAD Companion
                </span>
              </h1>
              <p className="text-xs text-stone-400 mt-0.5">
                Turn blurry scans into 1:1 thread-accurate reference templates aligned to real Jacquard loom density specs.
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                setImageSrc(null);
                setLoadedImage(null);
                setSelectedFile(null);
                setAnalysisResult(null);
              }}
              className="text-xs text-stone-400 hover:text-white px-3 py-1.5 rounded-md border border-stone-800 hover:bg-stone-900 transition flex items-center gap-1.5"
            >
              Reset Sandbox
            </button>
            <a
              href="#instructions"
              className="text-xs text-stone-400 hover:text-white px-3 py-1.5 rounded-md bg-stone-900 hover:bg-stone-850 border border-stone-800 transition flex items-center gap-1.5"
            >
              <HelpCircle className="w-3.5 h-3.5 text-[#ff0000]" /> Learn Workflow
            </a>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-6 space-y-6">
        {/* Main Workspace split */}
        {!imageSrc ? (
          /* Empty State: Initial Upload Zone */
          <div className="max-w-3xl mx-auto py-12">
            <div className="text-center space-y-6">
              <div className="inline-flex p-4 rounded-2xl bg-stone-950 border border-stone-800 shadow-xl shadow-stone-950/20 text-[#ff0000] mb-2">
                <Upload className="w-12 h-12" />
              </div>
              <div>
                <h2 className="text-2xl font-bold tracking-tight text-white">Upload Physical Label Scan / Photograph</h2>
                <p className="text-sm text-stone-400 max-w-lg mx-auto mt-2">
                  For optimal results, place label straight on scanner bed or photograph flat under uniform lighting. High DPI is recommended.
                </p>
              </div>

              {/* Drag Drop Area */}
              <div
                onClick={triggerUpload}
                className="border-2 border-dashed border-stone-700 hover:border-red-500 hover:bg-stone-950/40 rounded-xl p-10 cursor-pointer transition-all duration-200 bg-stone-950/20 space-y-4"
              >
                <input
                  type="file"
                  id="label-file-input"
                  accept="image/*"
                  onChange={handleFileChange}
                  className="hidden"
                />
                <div className="flex flex-col items-center justify-center gap-2">
                  <span className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg font-medium text-sm transition shadow-md">
                    Select Scan File
                  </span>
                  <span className="text-xs text-stone-500">or drag and drop your image here</span>
                </div>
              </div>

              {/* Sample file buttons to quickly experience the sandbox */}
              <div className="pt-4 border-t border-stone-800">
                <span className="text-xs text-stone-500 uppercase tracking-wider block mb-3">Or try sandbox demo presets</span>
                <div className="flex flex-wrap items-center justify-center gap-3">
                  <button
                    onClick={() => {
                      // Generate dummy physical-like woven texture matching MÜCAD theme
                      const canvas = document.createElement("canvas");
                      canvas.width = 400;
                      canvas.height = 150;
                      const ctx = canvas.getContext("2d");
                      if (ctx) {
                        // Background pattern: Pure Red
                        ctx.fillStyle = "#ff0000";
                        ctx.fillRect(0, 0, 400, 150);
                        
                        // Weave subtle scan noise lines (darker red/blackish lines)
                        ctx.fillStyle = "rgba(0, 0, 0, 0.12)";
                        for (let i = 0; i < 400; i += 4) {
                          ctx.fillRect(i, 0, 2, 150);
                        }
                        for (let j = 0; j < 150; j += 4) {
                          ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
                          ctx.fillRect(0, j, 400, 2);
                        }

                        // Black border structure
                        ctx.fillStyle = "#000000";
                        ctx.fillRect(10, 10, 380, 6);
                        ctx.fillRect(10, 134, 380, 6);

                        // Draw gear symbol in White (#ffffff)
                        ctx.fillStyle = "#ffffff";
                        ctx.strokeStyle = "#ffffff";
                        ctx.lineWidth = 3;
                        ctx.beginPath();
                        ctx.arc(55, 75, 18, 0, Math.PI * 2);
                        ctx.stroke();
                        // Draw gear teeth
                        for (let a = 0; a < Math.PI * 2; a += Math.PI / 4) {
                          ctx.beginPath();
                          ctx.moveTo(55 + Math.cos(a) * 16, 75 + Math.sin(a) * 16);
                          ctx.lineTo(55 + Math.cos(a) * 24, 75 + Math.sin(a) * 24);
                          ctx.stroke();
                        }
                        // Inner circle of gear
                        ctx.beginPath();
                        ctx.arc(55, 75, 8, 0, Math.PI * 2);
                        ctx.fill();

                        // Müller text block in White (#ffffff)
                        ctx.fillStyle = "#ffffff";
                        ctx.font = "bold 24px 'Space Grotesk', sans-serif";
                        ctx.fillText("Müller Weaving", 95, 74);
                        
                        ctx.font = "italic 11px 'JetBrains Mono', monospace";
                        ctx.fillStyle = "#000000"; // Black subtext/accent
                        ctx.fillText("J. Müller AG Companion Design", 95, 96);

                        // Simulate scanner blur
                        ctx.filter = "blur(1.2px)";
                        ctx.drawImage(canvas, 0, 0);
                      }
                      setImageSrc(canvas.toDataURL());
                      setSpecs({
                        widthMm: 50,
                        heightMm: 20,
                        warpDensity: 80,
                        weftDensity: 60,
                      });
                    }}
                    className="text-xs bg-stone-950 hover:bg-stone-850 text-stone-300 border border-stone-800 px-3.5 py-2 rounded-lg transition hover:text-white"
                  >
                    🏷️ Load Damask Label Scan Mockup
                  </button>

                  <button
                    onClick={() => {
                      // Generate a secondary care label mock
                      const canvas = document.createElement("canvas");
                      canvas.width = 300;
                      canvas.height = 300;
                      const ctx = canvas.getContext("2d");
                      if (ctx) {
                        ctx.fillStyle = "#f3f4f6"; // Off-white cotton scan
                        ctx.fillRect(0, 0, 300, 300);

                        // Faint warp fibers
                        ctx.fillStyle = "rgba(0,0,0,0.02)";
                        for (let x = 0; x < 300; x += 3) {
                          ctx.fillRect(x, 0, 1, 300);
                        }

                        // Care Instructions
                        ctx.fillStyle = "#1f2937";
                        ctx.font = "bold 16px sans-serif";
                        ctx.fillText("100% ORGANIC COTTON", 30, 60);
                        
                        ctx.font = "12px sans-serif";
                        ctx.fillText("MACHINE WASH COLD", 30, 100);
                        ctx.fillText("DO NOT BLEACH", 30, 130);
                        ctx.fillText("TUMBLE DRY LOW", 30, 160);

                        // Draw simple care symbols (square, triangle, etc.)
                        ctx.lineWidth = 2;
                        ctx.strokeStyle = "#1f2937";
                        // Wash symbol basin
                        ctx.beginPath();
                        ctx.moveTo(30, 200);
                        ctx.lineTo(25, 215);
                        ctx.lineTo(55, 215);
                        ctx.lineTo(50, 200);
                        ctx.stroke();

                        // Defocus
                        ctx.filter = "blur(1.2px)";
                        ctx.drawImage(canvas, 0, 0);
                      }
                      setImageSrc(canvas.toDataURL());
                      setSpecs({
                        widthMm: 30,
                        heightMm: 30,
                        warpDensity: 100,
                        weftDensity: 100,
                      });
                    }}
                    className="text-xs bg-stone-950 hover:bg-stone-850 text-stone-300 border border-stone-800 px-3.5 py-2 rounded-lg transition hover:text-white"
                  >
                    🧼 Load Care Instructions Tag
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* Workstation Active Mode */
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            
            {/* LEFT SIDEBAR: Setup & Parameters (Grid & Color Controls) */}
            <div className="lg:col-span-4 space-y-6">
              
              {/* Box 1: Technical Specs (Ground Truth) */}
              <div className="bg-stone-950 border border-stone-800 rounded-xl p-5 space-y-4 shadow-md">
                <div className="flex items-center justify-between border-b border-stone-800 pb-3">
                  <h3 className="text-sm font-semibold tracking-wide text-white uppercase flex items-center gap-2">
                    <Settings className="w-4 h-4 text-red-500" /> 1. Weave Density &amp; Size
                  </h3>
                  <span className="text-[10px] bg-stone-850 text-stone-300 px-1.5 py-0.5 rounded font-mono">
                    Loom Setup
                  </span>
                </div>

                <div className="space-y-4">
                  {/* Physical Dimensions */}
                  <div>
                    <span className="block text-xs font-medium text-stone-300 mb-1.5">Physical Design Area (mm)</span>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] text-stone-500 block mb-0.5 font-mono">WIDTH (X)</label>
                        <div className="relative">
                          <input
                            type="number"
                            value={specs.widthMm}
                            onChange={(e) => setSpecs({ ...specs, widthMm: Math.max(1, parseFloat(e.target.value) || 0) })}
                            className="bg-stone-900 border border-stone-800 rounded px-2 py-1.5 w-full text-sm text-right pr-7 focus:border-red-500 outline-none text-white font-mono"
                          />
                          <span className="absolute right-2 top-2 text-[10px] text-stone-500">mm</span>
                        </div>
                      </div>
                      <div>
                        <label className="text-[10px] text-stone-500 block mb-0.5 font-mono">HEIGHT (Y)</label>
                        <div className="relative">
                          <input
                            type="number"
                            value={specs.heightMm}
                            onChange={(e) => setSpecs({ ...specs, heightMm: Math.max(1, parseFloat(e.target.value) || 0) })}
                            className="bg-stone-900 border border-stone-800 rounded px-2 py-1.5 w-full text-sm text-right pr-7 focus:border-red-500 outline-none text-white font-mono"
                          />
                          <span className="absolute right-2 top-2 text-[10px] text-stone-500">mm</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Density Specs */}
                  <div>
                    <span className="block text-xs font-medium text-stone-300 mb-1.5">Thread Density (per cm)</span>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] text-stone-500 block mb-0.5 font-mono">WARP DENSITY</label>
                        <div className="relative">
                          <input
                            type="number"
                            value={specs.warpDensity}
                            onChange={(e) => setSpecs({ ...specs, warpDensity: Math.max(10, parseInt(e.target.value) || 0) })}
                            className="bg-stone-900 border border-stone-800 rounded px-2 py-1.5 w-full text-sm text-right pr-12 focus:border-red-500 outline-none text-white font-mono"
                          />
                          <span className="absolute right-2 top-2 text-[10px] text-stone-500">ends/cm</span>
                        </div>
                      </div>
                      <div>
                        <label className="text-[10px] text-stone-500 block mb-0.5 font-mono">WEFT DENSITY</label>
                        <div className="relative">
                          <input
                            type="number"
                            value={specs.weftDensity}
                            onChange={(e) => setSpecs({ ...specs, weftDensity: Math.max(10, parseInt(e.target.value) || 0) })}
                            className="bg-stone-900 border border-stone-800 rounded px-2 py-1.5 w-full text-sm text-right pr-12 focus:border-red-500 outline-none text-white font-mono"
                          />
                          <span className="absolute right-2 top-2 text-[10px] text-stone-500">picks/cm</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Calculations breakdown block */}
                  <div className="bg-stone-900 p-3 rounded border border-stone-800/80 space-y-1.5">
                    <span className="text-[10px] font-mono text-red-500 font-semibold block uppercase tracking-wide">
                      Calculated Loom Pixel Map Matrix:
                    </span>
                    <div className="flex justify-between text-xs">
                      <span className="text-stone-400">Total Warp Ends (Width):</span>
                      <span className="font-mono text-white font-semibold">{targetWidthPx} ends</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-stone-400">Total Weft Picks (Height):</span>
                      <span className="font-mono text-white font-semibold">{targetHeightPx} picks</span>
                    </div>
                    <div className="flex justify-between text-xs border-t border-stone-800 pt-1.5 mt-1.5">
                      <span className="text-stone-400">Total Points (Loom Cells):</span>
                      <span className="font-mono text-stone-300">{(targetWidthPx * targetHeightPx).toLocaleString()} cells</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Box 2: Pre-Processing Filters */}
              <div className="bg-stone-950 border border-stone-800 rounded-xl p-5 space-y-4 shadow-md">
                <div className="flex items-center justify-between border-b border-stone-800 pb-3">
                  <h3 className="text-sm font-semibold tracking-wide text-white uppercase flex items-center gap-2">
                    <SlidersHorizontal className="w-4 h-4 text-red-500" /> 2. Image Deskew &amp; Filters
                  </h3>
                  <span className="text-xs text-red-500 cursor-pointer hover:underline" onClick={() => setParams({ brightness: 0, contrast: 0, rotation: 0, denoise: 1, edgeDetect: false, sharpness: 20 })}>
                    Reset
                  </span>
                </div>

                <div className="space-y-4">
                  {/* Rotation Correction */}
                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-stone-300 font-medium">Rotation / Alignment Deskew</span>
                      <span className="font-mono text-red-500 font-semibold">{params.rotation}°</span>
                    </div>
                    <p className="text-[10px] text-stone-500 mb-2">Align warp threads vertically and weft threads horizontally.</p>
                    <div className="flex gap-2 items-center">
                      <input
                        type="range"
                        min="-45"
                        max="45"
                        step="0.5"
                        value={params.rotation}
                        onChange={(e) => setParams({ ...params, rotation: parseFloat(e.target.value) })}
                        className="w-full h-1.5 bg-stone-800 rounded-lg appearance-none cursor-pointer accent-red-600 flex-grow"
                      />
                      <button
                        onClick={autoAlignImage}
                        disabled={isAutoAligning}
                        className="text-[10px] bg-red-600 hover:bg-red-700 disabled:bg-stone-800 disabled:text-stone-500 text-white font-semibold py-1 px-2 rounded shrink-0 transition flex items-center gap-1 shadow-sm"
                        title="Analyze weave patterns to align warp and weft threads automatically"
                      >
                        {isAutoAligning ? (
                          <>
                            <RefreshCw className="w-2.5 h-2.5 animate-spin" /> Aligning...
                          </>
                        ) : (
                          <>
                            <RotateCw className="w-2.5 h-2.5" /> Auto Deskew
                          </>
                        )}
                      </button>
                    </div>
                    <div className="flex justify-between text-[10px] text-stone-600 mt-1">
                      <span>-45°</span>
                      <span>0°</span>
                      <span>45°</span>
                    </div>
                  </div>

                   {/* Brightness */}
                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-stone-300 font-medium">Brightness Correction</span>
                      <span className="font-mono text-stone-400">{params.brightness}%</span>
                    </div>
                    <input
                      type="range"
                      min="-50"
                      max="50"
                      value={params.brightness}
                      onChange={(e) => setParams({ ...params, brightness: parseInt(e.target.value) })}
                      className="w-full h-1.5 bg-stone-800 rounded-lg appearance-none cursor-pointer accent-red-600"
                    />
                  </div>

                  {/* Contrast */}
                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-stone-300 font-medium">Contrast Boost</span>
                      <span className="font-mono text-stone-400">{params.contrast}%</span>
                    </div>
                    <p className="text-[10px] text-stone-500 mb-2">Sharpen boundaries of adjacent thread colors.</p>
                    <input
                      type="range"
                      min="-50"
                      max="70"
                      value={params.contrast}
                      onChange={(e) => setParams({ ...params, contrast: parseInt(e.target.value) })}
                      className="w-full h-1.5 bg-stone-800 rounded-lg appearance-none cursor-pointer accent-red-600"
                    />
                  </div>
                </div>
              </div>

              {/* Box 3: Designer-Curated Yarn Palette */}
              <div className="bg-stone-950 border border-stone-800 rounded-xl p-5 space-y-4 shadow-md">
                <div className="flex items-center justify-between border-b border-stone-800 pb-3">
                  <h3 className="text-sm font-semibold tracking-wide text-white uppercase flex items-center gap-2">
                    <Grid className="w-4 h-4 text-red-500" /> 3. Yarn Palette Snapping
                  </h3>
                  <span className="text-[10px] bg-stone-850 text-stone-300 px-1.5 py-0.5 rounded font-mono">
                    {yarns.length} Colors Active
                  </span>
                </div>

                <p className="text-xs text-stone-400">
                  Weave cells snap automatically to this precise, non-anti-aliased palette using CIELAB distance formula to prevent color bleeding.
                </p>

                {/* Yarn list */}
                <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                  {yarns.map((yarn) => (
                    <div
                      key={yarn.id}
                      className="flex items-center justify-between bg-stone-900 border border-stone-800 p-2.5 rounded-lg text-xs"
                    >
                      <div className="flex items-center gap-2.5">
                        <span
                          className="w-6 h-6 rounded border border-stone-700 block shadow-inner shrink-0"
                          style={{ backgroundColor: yarn.hex }}
                        />
                        <div className="space-y-0.5">
                          <div className="font-semibold text-white flex items-center gap-1.5">
                            {yarn.name}
                            {yarn.isMetallic && (
                              <span className="text-[9px] bg-red-500/20 text-red-300 border border-red-500/30 px-1 rounded font-mono flex items-center gap-0.5">
                                <Sparkle className="w-2.5 h-2.5" /> Lurex
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-stone-400">
                            {yarn.hex.toUpperCase()} • <span className="italic">{yarn.role}</span>
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={() => removeYarn(yarn.id)}
                        className="text-stone-500 hover:text-red-400 p-1 rounded hover:bg-stone-800 transition"
                        title="Delete yarn color"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>

                {/* Add new yarn form */}
                <form onSubmit={handleAddYarn} className="bg-stone-900 border border-stone-800 p-3 rounded-lg space-y-3">
                  <span className="block text-[10px] font-mono text-stone-400 uppercase tracking-wide">Add Custom Yarn Spec:</span>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] text-stone-500 block mb-0.5 font-mono">HEX CODE</label>
                      <div className="flex gap-1.5">
                        <input
                          type="color"
                          value={newYarnHex}
                          onChange={(e) => setNewYarnHex(e.target.value)}
                          className="w-8 h-8 rounded bg-stone-900 border border-stone-700 cursor-pointer p-0 shrink-0"
                        />
                        <input
                          type="text"
                          value={newYarnHex}
                          onChange={(e) => setNewYarnHex(e.target.value)}
                          className="bg-stone-800 border border-stone-700 rounded px-1.5 py-1 text-xs w-full text-white font-mono"
                          placeholder="#000000"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="text-[10px] text-stone-500 block mb-0.5 font-mono">YARN DESIGNATION</label>
                      <input
                        type="text"
                        value={newYarnName}
                        onChange={(e) => setNewYarnName(e.target.value)}
                        className="bg-stone-800 border border-stone-700 rounded px-1.5 py-1 text-xs w-full text-white"
                        placeholder="Red Lurex..."
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <label className="flex items-center gap-1.5 text-xs text-stone-300 cursor-pointer">
                       <input
                        type="checkbox"
                        checked={newYarnIsMetallic}
                        onChange={(e) => setNewYarnIsMetallic(e.target.checked)}
                        className="rounded accent-red-600 bg-stone-800 border-stone-700"
                      />
                      <span>Shiny / Metallic Yarn</span>
                    </label>

                    <button
                      type="submit"
                      className="bg-red-600 hover:bg-red-700 text-white px-2.5 py-1 rounded text-xs font-semibold flex items-center gap-1 transition"
                    >
                      <Plus className="w-3.5 h-3.5" /> Save Yarn
                    </button>
                  </div>
                </form>
              </div>

            </div>

            {/* RIGHT SIDEBAR: Primary Visualization Workspace */}
            <div className="lg:col-span-8 space-y-6">
              
              {/* Box 4: Interactive Live Comparison View */}
              <div className="bg-stone-950 border border-stone-800 rounded-xl p-5 shadow-lg space-y-4 animate-fade-in">
                {(() => {
                  const avgColor = hoveredCell ? getCellAverageColor(hoveredCell.x, hoveredCell.y) : null;
                  let snappedYarnHex = "";
                  let snappedYarnName = "Unknown";
                  let distDeltaE = "";

                  if (hoveredCell && avgColor) {
                    const snap = snapToPalette(avgColor.r, avgColor.g, avgColor.b, yarns);
                    const coordKey = `${hoveredCell.x},${hoveredCell.y}`;
                    const hexToUse = manualEdits[coordKey] || snap.hex;

                    snappedYarnHex = hexToUse;
                    const yarnMatch = yarns.find(y => y.hex.toLowerCase() === hexToUse.toLowerCase());
                    snappedYarnName = yarnMatch ? yarnMatch.name : "Custom Override";

                    const lab1 = rgbToLab(avgColor.r, avgColor.g, avgColor.b);
                    const lab2 = hexToLab(hexToUse);
                    distDeltaE = getDeltaE76(lab1, lab2).toFixed(1);
                  }

                  return (
                    <>
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-stone-800 pb-3">
                        <div className="space-y-0.5">
                          <h3 className="text-sm font-semibold tracking-wide text-white uppercase flex items-center gap-2">
                            <Eye className="w-4 h-4 text-red-500" /> Interactive Digital Thread Inspector
                          </h3>
                          <p className="text-xs text-stone-400">
                            Hovering Synchronizes pixel coords. Scroll or select Zoom to inspect micro weft picks.
                          </p>
                        </div>

                        <div className="flex flex-wrap items-center gap-3">
                          <div className="flex items-center bg-stone-900 border border-stone-800 rounded-lg p-0.5">
                            <button
                              onClick={() => setShowOriginalInComparison(true)}
                              className={`text-xs px-2.5 py-1 rounded-md transition font-medium ${showOriginalInComparison ? "bg-stone-800 text-white" : "text-stone-400 hover:text-white"}`}
                            >
                              Side-by-Side
                            </button>
                            <button
                              onClick={() => setShowOriginalInComparison(false)}
                              className={`text-xs px-2.5 py-1 rounded-md transition font-medium ${!showOriginalInComparison ? "bg-stone-800 text-white" : "text-stone-400 hover:text-white"}`}
                            >
                              Loom Output Only
                            </button>
                          </div>

                          <div className="flex items-center gap-1.5 text-xs text-stone-400">
                            <span>Zoom:</span>
                            <select
                              value={zoomLevel}
                              onChange={(e) => setZoomLevel(parseInt(e.target.value))}
                              className="bg-stone-900 border border-stone-800 rounded text-stone-200 px-2 py-1 outline-none text-xs"
                            >
                              <option value="1">1x (A4 layout)</option>
                              <option value="2">2x</option>
                              <option value="4">4x (Macro)</option>
                              <option value="6">6x</option>
                              <option value="8">8x (Micro Thread)</option>
                              <option value="12">12x (Deep Inspect)</option>
                            </select>
                          </div>
                        </div>
                      </div>

                      {/* Paint/Correction Mode Toolset */}
                      <div className="bg-stone-900 border border-stone-800 rounded-lg p-3 flex flex-wrap items-center justify-between gap-4">
                        <div className="flex flex-wrap items-center gap-3">
                          <button
                            onClick={() => setIsPaintMode(!isPaintMode)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition ${
                              isPaintMode ? "bg-red-600 text-white shadow-md shadow-red-600/20" : "bg-stone-800 hover:bg-stone-750 text-stone-300 hover:text-white"
                            }`}
                          >
                            <Paintbrush className="w-3.5 h-3.5" />
                            {isPaintMode ? "Drawing / Correction Active" : "Enable Manual Correction Brush"}
                          </button>

                          {isPaintMode && (
                            <div className="flex flex-wrap items-center gap-4 border-l border-stone-800 pl-3">
                              <div className="flex items-center gap-1.5 text-xs text-stone-300">
                                <span className="text-[11px] text-stone-400">Brush Color:</span>
                                <div className="flex items-center gap-1">
                                  {yarns.map((yarn) => (
                                    <button
                                      key={yarn.id}
                                      onClick={() => setSelectedPaintColor(yarn.hex)}
                                      className={`w-5 h-5 rounded-full border transition-all ${
                                        selectedPaintColor === yarn.hex ? "scale-125 border-white ring-2 ring-red-500/50" : "border-stone-700 hover:scale-110"
                                      }`}
                                      style={{ backgroundColor: yarn.hex }}
                                      title={`Paint ${yarn.name}`}
                                    />
                                  ))}
                                  <button
                                    onClick={() => setSelectedPaintColor("eraser")}
                                    className={`text-[10px] px-2 py-0.5 rounded border flex items-center gap-1 font-semibold transition-all ${
                                      selectedPaintColor === "eraser" ? "bg-white text-stone-950 border-white" : "border-stone-700 text-stone-400 hover:text-stone-200"
                                    }`}
                                    title="Eraser (restores automatic CIELAB snap)"
                                  >
                                    <Eraser className="w-3 h-3" /> Auto Snap
                                  </button>
                                </div>
                              </div>

                              <div className="flex items-center gap-1.5 text-xs text-stone-400 border-l border-stone-800 pl-3">
                                <span className="text-[11px]">Brush Size:</span>
                                <select
                                  value={brushSize}
                                  onChange={(e) => setBrushSize(parseInt(e.target.value))}
                                  className="bg-stone-950 border border-stone-800 text-stone-200 rounded px-1.5 py-0.5 outline-none text-xs font-mono font-bold"
                                >
                                  <option value="1">1x1 Cell</option>
                                  <option value="2">2x2 Cells</option>
                                  <option value="3">3x3 Cells</option>
                                </select>
                              </div>
                            </div>
                          )}
                        </div>

                        {Object.keys(manualEdits).length > 0 && (
                          <button
                            onClick={() => setManualEdits({})}
                            className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1 transition"
                            title="Clear all manual paint edits and restore standard automatic snaps"
                          >
                            <Trash2 className="w-3.5 h-3.5" /> Clear Edits ({Object.keys(manualEdits).length})
                          </button>
                        )}
                      </div>

                      {/* Render Canvases */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
                        
                        {/* Left canvas: Pre-processed Original */}
                        <div className={`space-y-2 ${showOriginalInComparison ? "block" : "hidden"}`}>
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-stone-300 font-semibold flex items-center gap-1">
                              <span className="w-2 h-2 rounded-full bg-amber-500 block animate-pulse" />
                              Processed Physical Scan Source
                            </span>
                            <span className="text-[10px] text-stone-500 font-mono">Auto-cropped / Rotated</span>
                          </div>
                          
                          <div className="border border-stone-800 rounded-lg overflow-auto bg-stone-900 max-h-[480px] relative p-4 flex items-center justify-center min-h-[220px]">
                            {/* Hidden Source Canvas that retains the actual rotated resolution */}
                            <canvas
                              ref={originalCanvasRef}
                              onMouseMove={(e) => handleMouseMove(e, false)}
                              onMouseLeave={handleMouseLeave}
                              className="max-w-full cursor-crosshair rounded shadow-lg select-none"
                              style={{
                                width: `${targetWidthPx * zoomLevel}px`,
                                height: `${targetHeightPx * zoomLevel}px`,
                                imageRendering: "pixelated",
                              }}
                            />

                            {/* Synced Cursor Hover Box Overlay */}
                            {hoveredCell && (
                              <div
                                className="absolute border border-red-500 pointer-events-none"
                                style={{
                                  width: `${zoomLevel}px`,
                                  height: `${zoomLevel}px`,
                                  left: `calc(50% - ${(targetWidthPx * zoomLevel) / 2}px + ${hoveredCell.x * zoomLevel}px + 16px)`,
                                  top: `calc(50% - ${(targetHeightPx * zoomLevel) / 2}px + ${hoveredCell.y * zoomLevel}px + 16px)`,
                                }}
                              />
                            )}
                          </div>
                        </div>

                        {/* Right Canvas: Thread-Accurate Grid */}
                        <div className={`space-y-2 ${!showOriginalInComparison ? "md:col-span-2" : ""}`}>
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-stone-300 font-semibold flex items-center gap-1">
                              <span className="w-2 h-2 rounded-full bg-green-500 block" />
                              Thread-Accurate Digital Reference Image
                            </span>
                            <label className="flex items-center gap-1 text-[10px] text-stone-400 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={showGridOverlay}
                                onChange={(e) => setShowGridOverlay(e.target.checked)}
                                className="rounded bg-stone-850 border-stone-700 text-red-500 accent-red-500 size-3"
                              />
                              <span>Loom Grid Overlay</span>
                            </label>
                          </div>

                          <div className="border border-stone-800 rounded-lg overflow-auto bg-stone-900 max-h-[480px] relative p-4 flex items-center justify-center min-h-[220px]">
                            <canvas
                              ref={gridCanvasRef}
                              onMouseDown={handleGridMouseDown}
                              onMouseMove={handleGridMouseMove}
                              onMouseUp={handleGridMouseUp}
                              onMouseLeave={() => {
                                handleMouseLeave();
                                handleGridMouseUp();
                              }}
                              className={`max-w-full rounded shadow-lg select-none transition-all ${isPaintMode ? "cursor-cell ring-2 ring-red-500/50" : "cursor-crosshair"}`}
                              style={{
                                width: `${targetWidthPx * zoomLevel}px`,
                                height: `${targetHeightPx * zoomLevel}px`,
                                imageRendering: "pixelated",
                              }}
                            />

                            {/* Render simulated loom wire grid overlay using pure HTML borders over the top if enabled */}
                            {showGridOverlay && (
                              <div
                                className="absolute pointer-events-none"
                                style={{
                                  width: `${targetWidthPx * zoomLevel}px`,
                                  height: `${targetHeightPx * zoomLevel}px`,
                                  backgroundImage: `linear-gradient(to right, rgba(100, 116, 139, 0.25) 1px, transparent 1px),
                                                    linear-gradient(to bottom, rgba(100, 116, 139, 0.25) 1px, transparent 1px)`,
                                  backgroundSize: `${zoomLevel}px ${zoomLevel}px`,
                                }}
                              />
                            )}

                            {/* Hover Overlay cell details */}
                            {hoveredCell && (
                              <div
                                className="absolute border border-green-400 pointer-events-none"
                                style={{
                                  width: `${zoomLevel}px`,
                                  height: `${zoomLevel}px`,
                                  left: `calc(50% - ${(targetWidthPx * zoomLevel) / 2}px + ${hoveredCell.x * zoomLevel}px + 16px)`,
                                  top: `calc(50% - ${(targetHeightPx * zoomLevel) / 2}px + ${hoveredCell.y * zoomLevel}px + 16px)`,
                                }}
                              />
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Coordinate synchronization readout */}
                      <div className="bg-stone-900 border border-stone-800 p-3 rounded-lg flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs text-stone-300">
                        <div className="space-y-1">
                          {hoveredCell ? (
                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                              <span className="font-mono text-white">
                                Loom Point: <strong className="text-red-500">Warp End {hoveredCell.x + 1}</strong>, <strong className="text-red-500">Weft Pick {hoveredCell.y + 1}</strong>
                              </span>
                              
                              {/* Manual override status badge */}
                              {manualEdits[`${hoveredCell.x},${hoveredCell.y}`] && (
                                <span className="bg-red-500/10 text-red-400 border border-red-500/20 px-1.5 py-0.5 rounded text-[10px] font-mono">
                                  ✍️ Manually Edited
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-stone-500 italic">Hover mouse cursor over weave cells to inspect points</span>
                          )}

                          {hoveredCell && avgColor && (
                            <div className="flex flex-wrap items-center gap-3 text-[11px] pt-1">
                              <div className="flex items-center gap-1.5 bg-stone-950 px-2 py-1 rounded border border-stone-800">
                                <span className="text-stone-400">Scanned:</span>
                                <span className="w-3.5 h-3.5 rounded-sm border border-stone-750" style={{ backgroundColor: `rgb(${avgColor.r}, ${avgColor.g}, ${avgColor.b})` }} />
                                <span className="font-mono text-stone-300">rgb({avgColor.r},{avgColor.g},{avgColor.b})</span>
                              </div>
                              <span className="text-stone-600">➔</span>
                              <div className="flex items-center gap-1.5 bg-stone-950 px-2 py-1 rounded border border-stone-800">
                                <span className="text-stone-400">Snapped Yarn:</span>
                                <span className="w-3.5 h-3.5 rounded-sm border border-stone-750" style={{ backgroundColor: snappedYarnHex }} />
                                <span className="text-stone-200 font-semibold">{snappedYarnName}</span>
                                <span className="font-mono text-stone-500">({snappedYarnHex})</span>
                              </div>
                              
                              <div className="flex items-center gap-1 bg-stone-950 px-2 py-1 rounded border border-stone-800">
                                <span className="text-stone-400">Color Distance:</span>
                                <span className="font-mono font-bold text-white">ΔE {distDeltaE}</span>
                                {parseFloat(distDeltaE) < 2.0 ? (
                                  <span className="text-[10px] text-green-400 bg-green-500/10 px-1 rounded">Excellent Match</span>
                                ) : parseFloat(distDeltaE) < 5.0 ? (
                                  <span className="text-[10px] text-yellow-400 bg-yellow-500/10 px-1 rounded">Good Match</span>
                                ) : (
                                  <span className="text-[10px] text-amber-500 bg-amber-500/10 px-1 rounded font-medium">Loose Fit</span>
                                )}
                              </div>
                            </div>
                          )}
                        </div>

                        <div className="flex gap-2 shrink-0 md:self-end">
                          <span className="font-mono text-[10px] text-stone-500 bg-stone-950 border border-stone-850 px-2 py-1 rounded">
                            W: {targetWidthPx} ends x H: {targetHeightPx} picks
                          </span>
                        </div>
                      </div>

                      {/* Exporters and quick save buttons */}
                      <div className="flex flex-wrap items-center justify-between gap-4 pt-3 border-t border-stone-800">
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            onClick={() => exportLosslessImage(false)}
                            className="bg-red-600 hover:bg-red-700 text-white px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition shadow"
                          >
                            <Download className="w-3.5 h-3.5" /> Download MÜCAD Background (1:1 Pixels PNG)
                          </button>
                          
                          <button
                            onClick={() => exportLosslessImage(true)}
                            className="bg-stone-800 hover:bg-stone-750 text-white px-3 py-1.5 rounded-lg text-xs font-medium border border-stone-700 flex items-center gap-1.5 transition"
                          >
                            <Download className="w-3.5 h-3.5 text-stone-400" /> Export Magnified Technical Sheet
                          </button>

                          <button
                            onClick={exportLoomMatrixCSV}
                            className="bg-stone-800 hover:bg-stone-750 text-white px-3 py-1.5 rounded-lg text-xs font-medium border border-stone-700 flex items-center gap-1.5 transition"
                            title="Download the full grid matrix as a CSV file of yarn indices for loom programming"
                          >
                            <FileSpreadsheet className="w-3.5 h-3.5 text-stone-400" /> Export Pattern Indices (CSV)
                          </button>
                        </div>

                        <div className="text-stone-500 text-[10px] italic">
                          PNG exports lossless indexed backgrounds. CSV exports warp/weft matrices.
                        </div>
                      </div>
                    </>
                  );
                })()}
              </div>

              {/* Box 5: Gemini scan analyzer card */}
              <div className="bg-stone-950 border border-stone-800 rounded-xl p-5 shadow-lg space-y-4">
                <div className="flex items-center justify-between border-b border-stone-800 pb-3">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-red-500" />
                    <div>
                      <h4 className="text-sm font-semibold text-white uppercase">
                        AI Label Analysis Assistant
                      </h4>
                      <p className="text-[10px] text-stone-400">
                        Scan threads with computer vision to calculate density &amp; extract palette.
                      </p>
                    </div>
                  </div>

                  <button
                    onClick={runCloudAnalysis}
                    disabled={analyzing}
                    className="bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5"
                  >
                    {analyzing ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Counting Threads...
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-3.5 h-3.5" /> Analyze Scan With AI
                      </>
                    )}
                  </button>
                </div>

                {analysisResult ? (
                  <div className="space-y-4 text-xs">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div className="bg-stone-900 border border-stone-800 p-3 rounded-lg">
                        <span className="text-[10px] font-mono text-red-500 uppercase">Estimated Weave Type</span>
                        <p className="text-sm font-bold text-white mt-0.5">{analysisResult.weaveType}</p>
                      </div>
                      <div className="bg-stone-900 border border-stone-800 p-3 rounded-lg">
                        <span className="text-[10px] font-mono text-red-500 uppercase">Suggested Dimensions</span>
                        <p className="text-sm font-bold text-white mt-0.5">
                          {analysisResult.estimatedWidthMm}mm × {analysisResult.estimatedHeightMm}mm
                        </p>
                      </div>
                      <div className="bg-stone-900 border border-stone-800 p-3 rounded-lg">
                        <span className="text-[10px] font-mono text-red-500 uppercase">Estimated Warp x Weft</span>
                        <p className="text-sm font-bold text-white mt-0.5">
                          {analysisResult.estimatedWarpDensity} ends × {analysisResult.estimatedWeftDensity} picks
                        </p>
                      </div>
                    </div>

                    <div className="bg-stone-900 border border-stone-800 p-3.5 rounded-lg space-y-2">
                      <span className="text-[10px] font-mono text-red-500 uppercase tracking-wide block">
                        Professional MÜCAD Loom Programming Advice:
                      </span>
                      <ul className="space-y-1.5 pl-4 list-disc text-stone-300">
                        {analysisResult.mucadAdvice.map((advice, i) => (
                          <li key={i}>{advice}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                ) : (
                  <div className="bg-stone-900 border border-stone-800 p-4 rounded-lg flex items-center gap-3.5 text-xs text-stone-400">
                    <Info className="w-5 h-5 text-red-500 shrink-0" />
                    <div>
                      <p className="font-semibold text-stone-300">AI Thread Analysis Available</p>
                      <p className="text-[11px] text-stone-400 mt-0.5">
                        Click &apos;Analyze Scan With AI&apos; to query Gemini 3.5. It will estimate physical label dimensions, warp/weft spacing, and output precise MÜCAD setup specifications automatically.
                      </p>
                    </div>
                  </div>
                )}
              </div>

            </div>

          </div>
        )}

        {/* Info & Learning workflow section at the bottom */}
        <section id="instructions" className="bg-stone-950 border border-stone-800 rounded-xl p-6 space-y-4 shadow-xl">
          <div className="flex items-center gap-2 border-b border-stone-800 pb-3">
            <Info className="w-5 h-5 text-red-500" />
            <h3 className="text-sm font-semibold text-white uppercase tracking-wider">
              Designer Reference &amp; MÜCAD Integration Guide
            </h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-xs text-stone-300">
            <div className="space-y-2">
              <h4 className="font-bold text-white flex items-center gap-1">
                <span className="text-red-500">01.</span> Setup Loom Density
              </h4>
              <p className="text-stone-400 leading-relaxed">
                Before uploading, measure the physical label with calipers to get exact length and width in millimeters. Refer to your Jakob Müller machine layout card for the active Warp (ends/cm) and Weft (picks/cm) density specs. Enter these values into the first box.
              </p>
            </div>
            <div className="space-y-2">
              <h4 className="font-bold text-white flex items-center gap-1">
                <span className="text-red-500">02.</span> Align and Snap
              </h4>
              <p className="text-stone-400 leading-relaxed">
                Rotate the scanned fabric using the deskew slider until individual threads are oriented strictly vertical and horizontal. The applet will resample the image into a pixel matrix matching the thread count, snapping colors to your selected yarn palette.
              </p>
            </div>
            <div className="space-y-2">
              <h4 className="font-bold text-white flex items-center gap-1">
                <span className="text-red-500">03.</span> Export &amp; Trace
              </h4>
              <p className="text-stone-400 leading-relaxed">
                Download the 1:1 pixel PNG reference map. Because it lacks blurry borders and contains only solid index colors, you can set it directly as the background tracing template layer in your MÜCAD Basic/Mini workspace. No more manual magnifying glass guesswork!
              </p>
            </div>
          </div>
        </section>
      </main>

      {/* Footer copyright */}
      <footer className="border-t border-stone-800 bg-stone-950 py-8 px-6 text-center text-xs text-stone-500 mt-12">
        <p>© 2026 Woven Label Scan-to-Reference Tool. Built for Jakob Müller MÜCAD designers.</p>
        <p className="mt-1">Designed with desktop precision to eliminate repetitive magnification strain.</p>
      </footer>
    </div>
  );
}
