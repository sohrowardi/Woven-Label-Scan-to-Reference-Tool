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
  FileSpreadsheet,
  Github,
  ZoomIn,
  ZoomOut,
  AlertCircle,
  X
} from "lucide-react";
import { YarnColor, ImageParams, TechSpecs, AnalysisResult } from "./types";
import { snapToPalette, rgbToLab, hexToLab, getDeltaE76 } from "./utils/color";
import { JacquardWeaveSimulator } from "./components/JacquardWeaveSimulator";

const DEFAULT_YARNS: YarnColor[] = [
  { id: "1", hex: "#ff0000", name: "Red", role: "Background Pattern", isMetallic: false },
  { id: "2", hex: "#ffffff", name: "White", role: "Gear symbol & Müller text", isMetallic: false },
  { id: "3", hex: "#000000", name: "Black", role: "Structure/Border", isMetallic: false },
];

const ensureSvgDimensions = (svgString: string): string => {
  let clean = svgString.trim();
  if (clean.includes("```xml")) {
    clean = clean.split("```xml")[1].split("```")[0].trim();
  } else if (clean.includes("```html")) {
    clean = clean.split("```html")[1].split("```")[0].trim();
  } else if (clean.includes("```")) {
    clean = clean.split("```")[1].split("```")[0].trim();
  }

  const svgStartIndex = clean.indexOf("<svg");
  if (svgStartIndex !== -1) {
    clean = clean.substring(svgStartIndex);
  }

  const viewBoxMatch = clean.match(/viewBox=["']\s*(-?[0-9.]+)(?:[\s,]+(-?[0-9.]+))(?:[\s,]+(-?[0-9.]+))(?:[\s,]+(-?[0-9.]+))\s*["']/i);
  let w = "800";
  let h = "600";
  if (viewBoxMatch && viewBoxMatch[3] && viewBoxMatch[4]) {
    w = viewBoxMatch[3];
    h = viewBoxMatch[4];
  }

  // Remove any existing width and height attributes to avoid percentage conflicts
  clean = clean.replace(/<svg([^>]*)\bwidth\s*=\s*["'][^"']*["']/gi, '<svg$1');
  clean = clean.replace(/<svg([^>]*)\bheight\s*=\s*["'][^"']*["']/gi, '<svg$1');

  // Enforce absolute pixel width and height attributes based on viewBox
  clean = clean.replace(/<svg([^>]*)/i, (match, attrs) => {
    return `<svg width="${w}" height="${h}"${attrs}`;
  });

  // Ensure xmlns is present so it renders correctly as image
  if (!clean.includes("xmlns=")) {
    clean = clean.replace(/<svg([^>]*)/i, (match, attrs) => {
      return `<svg xmlns="http://www.w3.org/2000/svg"${attrs}`;
    });
  }

  return clean;
};

const sanitizeSvgForCanvas = (svgString: string): string => {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgString, "image/svg+xml");
    
    // Check if there are any parsing errors
    const parserError = doc.querySelector("parsererror");
    if (parserError) {
      console.warn("SVG Parsing error during sanitization, falling back to regex.");
      return svgString
        .replace(/@import[^;]+;/gi, "")
        .replace(/@font-face\s*\{[^}]*\}/gi, "")
        .replace(/<link[^>]+>/gi, "")
        .replace(/<image[^>]+href=["']http[^"']+["'][^>]*>/gi, "");
    }

    // 1. Strip external stylesheets/links
    const links = doc.querySelectorAll("link");
    links.forEach(link => link.remove());

    // 2. Strip external fonts and imports in style elements
    const styles = doc.querySelectorAll("style");
    styles.forEach(style => {
      let content = style.textContent || "";
      // Strip imports (with or without url(), single/double/no quotes)
      content = content.replace(/@import[^;]+;/gi, "");
      // Strip font-faces pointing to external files
      content = content.replace(/@font-face\s*\{[^}]*\}/gi, "");
      style.textContent = content;
    });

    // 3. Strip external images
    const images = doc.querySelectorAll("image");
    images.forEach(img => {
      const href = img.getAttribute("href") || img.getAttribute("xlink:href") || "";
      if (href.startsWith("http://") || href.startsWith("https://")) {
        img.remove();
      }
    });

    const serializer = new XMLSerializer();
    return serializer.serializeToString(doc);
  } catch (err) {
    console.error("DOMParser sanitization failed:", err);
    return svgString
      .replace(/@import[^;]+;/gi, "")
      .replace(/@font-face\s*\{[^}]*\}/gi, "")
      .replace(/<link[^>]+>/gi, "")
      .replace(/<image[^>]+href=["']http[^"']+["'][^>]*>/gi, "");
  }
};

const renderSvgToCanvas = (svgString: string, canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D) => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgString, "image/svg+xml");
  const svg = doc.querySelector("svg");
  if (!svg) return;

  const viewBoxAttr = svg.getAttribute("viewBox");
  let viewW = canvas.width;
  let viewH = canvas.height;
  if (viewBoxAttr) {
    const parts = viewBoxAttr.trim().split(/[\s,]+/);
    if (parts.length === 4) {
      viewW = parseFloat(parts[2]);
      viewH = parseFloat(parts[3]);
    }
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  ctx.save();
  ctx.scale(canvas.width / viewW, canvas.height / viewH);

  const renderElement = (el: Element, parentFill = "none", parentStroke = "none", parentStrokeWidth = 1) => {
    const tagName = el.tagName.toLowerCase();
    
    ctx.save();

    const transform = el.getAttribute("transform");
    if (transform) {
      const translateMatch = transform.match(/translate\(\s*(-?[0-9.]+)\s*[\s,]+\s*(-?[0-9.]+)\s*\)/);
      if (translateMatch) {
        ctx.translate(parseFloat(translateMatch[1]), parseFloat(translateMatch[2]));
      }
      const rotateMatch = transform.match(/rotate\(\s*(-?[0-9.]+)\s*\)/);
      if (rotateMatch) {
        ctx.rotate((parseFloat(rotateMatch[1]) * Math.PI) / 180);
      }
    }

    const localFill = el.getAttribute("fill");
    const fill = localFill !== null ? localFill : parentFill;

    const localStroke = el.getAttribute("stroke");
    const stroke = localStroke !== null ? localStroke : parentStroke;

    const localStrokeWidth = el.getAttribute("stroke-width");
    const strokeWidth = localStrokeWidth !== null ? parseFloat(localStrokeWidth) : parentStrokeWidth;

    if (tagName === "rect") {
      const x = parseFloat(el.getAttribute("x") || "0");
      const y = parseFloat(el.getAttribute("y") || "0");
      const w = parseFloat(el.getAttribute("width") || "0");
      const h = parseFloat(el.getAttribute("height") || "0");
      
      if (fill !== "none") {
        ctx.fillStyle = fill;
        ctx.fillRect(x, y, w, h);
      }
      if (stroke !== "none") {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = strokeWidth;
        ctx.strokeRect(x, y, w, h);
      }
    } else if (tagName === "circle") {
      const cx = parseFloat(el.getAttribute("cx") || "0");
      const cy = parseFloat(el.getAttribute("cy") || "0");
      const r = parseFloat(el.getAttribute("r") || "0");
      
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, 2 * Math.PI);
      if (fill !== "none") {
        ctx.fillStyle = fill;
        ctx.fill();
      }
      if (stroke !== "none") {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = strokeWidth;
        ctx.stroke();
      }
    } else if (tagName === "polygon") {
      const pointsAttr = el.getAttribute("points");
      if (pointsAttr) {
        const coords = pointsAttr.trim().split(/[\s,]+/).map(parseFloat);
        if (coords.length >= 4) {
          ctx.beginPath();
          ctx.moveTo(coords[0], coords[1]);
          for (let i = 2; i < coords.length; i += 2) {
            ctx.lineTo(coords[i], coords[i + 1]);
          }
          ctx.closePath();
          if (fill !== "none") {
            ctx.fillStyle = fill;
            ctx.fill();
          }
          if (stroke !== "none") {
            ctx.strokeStyle = stroke;
            ctx.lineWidth = strokeWidth;
            ctx.stroke();
          }
        }
      }
    } else if (tagName === "path") {
      const d = el.getAttribute("d");
      if (d) {
        const path = new Path2D(d);
        if (fill !== "none") {
          ctx.fillStyle = fill;
          ctx.fill(path);
        }
        if (stroke !== "none") {
          ctx.strokeStyle = stroke;
          ctx.lineWidth = strokeWidth;
          ctx.stroke(path);
        }
      }
    } else if (tagName === "text") {
      const x = parseFloat(el.getAttribute("x") || "0");
      const y = parseFloat(el.getAttribute("y") || "0");
      const text = el.textContent || "";
      
      const fontSize = el.getAttribute("font-size") || "12px";
      const fontFamily = el.getAttribute("font-family") || "sans-serif";
      const fontWeight = el.getAttribute("font-weight") || "normal";
      
      ctx.font = `${fontWeight} ${fontSize.includes("px") ? fontSize : fontSize + "px"} ${fontFamily}`;
      
      const textAnchor = el.getAttribute("text-anchor") || "start";
      if (textAnchor === "middle") {
        ctx.textAlign = "center";
      } else if (textAnchor === "end") {
        ctx.textAlign = "right";
      } else {
        ctx.textAlign = "left";
      }
      
      if (fill !== "none") {
        ctx.fillStyle = fill;
        ctx.fillText(text, x, y);
      }
      if (stroke !== "none") {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = strokeWidth;
        ctx.strokeText(text, x, y);
      }
    } else if (tagName === "g") {
      Array.from(el.children).forEach(child => renderElement(child, fill, stroke, strokeWidth));
    }

    ctx.restore();
  };

  Array.from(svg.children).forEach(child => renderElement(child));
  ctx.restore();
};

const drawSvgDirectlyToCanvas = (svgString: string, targetCanvas: HTMLCanvasElement, targetCtx: CanvasRenderingContext2D, dx: number, dy: number, dw: number, dh: number) => {
  const offscreen = document.createElement("canvas");
  offscreen.width = dw;
  offscreen.height = dh;
  const offscreenCtx = offscreen.getContext("2d");
  if (!offscreenCtx) return;

  renderSvgToCanvas(svgString, offscreen, offscreenCtx);
  targetCtx.drawImage(offscreen, dx, dy, dw, dh);
};

export default function App() {
  // State
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [rawImageSrc, setRawImageSrc] = useState<string | null>(null);
  const [cropConfirmed, setCropConfirmed] = useState<boolean>(false);
  const [cropRotation, setCropRotation] = useState<number>(0);
  const [cropLeft, setCropLeft] = useState<number>(0);
  const [cropRight, setCropRight] = useState<number>(0);
  const [cropTop, setCropTop] = useState<number>(0);
  const [cropBottom, setCropBottom] = useState<number>(0);
  const [cornerTL, setCornerTL] = useState<{ x: number; y: number }>({ x: 10, y: 10 });
  const [cornerTR, setCornerTR] = useState<{ x: number; y: number }>({ x: 90, y: 10 });
  const [cornerBR, setCornerBR] = useState<{ x: number; y: number }>({ x: 90, y: 90 });
  const [cornerBL, setCornerBL] = useState<{ x: number; y: number }>({ x: 10, y: 90 });
  const [activeHandle, setActiveHandle] = useState<"tl" | "tr" | "br" | "bl" | null>(null);
  const [rawLoadedImage, setRawLoadedImage] = useState<HTMLImageElement | null>(null);
  const [loadedImage, setLoadedImage] = useState<HTMLImageElement | null>(null);
  const [originalDimensions, setOriginalDimensions] = useState<{ width: number; height: number } | null>(null);
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

  const setNumberOfYarns = (count: number) => {
    if (count <= 0) return;
    if (yarns.length === count) return;
    if (count < yarns.length) {
      setYarns(yarns.slice(0, count));
    } else {
      const extraPresets = [
        { hex: "#0000ff", name: "Royal Blue", role: "Design Details" },
        { hex: "#00ff00", name: "Bright Green", role: "Leaf/Logo Accent" },
        { hex: "#ffff00", name: "Loom Yellow", role: "Text Accent" },
        { hex: "#ff00ff", name: "Magenta Pink", role: "Brand Pattern" },
        { hex: "#ff8c00", name: "Orange", role: "Stripe Element" },
        { hex: "#8a2be2", name: "Purple", role: "Pattern Overlay" },
      ];
      const needed = count - yarns.length;
      const newYarnsList = [...yarns];
      for (let i = 0; i < needed; i++) {
        const preset = extraPresets[i % extraPresets.length];
        const uniqueId = String(Date.now() + i + Math.floor(Math.random() * 1000));
        newYarnsList.push({
          id: uniqueId,
          hex: preset.hex,
          name: preset.name,
          role: preset.role,
          isMetallic: false
        });
      }
      setYarns(newYarnsList);
    }
  };

  // Zooming & Viewing Controls
  const [zoomLevel, setZoomLevel] = useState<number>(4);
  const [showGridOverlay, setShowGridOverlay] = useState<boolean>(true);
  const [showOriginalInComparison, setShowOriginalInComparison] = useState<boolean>(true);
  
  // Toast Notification states
  const [toast, setToast] = useState<{ message: string; type: "error" | "success" | "info" } | null>(null);

  const showToast = (message: string, type: "error" | "success" | "info" = "error") => {
    setToast({ message, type });
    // Keep error/quota alerts visible for 10 seconds or until manually closed
    setTimeout(() => {
      setToast((current) => current?.message === message ? null : current);
    }, 10000);
  };
  
  // Manual Grid Calibration / Sub-Pixel Nudging States
  const [gridNudgeX, setGridNudgeX] = useState<number>(0);
  const [gridNudgeY, setGridNudgeY] = useState<number>(0);
  const [gridNudgeScaleX, setGridNudgeScaleX] = useState<number>(100);
  const [gridNudgeScaleY, setGridNudgeScaleY] = useState<number>(100);
  
  // Interactive coordinate synchronization
  const [hoveredCell, setHoveredCell] = useState<{ x: number; y: number } | null>(null);

  // Manual Loom Painting Overrides
  const [isPaintMode, setIsPaintMode] = useState<boolean>(false);
  const [selectedPaintColor, setSelectedPaintColor] = useState<string>("");
  const [manualEdits, setManualEdits] = useState<Record<string, string>>({});
  const [isDrawing, setIsDrawing] = useState<boolean>(false);
  const [brushSize, setBrushSize] = useState<number>(1);
  const [isAutoAligning, setIsAutoAligning] = useState<boolean>(false);
  const [isAutoDetecting, setIsAutoDetecting] = useState<boolean>(false);

  // AI Artwork Reconstruction & Vector Refinement States
  const [rawCroppedImageSrc, setRawCroppedImageSrc] = useState<string | null>(null);
  const [reconstructedSvg, setReconstructedSvg] = useState<string | null>(null);
  const [reconstructedImage, setReconstructedImage] = useState<HTMLImageElement | null>(null);
  const [isReconstructing, setIsReconstructing] = useState<boolean>(false);
  const [useReconstructedSource, setUseReconstructedSource] = useState<boolean>(false);
  const [detectedFonts, setDetectedFonts] = useState<string[]>([]);
  const [reconstructReasoning, setReconstructReasoning] = useState<string>("");

  // Tool-specific Gemini Intelligence States
  const [palettePrompt, setPalettePrompt] = useState<string>("");
  const [isGeneratingPalette, setIsGeneratingPalette] = useState<boolean>(false);

  const [isApplyingFilterPreset, setIsApplyingFilterPreset] = useState<boolean>(false);

  const [loomQuery, setLoomQuery] = useState<string>("");
  const [isCalculatingSpecs, setIsCalculatingSpecs] = useState<boolean>(false);
  const [loomAdvice, setLoomAdvice] = useState<string[]>([]);
  const [loomReasoning, setLoomReasoning] = useState<string>("");

  const [paintInstruction, setPaintInstruction] = useState<string>("");
  const [isProcessingPaint, setIsProcessingPaint] = useState<boolean>(false);
  const [paintReasoning, setPaintReasoning] = useState<string>("");

  const [refinementPrompt, setRefinementPrompt] = useState<string>("");

  const handleGeneratePalette = async () => {
    if (!palettePrompt.trim()) return;
    setIsGeneratingPalette(true);
    try {
      const response = await fetch("/api/generate-palette", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: palettePrompt,
          currentPalette: yarns,
        }),
      });
      if (!response.ok) {
        throw new Error("Failed to generate custom palette");
      }
      const data = await response.json();
      if (data.yarnPalette && data.yarnPalette.length > 0) {
        const newYarns: YarnColor[] = data.yarnPalette.map((y: any, idx: number) => ({
          id: `ai-gen-${idx}-${Date.now()}`,
          hex: y.hex,
          name: y.name,
          role: y.role,
          isMetallic: y.role.toLowerCase().includes("shiny") || y.role.toLowerCase().includes("metallic") || y.role.toLowerCase().includes("lurex"),
        }));
        setYarns(newYarns);
        setSelectedPaintColor(newYarns[0].hex);
        setPalettePrompt("");
      }
    } catch (err: any) {
      console.error(err);
      showToast(`Palette Generation failed: ${err.message}`, "error");
    } finally {
      setIsGeneratingPalette(false);
    }
  };

  const handleApplyFilterPreset = async (presetName: string) => {
    setIsApplyingFilterPreset(true);
    try {
      const response = await fetch("/api/ai-filter-preset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          base64Image: imageSrc || undefined,
          mimeType: "image/png",
          presetName,
        }),
      });
      if (!response.ok) {
        throw new Error("Failed to load filter preset");
      }
      const data = await response.json();
      setParams({
        brightness: data.brightness ?? params.brightness,
        contrast: data.contrast ?? params.contrast,
        sharpness: data.sharpness ?? params.sharpness,
        denoise: data.denoise ?? params.denoise,
        edgeDetect: !!data.edgeDetect,
        rotation: params.rotation,
      });
    } catch (err: any) {
      console.error(err);
      showToast(`Failed to apply filter preset: ${err.message}`, "error");
    } finally {
      setIsApplyingFilterPreset(false);
    }
  };

  const handleCalculateLoomSpecs = async () => {
    if (!loomQuery.trim()) return;
    setIsCalculatingSpecs(true);
    try {
      const response = await fetch("/api/ai-loom-specs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentSpecs: specs,
          query: loomQuery,
          base64Image: imageSrc || undefined,
          mimeType: "image/png",
        }),
      });
      if (!response.ok) {
        throw new Error("Failed to calculate specs");
      }
      const data = await response.json();
      setSpecs({
        widthMm: data.widthMm ?? specs.widthMm,
        heightMm: data.heightMm ?? specs.heightMm,
        warpDensity: data.warpDensity ?? specs.warpDensity,
        weftDensity: data.weftDensity ?? specs.weftDensity,
      });
      setLoomAdvice(data.advice || []);
      setLoomReasoning(data.reasoning || "");
      setLoomQuery("");
    } catch (err: any) {
      console.error(err);
      showToast(`AI Loom Specs consultant failed: ${err.message}`, "error");
    } finally {
      setIsCalculatingSpecs(false);
    }
  };

  const handleApplyPaintCopilot = async () => {
    if (!paintInstruction.trim()) return;
    setIsProcessingPaint(true);
    setPaintReasoning("");
    try {
      const response = await fetch("/api/ai-paint-copilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          width: targetWidthPx,
          height: targetHeightPx,
          paletteColors: yarns,
          instruction: paintInstruction,
        }),
      });
      if (!response.ok) {
        throw new Error("Failed to process drawing instruction");
      }
      const data = await response.json();
      setPaintReasoning(data.reasoning || "");
      if (data.edits && data.edits.length > 0) {
        setManualEdits((prev) => {
          const newEdits = { ...prev };
          data.edits.forEach((edit: any) => {
            const key = `${edit.x},${edit.y}`;
            if (edit.hex === "eraser") {
              delete newEdits[key];
            } else {
              newEdits[key] = edit.hex;
            }
          });
          return newEdits;
        });
        setPaintInstruction("");
      } else {
        showToast("Gemini did not suggest any coordinates to edit. Try to rephrase your request.", "info");
      }
    } catch (err: any) {
      console.error(err);
      showToast(`AI Paint Copilot failed: ${err.message}`, "error");
    } finally {
      setIsProcessingPaint(false);
    }
  };

  const handleAiReconstruct = async () => {
    if (!imageSrc) return;
    setIsReconstructing(true);
    setReconstructReasoning("");
    try {
      // Send raw cropped image data URL (fallback to imageSrc)
      const base64Image = rawCroppedImageSrc || imageSrc;
      const response = await fetch("/api/reconstruct-artwork", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          base64Image,
          mimeType: "image/png",
          paletteColors: yarns,
          refinementPrompt: refinementPrompt.trim() || undefined,
        }),
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || "Failed to reconstruct label artwork.");
      }

      const data = await response.json();
      if (!data.cleanSvg) {
        throw new Error("Invalid response from AI reconstruction service.");
      }

      const processedSvg = ensureSvgDimensions(data.cleanSvg);
      const canvasSvg = sanitizeSvgForCanvas(processedSvg);

      setReconstructedSvg(processedSvg);
      setDetectedFonts(data.detectedFonts || []);
      setReconstructReasoning(data.reasoning || "");

      // Convert clean, self-contained SVG string to HTML Image
      const svgBlob = new Blob([canvasSvg], { type: "image/svg+xml;charset=utf-8" });
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.src = reader.result as string;
        img.onload = () => {
          setReconstructedImage(img);
          setUseReconstructedSource(true);
          setIsReconstructing(false);
        };
        img.onerror = () => {
          console.error("Failed to load generated SVG as an Image.");
          setIsReconstructing(false);
          showToast("Error rendering reconstructed SVG artwork. Please try again.", "error");
        };
      };
      reader.readAsDataURL(svgBlob);
    } catch (err: any) {
      console.error("AI Reconstruction Error:", err);
      showToast(`AI Reconstruction failed: ${err.message}`, "error");
      setIsReconstructing(false);
    }
  };

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
  
  // Performance caching for mousemove coordinate inspector
  const cellAveragesRef = useRef<Record<string, { r: number; g: number; b: number }>>({});

  // Helper function to downscale extremely large images before processing, preventing NetworkError payloads and saving tokens
  const resizeImageIfNeeded = (dataUrl: string, maxDimension: number = 1200): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.src = dataUrl;
      img.onload = () => {
        const width = img.width;
        const height = img.height;
        if (width <= maxDimension && height <= maxDimension) {
          resolve(dataUrl);
          return;
        }
        
        let newWidth = width;
        let newHeight = height;
        if (width > height) {
          if (width > maxDimension) {
            newHeight = Math.round((height * maxDimension) / width);
            newWidth = maxDimension;
          }
        } else {
          if (height > maxDimension) {
            newWidth = Math.round((width * maxDimension) / height);
            newHeight = maxDimension;
          }
        }
        
        const canvas = document.createElement("canvas");
        canvas.width = newWidth;
        canvas.height = newHeight;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(img, 0, 0, newWidth, newHeight);
          // Compress as JPEG to keep the payload size extremely small (usually ~10x-20x smaller than PNG)
          resolve(canvas.toDataURL("image/jpeg", 0.85));
        } else {
          resolve(dataUrl);
        }
      };
      img.onerror = () => {
        resolve(dataUrl);
      };
    });
  };

  // Process selected file (read, resize if needed, and initialize crop states)
  const processAndSetFile = (file: File) => {
    setSelectedFile(file);
    const reader = new FileReader();
    reader.onload = (event) => {
      if (event.target?.result) {
        const resultStr = event.target.result as string;
        resizeImageIfNeeded(resultStr).then((processedSrc) => {
          setRawImageSrc(processedSrc);
          setCropConfirmed(false);
          setCropRotation(0);
          setCropLeft(0);
          setCropRight(0);
          setCropTop(0);
          setCropBottom(0);
          setCornerTL({ x: 10, y: 10 });
          setCornerTR({ x: 90, y: 10 });
          setCornerBR({ x: 90, y: 90 });
          setCornerBL({ x: 10, y: 90 });
        });
      }
    };
    reader.readAsDataURL(file);
  };

  // Handle file uploads
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      processAndSetFile(e.target.files[0]);
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
      showToast(`AI Analysis Error: ${err.message}`, "error");
    } finally {
      setAnalyzing(false);
    }
  };

  // Automatically detect background and text colors from cropped label image
  const autoDetectColors = (img: HTMLImageElement) => {
    try {
      const canvas = document.createElement("canvas");
      // Scale down for lightning-fast analysis
      const maxDim = 120;
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const d = imgData.data;

      // Map color groups (by quantizing 8-bit RGB channels to bins of 16)
      const colorMap: Record<string, { r: number; g: number; b: number; count: number }> = {};
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 200) continue; // skip transparent/semi-transparent
        const r = d[i];
        const g = d[i + 1];
        const b = d[i + 2];
        
        const qr = Math.floor(r / 16) * 16 + 8;
        const qg = Math.floor(g / 16) * 16 + 8;
        const qb = Math.floor(b / 16) * 16 + 8;
        const key = `${qr},${qg},${qb}`;
        
        if (!colorMap[key]) {
          colorMap[key] = { r, g, b, count: 0 };
        }
        colorMap[key].count++;
      }

      const sortedColors = Object.values(colorMap).sort((a, b) => b.count - a.count);

      if (sortedColors.length >= 2) {
        // Most common quantized color is our background color
        const bg = sortedColors[0];
        
        // Find a high-contrast foreground (text/pattern) color
        let textColor = sortedColors[1];
        let maxDist = 0;
        
        // Search the top 12 most frequent colors to find a high-contrast match
        for (let i = 1; i < Math.min(sortedColors.length, 12); i++) {
          const c = sortedColors[i];
          const dist = Math.pow(c.r - bg.r, 2) + Math.pow(c.g - bg.g, 2) + Math.pow(c.b - bg.b, 2);
          if (dist > maxDist && dist > 12000) {
            maxDist = dist;
            textColor = c;
          }
        }

        // Try to find a third accent color that differs significantly from both
        let accentColor = sortedColors[2] || sortedColors[1];
        let maxAccentDist = 0;
        for (let i = 1; i < Math.min(sortedColors.length, 20); i++) {
          const c = sortedColors[i];
          if (c === textColor || c === bg) continue;
          const distToBg = Math.pow(c.r - bg.r, 2) + Math.pow(c.g - bg.g, 2) + Math.pow(c.b - bg.b, 2);
          const distToText = Math.pow(c.r - textColor.r, 2) + Math.pow(c.g - textColor.g, 2) + Math.pow(c.b - textColor.b, 2);
          if (distToBg > 8000 && distToText > 8000 && distToBg + distToText > maxAccentDist) {
            maxAccentDist = distToBg + distToText;
            accentColor = c;
          }
        }

        const componentToHex = (c: number) => {
          const hex = Math.max(0, Math.min(255, Math.round(c))).toString(16);
          return hex.length === 1 ? "0" + hex : hex;
        };
        const rgbToHex = (r: number, g: number, b: number) => {
          return "#" + componentToHex(r) + componentToHex(g) + componentToHex(b);
        };

        const bgHex = rgbToHex(bg.r, bg.g, bg.b);
        const textHex = rgbToHex(textColor.r, textColor.g, textColor.b);
        const accentHex = rgbToHex(accentColor.r, accentColor.g, accentColor.b);

        const detectedYarns: YarnColor[] = [
          { id: "1", hex: bgHex, name: "Scanned Background", role: "Auto Background", isMetallic: false },
          { id: "2", hex: textHex, name: "Scanned Text", role: "Auto Foreground Text/Pattern", isMetallic: false },
        ];

        // If there's a third distinct color, add it as an accent
        const finalAccentDistToBg = Math.pow(accentColor.r - bg.r, 2) + Math.pow(accentColor.g - bg.g, 2) + Math.pow(accentColor.b - bg.b, 2);
        if (finalAccentDistToBg > 9000 && accentHex !== textHex && accentHex !== bgHex) {
          detectedYarns.push({ id: "3", hex: accentHex, name: "Scanned Accent", role: "Auto Secondary Accent", isMetallic: false });
        } else {
          // Fallback to a clear neutral/black/white if we only had 2 main colors
          const neutralHex = bgHex.toLowerCase() === "#ffffff" ? "#000000" : "#ffffff";
          detectedYarns.push({ id: "3", hex: neutralHex, name: "Neutral Accent", role: "Structure/Border", isMetallic: false });
        }

        setYarns(detectedYarns);
        setSelectedPaintColor(detectedYarns[0].hex);
      }
    } catch (e) {
      console.error("Error auto-detecting color palette:", e);
    }
  };

  // 1. Asynchronously load imageSrc into loadedImage state
  useEffect(() => {
    if (!imageSrc) {
      setLoadedImage(null);
      setOriginalDimensions(null);
      return;
    }
    const img = new Image();
    img.src = imageSrc;
    img.onload = () => {
      setLoadedImage(img);
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      setOriginalDimensions({ width: w, height: h });
      
      // Default specs to match original image dimensions exactly
      setSpecs({
        widthMm: w / 10,
        heightMm: h / 10,
        warpDensity: 100,
        weftDensity: 100,
      });

      // Automatically extract background and text colors from cropped label image
      autoDetectColors(img);
    };
  }, [imageSrc]);

  const cropPreviewCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // 1b. Asynchronously load rawImageSrc into rawLoadedImage state
  useEffect(() => {
    if (!rawImageSrc) {
      setRawLoadedImage(null);
      return;
    }
    const img = new Image();
    img.src = rawImageSrc;
    img.onload = () => {
      setRawLoadedImage(img);
    };
  }, [rawImageSrc]);

  // 1c. Redraw crop preview whenever rawLoadedImage, cropRotation, or corner pins change
  useEffect(() => {
    const canvas = cropPreviewCanvasRef.current;
    const img = rawLoadedImage;
    if (!canvas || !img) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rad = (cropRotation * Math.PI) / 180;
    const absCos = Math.abs(Math.cos(rad));
    const absSin = Math.abs(Math.sin(rad));
    const rotatedW = Math.round(img.width * absCos + img.height * absSin);
    const rotatedH = Math.round(img.width * absSin + img.height * absCos);

    canvas.width = rotatedW;
    canvas.height = rotatedH;

    // Draw rotated image
    ctx.clearRect(0, 0, rotatedW, rotatedH);
    ctx.save();
    ctx.translate(rotatedW / 2, rotatedH / 2);
    ctx.rotate(rad);
    ctx.drawImage(img, -img.width / 2, -img.height / 2);
    ctx.restore();

    // Map percentage corners to absolute pixels on the rotated canvas
    const p0 = { x: (cornerTL.x / 100) * rotatedW, y: (cornerTL.y / 100) * rotatedH };
    const p1 = { x: (cornerTR.x / 100) * rotatedW, y: (cornerTR.y / 100) * rotatedH };
    const p2 = { x: (cornerBR.x / 100) * rotatedW, y: (cornerBR.y / 100) * rotatedH };
    const p3 = { x: (cornerBL.x / 100) * rotatedW, y: (cornerBL.y / 100) * rotatedH };

    // 1. Draw Semi-transparent outer mask
    ctx.fillStyle = "rgba(0, 0, 0, 0.65)";
    ctx.beginPath();
    // Outer rect (clockwise)
    ctx.moveTo(0, 0);
    ctx.lineTo(rotatedW, 0);
    ctx.lineTo(rotatedW, rotatedH);
    ctx.lineTo(0, rotatedH);
    ctx.closePath();

    // Inner quad (counter-clockwise) to carve out the window
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p3.x, p3.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.closePath();

    ctx.fill();

    // 2. Draw outer boundary of the perspective quad (red with white outline glow)
    ctx.strokeStyle = "rgba(255, 255, 255, 0.4)";
    ctx.lineWidth = Math.max(4, Math.round(rotatedW / 200));
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.lineTo(p3.x, p3.y);
    ctx.closePath();
    ctx.stroke();

    ctx.strokeStyle = "#ef4444"; // high-contrast tailwind red-500
    ctx.lineWidth = Math.max(2, Math.round(rotatedW / 400));
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.lineTo(p3.x, p3.y);
    ctx.closePath();
    ctx.stroke();

    // 3. Draw Perspective-aligned guiding grid inside the quad
    ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
    ctx.lineWidth = Math.max(1, Math.round(rotatedW / 800));
    ctx.beginPath();
    
    // Vertical grid lines
    const gridCols = 12;
    for (let i = 1; i < gridCols; i++) {
      const u = i / gridCols;
      const tx = p0.x + (p1.x - p0.x) * u;
      const ty = p0.y + (p1.y - p0.y) * u;
      const bx = p3.x + (p2.x - p3.x) * u;
      const by = p3.y + (p2.y - p3.y) * u;
      ctx.moveTo(tx, ty);
      ctx.lineTo(bx, by);
    }
    
    // Horizontal grid lines
    const gridRows = 8;
    for (let j = 1; j < gridRows; j++) {
      const v = j / gridRows;
      const lx = p0.x + (p3.x - p0.x) * v;
      const ly = p0.y + (p3.y - p0.y) * v;
      const rx = p1.x + (p2.x - p1.x) * v;
      const ry = p1.y + (p2.y - p1.y) * v;
      ctx.moveTo(lx, ly);
      ctx.lineTo(rx, ry);
    }
    ctx.stroke();

    // 4. Draw interactive visual markers for corners on the canvas
    const drawCornerMarker = (pt: { x: number; y: number }) => {
      const radius = Math.max(7, Math.round(rotatedW / 100));
      ctx.fillStyle = "#ef4444";
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, radius, 0, 2 * Math.PI);
      ctx.fill();
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(pt.x, pt.y, radius / 2, 0, 2 * Math.PI);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
    };

    drawCornerMarker(p0);
    drawCornerMarker(p1);
    drawCornerMarker(p2);
    drawCornerMarker(p3);

  }, [rawLoadedImage, cropRotation, cornerTL, cornerTR, cornerBR, cornerBL]);

  const handleConfirmCrop = () => {
    const img = rawLoadedImage;
    if (!img) return;

    const rad = (cropRotation * Math.PI) / 180;
    const absCos = Math.abs(Math.cos(rad));
    const absSin = Math.abs(Math.sin(rad));
    const rotatedW = Math.round(img.width * absCos + img.height * absSin);
    const rotatedH = Math.round(img.width * absSin + img.height * absCos);

    const rotCanvas = document.createElement("canvas");
    rotCanvas.width = rotatedW;
    rotCanvas.height = rotatedH;
    const rotCtx = rotCanvas.getContext("2d");
    if (!rotCtx) return;

    rotCtx.translate(rotatedW / 2, rotatedH / 2);
    rotCtx.rotate(rad);
    rotCtx.drawImage(img, -img.width / 2, -img.height / 2);
    rotCtx.rotate(-rad);
    rotCtx.translate(-rotatedW / 2, -rotatedH / 2);

    // Compute absolute pixel coordinates for the 4 corners on the rotated image
    const p0 = { x: (cornerTL.x / 100) * rotatedW, y: (cornerTL.y / 100) * rotatedH };
    const p1 = { x: (cornerTR.x / 100) * rotatedW, y: (cornerTR.y / 100) * rotatedH };
    const p2 = { x: (cornerBR.x / 100) * rotatedW, y: (cornerBR.y / 100) * rotatedH };
    const p3 = { x: (cornerBL.x / 100) * rotatedW, y: (cornerBL.y / 100) * rotatedH };

    // Estimate target width and height of the warped rectangle (rectified label)
    const widthTop = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    const widthBottom = Math.hypot(p2.x - p3.x, p2.y - p3.y);
    let cropW = Math.max(10, Math.round((widthTop + widthBottom) / 2));

    const heightLeft = Math.hypot(p3.x - p0.x, p3.y - p0.y);
    const heightRight = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    let cropH = Math.max(10, Math.round((heightLeft + heightRight) / 2));

    // Limit maximum cropped dimension to 1200px to ensure fast, reliable AI processing
    // and prevent NetworkError payloads
    const maxCropDim = 1200;
    if (cropW > maxCropDim || cropH > maxCropDim) {
      if (cropW > cropH) {
        cropH = Math.round((cropH * maxCropDim) / cropW);
        cropW = maxCropDim;
      } else {
        cropW = Math.round((cropW * maxCropDim) / cropH);
        cropH = maxCropDim;
      }
    }

    const cropCanvas = document.createElement("canvas");
    cropCanvas.width = cropW;
    cropCanvas.height = cropH;
    const cropCtx = cropCanvas.getContext("2d");
    if (!cropCtx) return;

    // Get source image data for bilinear projection
    const rotImgData = rotCtx.getImageData(0, 0, rotatedW, rotatedH);
    const rotData = rotImgData.data;

    const cropImgData = cropCtx.createImageData(cropW, cropH);
    const cropData = cropImgData.data;

    // Backward bilinear mapping for perspective & warp correction
    for (let dy = 0; dy < cropH; dy++) {
      const v = dy / (cropH - 1 || 1);
      for (let dx = 0; dx < cropW; dx++) {
        const u = dx / (cropW - 1 || 1);

        // Bilinear interpolation formula
        const sx = (1 - u) * (1 - v) * p0.x + u * (1 - v) * p1.x + u * v * p2.x + (1 - u) * v * p3.x;
        const sy = (1 - u) * (1 - v) * p0.y + u * (1 - v) * p1.y + u * v * p2.y + (1 - u) * v * p3.y;

        // Bilinear interpolation from 4 neighboring pixels for high-quality antialiasing
        const xL = Math.floor(sx);
        const xR = Math.min(rotatedW - 1, xL + 1);
        const yT = Math.floor(sy);
        const yB = Math.min(rotatedH - 1, yT + 1);

        const weightX = sx - xL;
        const weightY = sy - yT;

        const idxTL = (yT * rotatedW + xL) * 4;
        const idxTR = (yT * rotatedW + xR) * 4;
        const idxBL = (yB * rotatedW + xL) * 4;
        const idxBR = (yB * rotatedW + xR) * 4;

        const dstIdx = (dy * cropW + dx) * 4;

        if (xL >= 0 && xL < rotatedW && yT >= 0 && yT < rotatedH) {
          // Bilinear blend of red, green, blue channels
          for (let channel = 0; channel < 4; channel++) {
            const valTL = rotData[idxTL + channel];
            const valTR = rotData[idxTR + channel];
            const valBL = rotData[idxBL + channel];
            const valBR = rotData[idxBR + channel];

            const valTop = valTL + weightX * (valTR - valTL);
            const valBottom = valBL + weightX * (valBR - valBL);
            const blendedVal = valTop + weightY * (valBottom - valTop);

            cropData[dstIdx + channel] = blendedVal;
          }
        } else {
          // Default fallback color (pure white)
          cropData[dstIdx] = 255;
          cropData[dstIdx + 1] = 255;
          cropData[dstIdx + 2] = 255;
          cropData[dstIdx + 3] = 255;
        }
      }
    }

    cropCtx.putImageData(cropImgData, 0, 0);

    const croppedDataUrl = cropCanvas.toDataURL("image/png");
    setImageSrc(croppedDataUrl);
    setRawCroppedImageSrc(croppedDataUrl);
    setReconstructedSvg(null);
    setReconstructedImage(null);
    setUseReconstructedSource(false);
    setCropConfirmed(true);
  };

  // Edge-detection based contour fallback
  const runContourEdgeHeuristic = () => {
    const img = rawLoadedImage;
    if (!img) return;

    try {
      const canvas = document.createElement("canvas");
      const scale = Math.min(1, 300 / Math.max(img.width, img.height));
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const d = imgData.data;
      const w = canvas.width;
      const h = canvas.height;

      // Grayscale conversion
      const gray = new Uint8Array(w * h);
      for (let i = 0; i < d.length; i += 4) {
        gray[i / 4] = Math.round(d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114);
      }

      // Compute edge intensity gradients
      const edges = new Uint8Array(w * h);
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const idx = y * w + x;
          const gx = gray[idx + 1] - gray[idx - 1];
          const gy = gray[idx + w] - gray[idx - w];
          edges[idx] = Math.min(255, Math.sqrt(gx * gx + gy * gy));
        }
      }

      const cx = w / 2;
      const cy = h / 2;

      const findEdgeOnLine = (startX: number, startY: number, endX: number, endY: number) => {
        const steps = 120;
        for (let i = 0; i < steps; i++) {
          const t = i / steps;
          const x = Math.round(startX + (endX - startX) * t);
          const y = Math.round(startY + (endY - startY) * t);
          if (x < 0 || x >= w || y < 0 || y >= h) continue;
          
          const idx = y * w + x;
          if (edges[idx] > 30) {
            return { x: (x / w) * 100, y: (y / h) * 100 };
          }
        }
        return null;
      };

      const tl = findEdgeOnLine(w * 0.05, h * 0.05, cx, cy) || { x: 12, y: 12 };
      const tr = findEdgeOnLine(w * 0.95, h * 0.05, cx, cy) || { x: 88, y: 12 };
      const br = findEdgeOnLine(w * 0.95, h * 0.95, cx, cy) || { x: 88, y: 88 };
      const bl = findEdgeOnLine(w * 0.05, h * 0.95, cx, cy) || { x: 12, y: 88 };

      if (Math.abs(tr.x - tl.x) > 15 && Math.abs(br.y - tr.y) > 15) {
        setCornerTL(tl);
        setCornerTR(tr);
        setCornerBR(br);
        setCornerBL(bl);
      } else {
        setCornerTL({ x: 10, y: 10 });
        setCornerTR({ x: 90, y: 10 });
        setCornerBR({ x: 90, y: 90 });
        setCornerBL({ x: 10, y: 90 });
      }
    } catch (err) {
      console.error("Contour edge heuristic fallback failed:", err);
    }
  };

  // Automatic Cloud AI Scan for Yarn Palette & Tech Specs on initial upload
  const runCloudAnalysisOnUpload = async (overrideSrc?: string) => {
    const srcToUse = overrideSrc || rawImageSrc;
    if (!srcToUse) return;
    setAnalyzing(true);
    try {
      const response = await fetch("/api/analyze-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          base64Image: srcToUse,
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
        if (newYarns.length > 0) {
          setSelectedPaintColor(newYarns[0].hex);
        }
      }
    } catch (err: any) {
      console.warn("AI Yarn Palette & Spec detection failed:", err);
    } finally {
      setAnalyzing(false);
    }
  };

  // Unified AI-powered auto-detection of borders, thread angle, rotation, skew & perspective
  const autoDetectAndStraighten = async (overrideSrc?: string) => {
    const srcToUse = overrideSrc || rawImageSrc;
    if (!srcToUse) return;
    setIsAutoDetecting(true);

    try {
      const response = await fetch("/api/auto-detect-straighten", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          base64Image: srcToUse,
          mimeType: selectedFile?.type || "image/png"
        }),
      });

      if (!response.ok) {
        throw new Error(`Server returned status ${response.status}`);
      }

      const data = await response.json();
      if (data && data.topLeft && data.topRight && data.bottomRight && data.bottomLeft) {
        setCornerTL(data.topLeft);
        setCornerTR(data.topRight);
        setCornerBR(data.bottomRight);
        setCornerBL(data.bottomLeft);
        if (typeof data.rotationAngle === "number") {
          setCropRotation(data.rotationAngle);
        }
      } else {
        throw new Error("Invalid response format from AI auto-detect & straighten");
      }
    } catch (err) {
      console.warn("AI Auto-Detect & Straighten failed, running heuristic fallbacks:", err);
      // Run both heuristic fallbacks
      runContourEdgeHeuristic();
      runRotationVarianceHeuristic();
    } finally {
      setIsAutoDetecting(false);
    }
  };

  // Smart AI-powered auto-detection of label quad boundaries (retained for fallback)
  const autoDetectLabelQuad = async () => {
    if (!rawImageSrc) return;
    setIsAutoDetecting(true);

    try {
      const response = await fetch("/api/detect-borders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base64Image: rawImageSrc }),
      });

      if (!response.ok) {
        throw new Error(`Server returned status ${response.status}`);
      }

      const data = await response.json();
      if (data && data.topLeft && data.topRight && data.bottomRight && data.bottomLeft) {
        setCornerTL(data.topLeft);
        setCornerTR(data.topRight);
        setCornerBR(data.bottomRight);
        setCornerBL(data.bottomLeft);
      } else {
        throw new Error("Invalid response format from AI detection");
      }
    } catch (err) {
      console.warn("AI label border detection failed, running edge heuristic fallback:", err);
      runContourEdgeHeuristic();
    } finally {
      setIsAutoDetecting(false);
    }
  };

  // Trigger automatic AI analysis & straightening once raw image loads
  useEffect(() => {
    if (rawLoadedImage && rawImageSrc) {
      // Trigger both in parallel for a seamless automatic upload pipeline
      autoDetectAndStraighten(rawImageSrc);
      runCloudAnalysisOnUpload(rawImageSrc);
    }
  }, [rawLoadedImage]);

  // Texture-variance based rotation fallback
  const runRotationVarianceHeuristic = () => {
    const img = rawLoadedImage;
    if (!img) return;

    setTimeout(() => {
      const canvas = document.createElement("canvas");
      const scale = Math.min(1, 200 / Math.max(img.width, img.height));
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      let bestAngle = 0;
      let maxVariance = -1;

      for (let angle = -15; angle <= 15; angle += 0.5) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.save();
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate((angle * Math.PI) / 180);
        ctx.drawImage(img, -canvas.width / 2, -canvas.height / 2, canvas.width, canvas.height);
        ctx.restore();

        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const d = imgData.data;

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

      setCropRotation(bestAngle);
    }, 50);
  };

  // Smart AI-powered thread angle straightening
  const autoAlignRaw = async () => {
    if (!rawImageSrc) return;
    setIsAutoAligning(true);

    try {
      const response = await fetch("/api/detect-thread-angle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base64Image: rawImageSrc }),
      });

      if (!response.ok) {
        throw new Error(`Server returned status ${response.status}`);
      }

      const data = await response.json();
      if (data && typeof data.rotationAngle === "number") {
        setCropRotation(data.rotationAngle);
      } else {
        throw new Error("Invalid response format from AI straightening");
      }
    } catch (err) {
      console.warn("AI thread angle alignment failed, running variance heuristic fallback:", err);
      runRotationVarianceHeuristic();
    } finally {
      setIsAutoAligning(false);
    }
  };

  // 2. Render whenever loadedImage, reconstructedImage, useReconstructedSource, params, specs, yarns, manualEdits, or grid nudge settings change
  useEffect(() => {
    if (!loadedImage) return;
    sourceImageRef.current = useReconstructedSource && reconstructedImage ? reconstructedImage : loadedImage;
    renderProcessedOriginal();
  }, [loadedImage, reconstructedImage, useReconstructedSource, params, specs, yarns, manualEdits, gridNudgeX, gridNudgeY, gridNudgeScaleX, gridNudgeScaleY]);

  // Render the pre-processed canvas
  const renderProcessedOriginal = () => {
    const img = sourceImageRef.current;
    const canvas = originalCanvasRef.current;
    if (!img || !canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    try {
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

      // Only apply brightness/contrast filters to physical scans.
      // Skipping them for pristine, flat-colored vector reconstructions preserves crisp edges.
      if (!useReconstructedSource) {
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
      }

      // After processing original image, compile the thread-level grid representation
      renderThreadGrid();
    } catch (err) {
      console.error("Error rendering processed original image canvas:", err);
      // Fallback: draw image directly
      try {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        renderThreadGrid();
      } catch (fallbackErr) {
        console.error("Critical fallback failure:", fallbackErr);
      }
    }
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

    let sourceData: Uint8ClampedArray | null = null;
    let actualW = origW;
    let actualH = origH;
    let actualCellW = cellW;
    let actualCellH = cellH;

    try {
      sourceData = origCtx.getImageData(0, 0, origW, origH).data;
    } catch (err) {
      console.warn("Failed to read pixels from canvas (likely cross-origin taint on SVG). Falling back to original image scan source:", err);
      try {
        if (loadedImage) {
          origCanvas.width = loadedImage.width;
          origCanvas.height = loadedImage.height;
          origCtx.clearRect(0, 0, loadedImage.width, loadedImage.height);
          origCtx.drawImage(loadedImage, 0, 0);
          
          sourceData = origCtx.getImageData(0, 0, loadedImage.width, loadedImage.height).data;
          actualW = loadedImage.width;
          actualH = loadedImage.height;
          actualCellW = loadedImage.width / targetWidthPx;
          actualCellH = loadedImage.height / targetHeightPx;
          
          // Disable reconstructed source so further actions don't crash
          setUseReconstructedSource(false);
          showToast("Notice: Browser security restricted reading pixels from the SVG artwork. Automatically fell back to original scan for grid tracing.", "info");
        }
      } catch (fallbackErr) {
        console.error("Critical fallback failure:", fallbackErr);
      }
    }

    if (!sourceData) {
      for (let i = 0; i < gridData.length; i += 4) {
        gridData[i] = 255;
        gridData[i + 1] = 255;
        gridData[i + 2] = 255;
        gridData[i + 3] = 255;
      }
      gridCtx.putImageData(gridImgData, 0, 0);
      return;
    }

    const newAverages: Record<string, { r: number; g: number; b: number }> = {};

    // Calculate scaling and offset based on nudge parameters
    const scaleXFactor = gridNudgeScaleX / 100;
    const scaleYFactor = gridNudgeScaleY / 100;
    const offsetW = actualW * (1 - scaleXFactor) / 2;
    const offsetH = actualH * (1 - scaleYFactor) / 2;

    const rescaledW = actualW * scaleXFactor;
    const rescaledH = actualH * scaleYFactor;

    const scaledCellW = rescaledW / targetWidthPx;
    const scaledCellH = rescaledH / targetHeightPx;

    for (let gy = 0; gy < targetHeightPx; gy++) {
      for (let gx = 0; gx < targetWidthPx; gx++) {
        // Pixel bounding box inside original source canvas, with nudge shifting and scale adjustment
        const startX = Math.max(0, Math.min(actualW, Math.floor(offsetW + gx * scaledCellW + gridNudgeX)));
        const endX = Math.max(0, Math.min(actualW, Math.floor(offsetW + (gx + 1) * scaledCellW + gridNudgeX)));
        const startY = Math.max(0, Math.min(actualH, Math.floor(offsetH + gy * scaledCellH + gridNudgeY)));
        const endY = Math.max(0, Math.min(actualH, Math.floor(offsetH + (gy + 1) * scaledCellH + gridNudgeY)));

        let sumR = 0;
        let sumG = 0;
        let sumB = 0;
        let count = 0;

        for (let py = startY; py < endY; py++) {
          for (let px = startX; px < endX; px++) {
            const idx = (py * actualW + px) * 4;
            sumR += sourceData[idx];
            sumG += sourceData[idx + 1];
            sumB += sourceData[idx + 2];
            count++;
          }
        }

        // Compute average color of this thread block
        const avgR = count > 0 ? Math.round(sumR / count) : 255;
        const avgG = count > 0 ? Math.round(sumG / count) : 255;
        const avgB = count > 0 ? Math.round(sumB / count) : 255;

        newAverages[`${gx},${gy}`] = { r: avgR, g: avgG, b: avgB };

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

    cellAveragesRef.current = newAverages;
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
    const key = `${gx},${gy}`;
    if (cellAveragesRef.current && cellAveragesRef.current[key]) {
      return cellAveragesRef.current[key];
    }

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

  // Get color at a specific coordinate for 3D Jacquard fabric simulation
  const getCellColor = (x: number, y: number): string => {
    const key = `${x},${y}`;
    if (manualEdits[key]) return manualEdits[key];
    if (cellAveragesRef.current && cellAveragesRef.current[key]) {
      const { r, g, b } = cellAveragesRef.current[key];
      return snapToPalette(r, g, b, yarns).hex;
    }
    return yarns[0]?.hex || "#ffffff";
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
      showToast("Please provide a valid 6-character hex color (e.g. #FFFFFF)", "error");
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
      showToast("You need at least one yarn in the palette to generate a weave reference!", "error");
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

  const handleCanvasPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = cropPreviewCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;

    // Find the closest handle within 15% distance
    const distTL = Math.hypot(x - cornerTL.x, y - cornerTL.y);
    const distTR = Math.hypot(x - cornerTR.x, y - cornerTR.y);
    const distBR = Math.hypot(x - cornerBR.x, y - cornerBR.y);
    const distBL = Math.hypot(x - cornerBL.x, y - cornerBL.y);

    const minDist = Math.min(distTL, distTR, distBR, distBL);
    if (minDist < 15) {
      if (minDist === distTL) setActiveHandle("tl");
      else if (minDist === distTR) setActiveHandle("tr");
      else if (minDist === distBR) setActiveHandle("br");
      else if (minDist === distBL) setActiveHandle("bl");
      canvas.setPointerCapture(e.pointerId);
    }
  };

  const handleCanvasPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!activeHandle) return;
    const canvas = cropPreviewCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
    const y = Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100));

    if (activeHandle === "tl") setCornerTL({ x, y });
    else if (activeHandle === "tr") setCornerTR({ x, y });
    else if (activeHandle === "br") setCornerBR({ x, y });
    else if (activeHandle === "bl") setCornerBL({ x, y });
  };

  const handleCanvasPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!activeHandle) return;
    const canvas = cropPreviewCanvasRef.current;
    if (canvas) {
      canvas.releasePointerCapture(e.pointerId);
    }
    setActiveHandle(null);
  };

  return (
    <div className="min-h-screen bg-stone-900 text-stone-100 font-sans selection:bg-[#ff0000] selection:text-white">
      {/* Floating Toast Notification */}
      {toast && (
        <div className="fixed top-6 right-6 z-50 max-w-md bg-stone-950 border border-stone-800 rounded-xl shadow-2xl shadow-black/80 animate-in fade-in slide-in-from-top-4 duration-300 overflow-hidden">
          <div className="p-4 flex gap-3 items-start">
            <div className={`p-1.5 rounded-lg shrink-0 ${
              toast.type === "error" 
                ? "bg-red-500/15 text-red-500" 
                : toast.type === "success"
                ? "bg-emerald-500/15 text-emerald-500"
                : "bg-blue-500/15 text-blue-500"
            }`}>
              {toast.type === "error" ? (
                <AlertCircle className="w-5 h-5" />
              ) : (
                <Check className="w-5 h-5" />
              )}
            </div>
            
            <div className="flex-1 space-y-1">
              <h4 className="text-sm font-semibold text-white">
                {toast.type === "error" ? "Notification Alert" : toast.type === "success" ? "Success" : "Information"}
              </h4>
              <p className="text-xs leading-relaxed text-stone-300 whitespace-pre-line">
                {toast.message}
              </p>
            </div>

            <button
              onClick={() => setToast(null)}
              className="p-1 hover:bg-stone-900 rounded-lg text-stone-400 hover:text-white transition shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

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
                setOriginalDimensions(null);
                setSelectedFile(null);
                setAnalysisResult(null);
                setRawImageSrc(null);
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
        {!rawImageSrc ? (
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
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                    processAndSetFile(e.dataTransfer.files[0]);
                  }
                }}
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
                      setRawImageSrc(canvas.toDataURL());
                      setCropConfirmed(false);
                      setCropRotation(0);
                      setCornerTL({ x: 10, y: 10 });
                      setCornerTR({ x: 90, y: 10 });
                      setCornerBR({ x: 90, y: 90 });
                      setCornerBL({ x: 10, y: 90 });
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
                      setRawImageSrc(canvas.toDataURL());
                      setCropConfirmed(false);
                      setCropRotation(0);
                      setCornerTL({ x: 10, y: 10 });
                      setCornerTR({ x: 90, y: 10 });
                      setCornerBR({ x: 90, y: 90 });
                      setCornerBL({ x: 10, y: 90 });
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
        ) : !cropConfirmed ? (
          /* Step 1: Crop and Alignment Screen */
          <div className="bg-stone-950 border border-stone-800 rounded-2xl p-6 shadow-xl space-y-6">
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between border-b border-stone-800 pb-4 gap-4">
              <div>
                <span className="text-[10px] font-mono text-[#ff0000] uppercase font-bold tracking-widest block mb-1">
                  Step 1 of 2: Pre-Processing Pipeline
                </span>
                <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
                  <RotateCw className="w-5 h-5 text-[#ff0000] animate-spin-slow" /> Perspective Warp, Crop &amp; Alignment
                </h2>
                <p className="text-xs text-stone-400 mt-1">
                  Correct skewed scans, perspective distortion, or warped borders. Drag the corner handles directly on the canvas below to align the label perfectly.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => {
                    setRawImageSrc(null);
                    setCropConfirmed(false);
                    setSelectedFile(null);
                  }}
                  className="text-xs text-stone-400 hover:text-white px-3 py-1.5 rounded-lg border border-stone-800 hover:bg-stone-900 transition flex items-center gap-1"
                >
                  Change File
                </button>
                <button
                  onClick={handleConfirmCrop}
                  className="bg-red-600 hover:bg-red-700 text-white text-xs font-semibold px-4 py-2 rounded-lg transition shadow-md shadow-red-600/15 flex items-center gap-2"
                >
                  <Check className="w-4 h-4" /> Confirm &amp; Process Loom Map
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Left Column: Live alignment canvas */}
              <div className="lg:col-span-7 flex flex-col space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-stone-300 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span>
                    Interactive Perspective Quad Canvas
                  </span>
                  {rawLoadedImage && (
                    <span className="text-[10px] font-mono text-stone-500">
                      Original: {rawLoadedImage.width}×{rawLoadedImage.height} px
                    </span>
                  )}
                </div>

                <div className="border border-stone-800 rounded-xl bg-stone-950/60 p-4 flex flex-col items-center justify-center min-h-[380px] max-h-[540px] relative overflow-hidden group">
                  <canvas
                    ref={cropPreviewCanvasRef}
                    onPointerDown={handleCanvasPointerDown}
                    onPointerMove={handleCanvasPointerMove}
                    onPointerUp={handleCanvasPointerUp}
                    onPointerCancel={handleCanvasPointerUp}
                    className="max-w-full rounded shadow-2xl border border-stone-900 cursor-crosshair select-none"
                    style={{
                      maxHeight: "460px",
                      objectFit: "contain",
                      touchAction: "none",
                    }}
                  />
                  <div className="absolute bottom-2 left-1/2 transform -translate-x-1/2 bg-stone-950/90 border border-stone-800 text-[10px] text-stone-300 px-3 py-1.5 rounded-full shadow-lg backdrop-blur pointer-events-none text-center">
                    💡 Drag any corner red pin to straighten &amp; correct label warps/perspective
                  </div>
                </div>

                <div className="flex items-center justify-between text-[11px] text-stone-400 font-mono bg-stone-900/50 p-2.5 rounded border border-stone-850">
                  <div className="flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse"></span>
                    <span>Guiding grid matches real loom thread direction.</span>
                  </div>
                  <span>Rotate/Warp until lines align with grid tracks.</span>
                </div>

                {/* Step 1 Yarn Palette Snapping & Color Customization */}
                <div className="bg-stone-950 border border-stone-800 rounded-xl p-5 space-y-4 shadow-md mt-4">
                  <div className="flex items-center justify-between border-b border-stone-800 pb-3">
                    <h3 className="text-sm font-semibold tracking-wide text-white uppercase flex items-center gap-2">
                      <Grid className="w-4 h-4 text-red-500" /> Yarn Palette Snapping &amp; Color Customization
                    </h3>
                    <span className="text-[10px] bg-stone-850 text-stone-300 px-1.5 py-0.5 rounded font-mono">
                      {yarns.length} Colors Active
                    </span>
                  </div>

                  {/* AI Status Alert Banner */}
                  <div className="rounded-lg p-3 bg-stone-900 border border-stone-850 text-xs flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      {analyzing ? (
                        <>
                          <RefreshCw className="w-4 h-4 text-red-500 animate-spin" />
                          <span className="text-stone-300 font-medium">Gemini is automatically scanning threads for yarn colors &amp; loom specifications...</span>
                        </>
                      ) : (
                        <>
                          <div className="w-2 h-2 rounded-full bg-green-500"></div>
                          <span className="text-stone-300">
                            {analysisResult ? (
                              <>AI Scan Completed: <strong>{yarns.length} solid colors</strong> identified from label scan.</>
                            ) : (
                              <>Ready. Upload a scan to trigger automatic yarn color analysis.</>
                            )}
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Choose Number of Yarn Colors directly */}
                  <div className="space-y-2 bg-stone-900/50 p-3 rounded-lg border border-stone-900">
                    <div className="flex items-center justify-between text-xs font-semibold text-stone-300">
                      <span>Set Number of Yarn Colors:</span>
                      <span className="font-mono text-red-500 bg-red-500/10 px-2 py-0.5 rounded font-bold">
                        {yarns.length} Active Yarns
                      </span>
                    </div>
                    <div className="flex gap-1.5">
                      {[2, 3, 4, 5, 6, 7, 8].map((count) => (
                        <button
                          key={count}
                          type="button"
                          onClick={() => setNumberOfYarns(count)}
                          className={`flex-1 text-xs py-1.5 rounded font-bold border transition duration-150 ${
                            yarns.length === count
                              ? "bg-red-600 text-white border-red-500 shadow-md shadow-red-600/10"
                              : "bg-stone-950 text-stone-400 border-stone-850 hover:text-white hover:bg-stone-900"
                          }`}
                        >
                          {count}
                        </button>
                      ))}
                    </div>
                    <p className="text-[10px] text-stone-500">
                      Choosing a preset automatically adds/removes yarn swatches. Cells will instantly snap to these exact non-anti-aliased colors.
                    </p>
                  </div>

                  {/* Yarn swatch list */}
                  <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                    {yarns.map((yarn) => (
                      <div
                        key={yarn.id}
                        className="flex items-center justify-between bg-stone-900 border border-stone-800 p-2.5 rounded-lg text-xs"
                      >
                        <div className="flex items-center gap-2.5">
                          {/* Interactive Color Badge Picker */}
                          <div className="relative w-6 h-6 rounded border border-stone-700 overflow-hidden shrink-0 group cursor-pointer" title="Click to pick a custom color">
                            <input
                              type="color"
                              value={yarn.hex}
                              onChange={(e) => {
                                const newHex = e.target.value;
                                setYarns((prevYarns) =>
                                  prevYarns.map((y) =>
                                    y.id === yarn.id ? { ...y, hex: newHex } : y
                                  )
                                );
                                if (selectedPaintColor === yarn.hex) {
                                  setSelectedPaintColor(newHex);
                                }
                              }}
                              className="absolute inset-0 opacity-0 w-full h-full cursor-pointer z-10"
                            />
                            <span
                              className="absolute inset-0 block shadow-inner"
                              style={{ backgroundColor: yarn.hex }}
                            />
                          </div>

                          <div className="space-y-0.5">
                            <div className="font-semibold text-white flex items-center gap-1.5">
                              <input
                                type="text"
                                value={yarn.name}
                                onChange={(e) => {
                                  const newName = e.target.value;
                                  setYarns((prevYarns) =>
                                    prevYarns.map((y) =>
                                      y.id === yarn.id ? { ...y, name: newName } : y
                                    )
                                  );
                                }}
                                className="bg-transparent border-b border-transparent hover:border-stone-700/50 focus:border-red-500 focus:bg-stone-950 focus:outline-none text-white font-semibold py-0.5 px-1 rounded -ml-1 text-xs w-28 transition-colors"
                                title="Edit Yarn Color Name"
                              />
                              {yarn.isMetallic && (
                                <span className="text-[9px] bg-red-500/20 text-red-300 border border-red-500/30 px-1 rounded font-mono flex items-center gap-0.5 shrink-0">
                                  <Sparkle className="w-2.5 h-2.5" /> Lurex
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] text-stone-400 flex items-center gap-1 flex-wrap">
                              <span className="font-mono text-stone-500">{yarn.hex.toUpperCase()}</span>
                              <span className="text-stone-600">•</span>
                              <input
                                type="text"
                                value={yarn.role}
                                onChange={(e) => {
                                  const newRole = e.target.value;
                                  setYarns((prevYarns) =>
                                    prevYarns.map((y) =>
                                      y.id === yarn.id ? { ...y, role: newRole } : y
                                    )
                                  );
                                }}
                                className="bg-transparent border-b border-transparent hover:border-stone-700/50 focus:border-red-500 focus:bg-stone-950 focus:outline-none text-stone-400 py-0 px-1 rounded -ml-1 text-[10px] w-36 italic transition-colors"
                                title="Edit Yarn Role Description"
                              />
                            </div>
                          </div>
                        </div>
                        <button
                          onClick={() => removeYarn(yarn.id)}
                          className="text-stone-500 hover:text-red-400 p-1 rounded hover:bg-stone-850 transition shrink-0"
                          title="Delete yarn color"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>

                  {/* Gemini AI Color Copilot */}
                  <div className="bg-stone-900 border border-stone-800 p-3 rounded-lg space-y-2">
                    <span className="block text-[10px] font-mono text-stone-300 uppercase tracking-wide flex items-center gap-1.5 font-bold">
                      <Sparkles className="w-3.5 h-3.5 text-red-400 animate-pulse" /> Gemini Palette Harmonizer
                    </span>
                    <p className="text-[10px] text-stone-400 leading-relaxed">
                      Describe the desired theme or brand mood. Gemini will select and program a matching yarn dye palette:
                    </p>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={palettePrompt}
                        onChange={(e) => setPalettePrompt(e.target.value)}
                        placeholder="e.g. vintage navy gold, pastel lavender, earth tones"
                        className="bg-stone-950 border border-stone-850 rounded px-2.5 py-1.5 text-xs w-full text-white placeholder-stone-600 focus:outline-none focus:ring-1 focus:ring-red-500 font-sans"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleGeneratePalette();
                          }
                        }}
                      />
                      <button
                        type="button"
                        onClick={handleGeneratePalette}
                        disabled={isGeneratingPalette || !palettePrompt.trim()}
                        className="bg-stone-800 hover:bg-stone-750 text-white text-xs px-3 rounded font-bold flex items-center gap-1 transition disabled:opacity-50 cursor-pointer shrink-0"
                      >
                        {isGeneratingPalette ? (
                          <RefreshCw className="w-3 animate-spin text-red-400" />
                        ) : (
                          "Harmonize"
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Add new yarn form */}
                  <form onSubmit={handleAddYarn} className="bg-stone-900 border border-stone-800 p-3 rounded-lg space-y-3">
                    <span className="block text-[10px] font-mono text-stone-400 uppercase tracking-wide">Add Custom Yarn / Color Variation:</span>
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
                        <label className="text-[10px] text-stone-500 block mb-0.5 font-mono">YARN NAME / DESIGNATION</label>
                        <input
                          type="text"
                          value={newYarnName}
                          onChange={(e) => setNewYarnName(e.target.value)}
                          className="bg-stone-800 border border-stone-700 rounded px-1.5 py-1 text-xs w-full text-white"
                          placeholder="Gold Lurex..."
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

              {/* Right Column: Precise Control Panel */}
              <div className="lg:col-span-5 space-y-6 bg-stone-950 p-5 rounded-xl border border-stone-850">
                
                {/* Section A: Straighten / Angle Adjust */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold tracking-wider text-white uppercase flex items-center gap-2">
                      <RotateCw className="w-4 h-4 text-[#ff0000]" /> 1. Deskew / Rotate Canvas
                    </span>
                    <button
                      onClick={() => setCropRotation(0)}
                      className="text-[10px] text-stone-400 hover:text-white border border-stone-800 px-2 py-0.5 rounded transition"
                    >
                      Reset Angle
                    </button>
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-stone-400">Rotation Angle:</span>
                      <span className="font-mono text-[#ff0000] bg-[#ff0000]/10 px-2 py-0.5 rounded font-bold">
                        {cropRotation.toFixed(1)}°
                      </span>
                    </div>

                    <input
                      type="range"
                      min="-45"
                      max="45"
                      step="0.5"
                      value={cropRotation}
                      onChange={(e) => setCropRotation(parseFloat(e.target.value))}
                      className="w-full accent-[#ff0000] cursor-ew-resize"
                    />

                    {/* Fine tuning buttons */}
                    <div className="flex flex-wrap gap-1.5 justify-center pt-1 border-t border-stone-900/50">
                      <button
                        onClick={() => setCropRotation((prev) => Math.max(-45, prev - 5))}
                        className="text-[10px] bg-stone-900 hover:bg-stone-850 text-stone-300 border border-stone-800 px-2 py-1 rounded transition"
                      >
                        -5°
                      </button>
                      <button
                        onClick={() => setCropRotation((prev) => Math.max(-45, prev - 1))}
                        className="text-[10px] bg-stone-900 hover:bg-stone-850 text-stone-300 border border-stone-800 px-2 py-1 rounded transition"
                      >
                        -1°
                      </button>
                      <button
                        onClick={() => setCropRotation((prev) => Math.max(-45, prev - 0.1))}
                        className="text-[10px] bg-stone-900 hover:bg-stone-850 text-stone-300 border border-stone-800 px-2 py-1 rounded transition"
                      >
                        -0.1°
                      </button>
                      <button
                        onClick={() => setCropRotation(0)}
                        className="text-[10px] bg-stone-900/70 hover:bg-stone-850 text-stone-400 border border-stone-800 px-2 py-1 rounded transition font-semibold"
                      >
                        0°
                      </button>
                      <button
                        onClick={() => setCropRotation((prev) => Math.min(45, prev + 0.1))}
                        className="text-[10px] bg-stone-900 hover:bg-stone-850 text-stone-300 border border-stone-800 px-2 py-1 rounded transition"
                      >
                        +0.1°
                      </button>
                      <button
                        onClick={() => setCropRotation((prev) => Math.min(45, prev + 1))}
                        className="text-[10px] bg-stone-900 hover:bg-stone-850 text-stone-300 border border-stone-800 px-2 py-1 rounded transition"
                      >
                        +1°
                      </button>
                      <button
                        onClick={() => setCropRotation((prev) => Math.min(45, prev + 5))}
                        className="text-[10px] bg-stone-900 hover:bg-stone-850 text-[#ff0000] border border-stone-800 px-2 py-1 rounded transition"
                      >
                        +5°
                      </button>
                    </div>

                    {/* Merged AI-powered Auto Detect & Straighten */}
                    <div className="pt-2">
                      <button
                        onClick={() => autoDetectAndStraighten()}
                        disabled={isAutoDetecting}
                        className="w-full bg-[#ff0000] hover:bg-red-600 text-white text-xs font-bold py-2.5 px-4 rounded-lg transition duration-150 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 hover:scale-[1.01]"
                      >
                        {isAutoDetecting ? (
                          <>
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                            <span>AI Aligning & Detecting Corners...</span>
                          </>
                        ) : (
                          <>
                            <Sparkles className="w-3.5 h-3.5 text-red-200" />
                            <span>Auto Detect & Straighten</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Section B: Perspective Corner Pins Fine-Tuning */}
                <div className="space-y-4 pt-4 border-t border-stone-900">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold tracking-wider text-white uppercase flex items-center gap-2">
                      <Sliders className="w-4 h-4 text-[#ff0000]" /> 2. Manual Corner Fine-Tuning
                    </span>
                    <button
                      onClick={() => {
                        setCornerTL({ x: 10, y: 10 });
                        setCornerTR({ x: 90, y: 10 });
                        setCornerBR({ x: 90, y: 90 });
                        setCornerBL({ x: 10, y: 90 });
                      }}
                      className="text-[10px] text-stone-400 hover:text-white border border-stone-800 px-2 py-0.5 rounded transition"
                    >
                      Reset Corners
                    </button>
                  </div>

                  <div className="space-y-3.5 max-h-[320px] overflow-y-auto pr-1">
                    {/* Top-Left Corner */}
                    <div className="p-3 bg-stone-900/40 rounded-lg border border-stone-900 space-y-2">
                      <div className="flex items-center justify-between text-[11px] font-mono">
                        <span className="text-stone-300 font-medium">🔴 Top-Left Pin (TL)</span>
                        <span className="text-[#ff0000] font-bold">X:{Math.round(cornerTL.x)}% Y:{Math.round(cornerTL.y)}%</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[9px] text-stone-500 block mb-0.5">Horizontal (X)</label>
                          <input
                            type="range"
                            min="0"
                            max="50"
                            value={cornerTL.x}
                            onChange={(e) => setCornerTL((prev) => ({ ...prev, x: parseFloat(e.target.value) }))}
                            className="w-full accent-red-600 cursor-ew-resize h-1"
                          />
                        </div>
                        <div>
                          <label className="text-[9px] text-stone-500 block mb-0.5">Vertical (Y)</label>
                          <input
                            type="range"
                            min="0"
                            max="50"
                            value={cornerTL.y}
                            onChange={(e) => setCornerTL((prev) => ({ ...prev, y: parseFloat(e.target.value) }))}
                            className="w-full accent-red-600 cursor-ew-resize h-1"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Top-Right Corner */}
                    <div className="p-3 bg-stone-900/40 rounded-lg border border-stone-900 space-y-2">
                      <div className="flex items-center justify-between text-[11px] font-mono">
                        <span className="text-stone-300 font-medium">🔴 Top-Right Pin (TR)</span>
                        <span className="text-[#ff0000] font-bold">X:{Math.round(cornerTR.x)}% Y:{Math.round(cornerTR.y)}%</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[9px] text-stone-500 block mb-0.5">Horizontal (X)</label>
                          <input
                            type="range"
                            min="50"
                            max="100"
                            value={cornerTR.x}
                            onChange={(e) => setCornerTR((prev) => ({ ...prev, x: parseFloat(e.target.value) }))}
                            className="w-full accent-red-600 cursor-ew-resize h-1"
                          />
                        </div>
                        <div>
                          <label className="text-[9px] text-stone-500 block mb-0.5">Vertical (Y)</label>
                          <input
                            type="range"
                            min="0"
                            max="50"
                            value={cornerTR.y}
                            onChange={(e) => setCornerTR((prev) => ({ ...prev, y: parseFloat(e.target.value) }))}
                            className="w-full accent-red-600 cursor-ew-resize h-1"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Bottom-Right Corner */}
                    <div className="p-3 bg-stone-900/40 rounded-lg border border-stone-900 space-y-2">
                      <div className="flex items-center justify-between text-[11px] font-mono">
                        <span className="text-stone-300 font-medium">🔴 Bottom-Right Pin (BR)</span>
                        <span className="text-[#ff0000] font-bold">X:{Math.round(cornerBR.x)}% Y:{Math.round(cornerBR.y)}%</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[9px] text-stone-500 block mb-0.5">Horizontal (X)</label>
                          <input
                            type="range"
                            min="50"
                            max="100"
                            value={cornerBR.x}
                            onChange={(e) => setCornerBR((prev) => ({ ...prev, x: parseFloat(e.target.value) }))}
                            className="w-full accent-red-600 cursor-ew-resize h-1"
                          />
                        </div>
                        <div>
                          <label className="text-[9px] text-stone-500 block mb-0.5">Vertical (Y)</label>
                          <input
                            type="range"
                            min="50"
                            max="100"
                            value={cornerBR.y}
                            onChange={(e) => setCornerBR((prev) => ({ ...prev, y: parseFloat(e.target.value) }))}
                            className="w-full accent-red-600 cursor-ew-resize h-1"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Bottom-Left Corner */}
                    <div className="p-3 bg-stone-900/40 rounded-lg border border-stone-900 space-y-2">
                      <div className="flex items-center justify-between text-[11px] font-mono">
                        <span className="text-stone-300 font-medium">🔴 Bottom-Left Pin (BL)</span>
                        <span className="text-[#ff0000] font-bold">X:{Math.round(cornerBL.x)}% Y:{Math.round(cornerBL.y)}%</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[9px] text-stone-500 block mb-0.5">Horizontal (X)</label>
                          <input
                            type="range"
                            min="0"
                            max="50"
                            value={cornerBL.x}
                            onChange={(e) => setCornerBL((prev) => ({ ...prev, x: parseFloat(e.target.value) }))}
                            className="w-full accent-red-600 cursor-ew-resize h-1"
                          />
                        </div>
                        <div>
                          <label className="text-[9px] text-stone-500 block mb-0.5">Vertical (Y)</label>
                          <input
                            type="range"
                            min="50"
                            max="100"
                            value={cornerBL.y}
                            onChange={(e) => setCornerBL((prev) => ({ ...prev, y: parseFloat(e.target.value) }))}
                            className="w-full accent-red-600 cursor-ew-resize h-1"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* AI-powered Technical Thread Analysis & Advice */}
                <div className="space-y-4 pt-4 border-t border-stone-900">
                  <span className="text-xs font-semibold tracking-wider text-white uppercase flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-[#ff0000]" /> 3. AI Textile Insights &amp; Specs
                  </span>
                  
                  {analyzing ? (
                    <div className="bg-stone-900/50 border border-stone-850 p-4 rounded-lg flex flex-col items-center justify-center gap-2.5 text-center text-xs text-stone-400">
                      <RefreshCw className="w-6 h-6 text-red-500 animate-spin" />
                      <div>
                        <p className="font-semibold text-stone-300">Gemini is analyzing threads...</p>
                        <p className="text-[10px] text-stone-500 mt-1">
                          Identifying weave structures, warp/weft picked thread count, and digital layout parameters.
                        </p>
                      </div>
                    </div>
                  ) : analysisResult ? (
                    <div className="space-y-3 text-xs">
                      <div className="grid grid-cols-2 gap-2">
                        <div className="bg-stone-900 border border-stone-850 p-2.5 rounded-lg">
                          <span className="text-[9px] font-mono text-red-500 uppercase block">Weave Type</span>
                          <span className="font-bold text-white text-[11px]">{analysisResult.weaveType}</span>
                        </div>
                        <div className="bg-stone-900 border border-stone-850 p-2.5 rounded-lg">
                          <span className="text-[9px] font-mono text-red-500 uppercase block">Optimal Grid</span>
                          <span className="font-bold text-white text-[11px]">
                            {analysisResult.estimatedWarpDensity} ends × {analysisResult.estimatedWeftDensity} picks
                          </span>
                        </div>
                      </div>

                      <div className="bg-stone-900 border border-stone-850 p-3 rounded-lg space-y-2">
                        <span className="text-[9.5px] font-mono text-red-500 uppercase tracking-wide block">
                          MÜCAD Loom Programming Advice:
                        </span>
                        <ul className="space-y-1.5 pl-3 list-disc text-stone-300 text-[11px] leading-relaxed">
                          {analysisResult.mucadAdvice.map((advice, i) => (
                            <li key={i}>{advice}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  ) : (
                    <div className="bg-stone-900/30 border border-stone-900 p-3.5 rounded-lg text-xs text-stone-400 text-center">
                      Upload a label scan. Gemini will automatically analyze the fabric structure and display optimal weave specifications here.
                    </div>
                  )}
                </div>

                {/* Section C: Complete Pre-processing and Continue */}
                <div className="pt-4 border-t border-stone-900 space-y-3">
                  <button
                    onClick={handleConfirmCrop}
                    className="w-full bg-[#ff0000] hover:bg-red-700 text-white font-semibold py-3 px-4 rounded-xl transition duration-200 shadow-lg shadow-red-600/10 flex items-center justify-center gap-2 hover:scale-[1.01]"
                  >
                    <Check className="w-5 h-5" /> Rectify Label &amp; Start Analysis
                  </button>
                  <p className="text-[10px] text-stone-500 text-center">
                    Runs bilinear antialiased quad-rectification and switches to loom matrix mapping.
                  </p>
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
                  <div className="flex items-center gap-2">
                    {originalDimensions && (
                      <button
                        onClick={() => {
                          setSpecs({
                            widthMm: originalDimensions.width / 10,
                            heightMm: originalDimensions.height / 10,
                            warpDensity: 100,
                            weftDensity: 100,
                          });
                        }}
                        className="text-[10px] bg-red-600/25 hover:bg-red-600 text-red-200 hover:text-white border border-red-500/30 hover:border-red-500 px-2.5 py-0.5 rounded font-medium transition cursor-pointer"
                        title={`Reset grid dimensions and aspect ratio back to original scan image (${originalDimensions.width} x ${originalDimensions.height} px)`}
                      >
                        Reset to Original
                      </button>
                    )}
                    <span className="text-[10px] bg-stone-850 text-stone-300 px-1.5 py-0.5 rounded font-mono">
                      Loom Setup
                    </span>
                  </div>
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
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-mono text-red-500 font-semibold block uppercase tracking-wide">
                        Calculated Loom Pixel Map Matrix:
                      </span>
                      {originalDimensions && (targetWidthPx !== originalDimensions.width || targetHeightPx !== originalDimensions.height) && (
                        <button
                          onClick={() => {
                            setSpecs({
                              widthMm: originalDimensions.width / 10,
                              heightMm: originalDimensions.height / 10,
                              warpDensity: 100,
                              weftDensity: 100,
                            });
                          }}
                          className="text-[9px] bg-red-600/15 hover:bg-red-600/35 text-red-400 hover:text-red-300 border border-red-500/20 px-1.5 py-0.5 rounded font-mono transition cursor-pointer flex items-center gap-1"
                        >
                          Reset to {originalDimensions.width}×{originalDimensions.height} Original
                        </button>
                      )}
                    </div>
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

                  {/* Gemini Loom Setup Consultant */}
                  <div className="bg-stone-900 border border-stone-800 p-3 rounded-lg space-y-2">
                    <span className="block text-[10px] font-mono text-stone-300 uppercase tracking-wide flex items-center gap-1.5 font-bold">
                      <Sparkles className="w-3.5 h-3.5 text-red-400 animate-pulse" /> AI Loom Consultant
                    </span>
                    <p className="text-[10px] text-stone-400 leading-relaxed">
                      Consult Gemini for MÜCAD jacquard programming setup (e.g. "optimize for thick wool" or "adjust for 50 denier damask"):
                    </p>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={loomQuery}
                        onChange={(e) => setLoomQuery(e.target.value)}
                        placeholder="e.g. optimize for 50-denier polyester"
                        className="bg-stone-950 border border-stone-850 rounded px-2.5 py-1.5 text-xs w-full text-white placeholder-stone-600 focus:outline-none focus:ring-1 focus:ring-red-500 font-sans"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleCalculateLoomSpecs();
                          }
                        }}
                      />
                      <button
                        type="button"
                        onClick={handleCalculateLoomSpecs}
                        disabled={isCalculatingSpecs || !loomQuery.trim()}
                        className="bg-stone-800 hover:bg-stone-750 text-white text-xs px-3 rounded font-bold flex items-center gap-1 transition shrink-0 disabled:opacity-50 cursor-pointer"
                      >
                        {isCalculatingSpecs ? (
                          <RefreshCw className="w-3 animate-spin text-red-400" />
                        ) : (
                          "Consult"
                        )}
                      </button>
                    </div>
                    {loomReasoning && (
                      <div className="p-2.5 bg-stone-950 rounded border border-stone-850 text-[10.5px] text-stone-300 space-y-1 mt-1 max-h-40 overflow-y-auto">
                        <p className="font-semibold text-red-400">Consultant Recommendation:</p>
                        <p className="leading-normal">{loomReasoning}</p>
                        {loomAdvice.length > 0 && (
                          <ul className="list-disc pl-3.5 mt-1 text-[10px] text-stone-400 space-y-1">
                            {loomAdvice.map((adv, i) => (
                              <li key={i}>{adv}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="pt-2">
                    <button
                      onClick={() => setCropConfirmed(false)}
                      className="w-full text-xs bg-stone-900 hover:bg-stone-850 text-stone-300 hover:text-white border border-stone-800 hover:border-red-500 py-2 px-3 rounded-lg transition flex items-center justify-center gap-1.5 font-medium cursor-pointer shadow-sm"
                    >
                      <RotateCw className="w-3.5 h-3.5 text-[#ff0000]" /> Adjust Crop &amp; Alignment
                    </button>
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

                  {/* Gemini Filter Presets */}
                  <div className="bg-stone-900 border border-stone-800 p-3 rounded-lg space-y-2 mt-2">
                    <span className="block text-[10px] font-mono text-stone-300 uppercase tracking-wide flex items-center gap-1.5 font-bold">
                      <Sparkles className="w-3.5 h-3.5 text-red-400 animate-pulse" /> Gemini Smart Filter Presets
                    </span>
                    <p className="text-[10px] text-stone-400">
                      Use Gemini to instantly compute optimal edge sharpness, contrast, and denoising for the scan:
                    </p>
                    <div className="grid grid-cols-2 gap-1.5 pt-1">
                      {[
                        { id: "high-contrast", label: "Edge Contrast" },
                        { id: "shadow-reduction", label: "Dampen Folds" },
                        { id: "sharp-text", label: "Crisp Text" },
                        { id: "glow-reduction", label: "Anti-Glare" },
                      ].map((preset) => (
                        <button
                          key={preset.id}
                          type="button"
                          disabled={isApplyingFilterPreset}
                          onClick={() => handleApplyFilterPreset(preset.id)}
                          className="bg-stone-950 hover:bg-stone-850 text-stone-300 border border-stone-850 rounded py-1 px-2 text-[10px] font-medium transition flex items-center justify-center gap-1 hover:text-white hover:border-red-500/50 disabled:opacity-50 cursor-pointer"
                        >
                          {isApplyingFilterPreset ? (
                            <RefreshCw className="w-2.5 h-2.5 animate-spin text-red-400" />
                          ) : (
                            <Sparkle className="w-2.5 h-2.5 text-red-500" />
                          )}
                          <span>{preset.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Box 3: Sub-Pixel Grid Calibration & Nudge */}
              <div className="bg-stone-950 border border-stone-800 rounded-xl p-5 space-y-4 shadow-md">
                <div className="flex items-center justify-between border-b border-stone-800 pb-3">
                  <h3 className="text-sm font-semibold tracking-wide text-white uppercase flex items-center gap-2">
                    <Grid className="w-4 h-4 text-red-500" /> 3. Grid Alignment &amp; Nudge
                  </h3>
                  <span
                    className="text-xs text-red-500 cursor-pointer hover:underline font-medium"
                    onClick={() => {
                      setGridNudgeX(0);
                      setGridNudgeY(0);
                      setGridNudgeScaleX(100);
                      setGridNudgeScaleY(100);
                    }}
                  >
                    Reset Grid
                  </span>
                </div>

                <div className="space-y-4">
                  {/* Grid Shifting Controls */}
                  <div className="space-y-3">
                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-stone-300 font-medium">Horizontal Shift (X-Offset)</span>
                        <span className="font-mono text-red-500 font-semibold">{gridNudgeX} px</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setGridNudgeX((prev) => prev - 1)}
                          className="px-2 py-1 bg-stone-900 border border-stone-800 rounded text-xs text-stone-300 hover:text-white hover:bg-stone-850 transition"
                        >
                          -1px
                        </button>
                        <input
                          type="range"
                          min="-40"
                          max="40"
                          step="1"
                          value={gridNudgeX}
                          onChange={(e) => setGridNudgeX(parseInt(e.target.value))}
                          className="w-full h-1.5 bg-stone-800 rounded-lg appearance-none cursor-pointer accent-red-600 flex-grow"
                        />
                        <button
                          type="button"
                          onClick={() => setGridNudgeX((prev) => prev + 1)}
                          className="px-2 py-1 bg-stone-900 border border-stone-800 rounded text-xs text-stone-300 hover:text-white hover:bg-stone-850 transition"
                        >
                          +1px
                        </button>
                      </div>
                    </div>

                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-stone-300 font-medium">Vertical Shift (Y-Offset)</span>
                        <span className="font-mono text-red-500 font-semibold">{gridNudgeY} px</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setGridNudgeY((prev) => prev - 1)}
                          className="px-2 py-1 bg-stone-900 border border-stone-800 rounded text-xs text-stone-300 hover:text-white hover:bg-stone-850 transition"
                        >
                          -1px
                        </button>
                        <input
                          type="range"
                          min="-40"
                          max="40"
                          step="1"
                          value={gridNudgeY}
                          onChange={(e) => setGridNudgeY(parseInt(e.target.value))}
                          className="w-full h-1.5 bg-stone-800 rounded-lg appearance-none cursor-pointer accent-red-600 flex-grow"
                        />
                        <button
                          type="button"
                          onClick={() => setGridNudgeY((prev) => prev + 1)}
                          className="px-2 py-1 bg-stone-900 border border-stone-800 rounded text-xs text-stone-300 hover:text-white hover:bg-stone-850 transition"
                        >
                          +1px
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Grid Scaling Controls */}
                  <div className="border-t border-stone-900 pt-3 space-y-3">
                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-stone-300 font-medium">Horizontal Weave Scale (W-Stretch)</span>
                        <span className="font-mono text-red-500 font-semibold">{gridNudgeScaleX.toFixed(1)}%</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setGridNudgeScaleX((prev) => Math.max(80, prev - 0.5))}
                          className="px-1.5 py-1 bg-stone-900 border border-stone-800 rounded text-[10px] text-stone-300 hover:text-white hover:bg-stone-850 transition"
                        >
                          -0.5%
                        </button>
                        <input
                          type="range"
                          min="80"
                          max="120"
                          step="0.1"
                          value={gridNudgeScaleX}
                          onChange={(e) => setGridNudgeScaleX(parseFloat(e.target.value))}
                          className="w-full h-1.5 bg-stone-800 rounded-lg appearance-none cursor-pointer accent-red-600 flex-grow"
                        />
                        <button
                          type="button"
                          onClick={() => setGridNudgeScaleX((prev) => Math.min(120, prev + 0.5))}
                          className="px-1.5 py-1 bg-stone-900 border border-stone-800 rounded text-[10px] text-stone-300 hover:text-white hover:bg-stone-850 transition"
                        >
                          +0.5%
                        </button>
                      </div>
                    </div>

                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-stone-300 font-medium">Vertical Weave Scale (H-Stretch)</span>
                        <span className="font-mono text-red-500 font-semibold">{gridNudgeScaleY.toFixed(1)}%</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setGridNudgeScaleY((prev) => Math.max(80, prev - 0.5))}
                          className="px-1.5 py-1 bg-stone-900 border border-stone-800 rounded text-[10px] text-stone-300 hover:text-white hover:bg-stone-850 transition"
                        >
                          -0.5%
                        </button>
                        <input
                          type="range"
                          min="80"
                          max="120"
                          step="0.1"
                          value={gridNudgeScaleY}
                          onChange={(e) => setGridNudgeScaleY(parseFloat(e.target.value))}
                          className="w-full h-1.5 bg-stone-800 rounded-lg appearance-none cursor-pointer accent-red-600 flex-grow"
                        />
                        <button
                          type="button"
                          onClick={() => setGridNudgeScaleY((prev) => Math.min(120, prev + 0.5))}
                          className="px-1.5 py-1 bg-stone-900 border border-stone-800 rounded text-[10px] text-stone-300 hover:text-white hover:bg-stone-850 transition"
                        >
                          +0.5%
                        </button>
                      </div>
                    </div>
                  </div>

                  <p className="text-[10px] text-stone-500 leading-relaxed bg-stone-900/30 p-2.5 rounded-lg border border-stone-900">
                    💡 <strong>Calibration Fallback:</strong> If fabric curling occurs, use these sliders to nudge the sampling window sub-pixel by sub-pixel until aligned perfectly.
                  </p>
                </div>
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

                          <div className="flex items-center gap-1 text-xs text-stone-400">
                            <span>Zoom:</span>
                            <div className="flex items-center bg-stone-900 border border-stone-800 rounded p-0.5 gap-0.5">
                              <button
                                type="button"
                                onClick={() => {
                                  const levels = [1, 2, 4, 6, 8, 12];
                                  const currentIdx = levels.indexOf(zoomLevel);
                                  if (currentIdx > 0) setZoomLevel(levels[currentIdx - 1]);
                                }}
                                className="p-1 hover:bg-stone-800 rounded text-stone-300 hover:text-white transition cursor-pointer"
                                title="Zoom Out"
                              >
                                <ZoomOut className="w-3.5 h-3.5" />
                              </button>
                              
                              <select
                                value={zoomLevel}
                                onChange={(e) => setZoomLevel(parseInt(e.target.value))}
                                className="bg-transparent border-none text-stone-200 px-1 py-0.5 outline-none text-xs font-medium cursor-pointer"
                              >
                                <option value="1" className="bg-stone-950">1x (A4)</option>
                                <option value="2" className="bg-stone-950">2x</option>
                                <option value="4" className="bg-stone-950">4x (Macro)</option>
                                <option value="6" className="bg-stone-950">6x</option>
                                <option value="8" className="bg-stone-950">8x (Micro)</option>
                                <option value="12" className="bg-stone-950">12x (Deep)</option>
                              </select>

                              <button
                                type="button"
                                onClick={() => {
                                  const levels = [1, 2, 4, 6, 8, 12];
                                  const currentIdx = levels.indexOf(zoomLevel);
                                  if (currentIdx !== -1 && currentIdx < levels.length - 1) setZoomLevel(levels[currentIdx + 1]);
                                }}
                                className="p-1 hover:bg-stone-800 rounded text-stone-300 hover:text-white transition cursor-pointer"
                                title="Zoom In"
                              >
                                <ZoomIn className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* AI Artwork Reconstruction & Vector Refinement Panel */}
                      <div className="bg-stone-900 border border-stone-800 rounded-xl p-4 space-y-4 shadow-inner">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                          <div className="space-y-1">
                            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold font-mono tracking-wider bg-red-500/15 text-red-400 border border-red-500/20 uppercase">
                              <Sparkles className="w-3 h-3 animate-pulse" /> Precision AI Vector Engine
                            </span>
                            <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                              AI Artwork Reconstruction & Refinement
                            </h4>
                            <p className="text-[11px] text-stone-400 max-w-xl leading-relaxed">
                              Uses advanced vision analysis to faithfully reconstruct the design. Recreates text using matching Google web fonts, refines logos/borders into smooth vector shapes, and eliminates all weft/warp scanning noise.
                            </p>

                            {/* Gemini Custom Refinement Prompt */}
                            <div className="bg-stone-950/40 p-2.5 rounded-lg border border-stone-850 space-y-1.5 mt-2">
                              <span className="block text-[10px] font-mono text-stone-300 uppercase tracking-wide flex items-center gap-1.5 font-bold">
                                <Sparkles className="w-3.5 h-3.5 text-red-400 animate-pulse" /> AI Refinement Prompt (Optional)
                              </span>
                              <input
                                type="text"
                                value={refinementPrompt}
                                onChange={(e) => setRefinementPrompt(e.target.value)}
                                placeholder="e.g. Translate text to English, thicken borders, change background to deep gold"
                                className="bg-stone-950 border border-stone-800 rounded px-2.5 py-1.5 text-xs w-full text-white placeholder-stone-600 focus:outline-none focus:ring-1 focus:ring-red-500 font-sans"
                              />
                            </div>
                          </div>

                          <div className="flex sm:flex-col gap-2 shrink-0">
                            <button
                              type="button"
                              onClick={handleAiReconstruct}
                              disabled={isReconstructing || !imageSrc}
                              className={`px-4 py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-2 transition select-none ${
                                isReconstructing
                                  ? "bg-stone-850 text-stone-500 border border-stone-800 cursor-not-allowed"
                                  : "bg-red-600 hover:bg-red-500 text-white shadow-md shadow-red-650/10 cursor-pointer"
                              }`}
                            >
                              {isReconstructing ? (
                                <>
                                  <RefreshCw className="w-4 h-4 animate-spin" />
                                  <span>Reconstructing...</span>
                                </>
                              ) : (
                                <>
                                  <Sparkles className="w-4 h-4 text-red-200" />
                                  <span>Reconstruct Artwork</span>
                                </>
                              )}
                            </button>

                            {reconstructedSvg && (
                              <button
                                type="button"
                                onClick={() => setUseReconstructedSource(!useReconstructedSource)}
                                className={`px-4 py-1.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 border transition select-none ${
                                  useReconstructedSource
                                    ? "bg-stone-800 hover:bg-stone-750 text-white border-stone-700"
                                    : "bg-stone-950 hover:bg-stone-900 text-stone-400 hover:text-white border-stone-800"
                                }`}
                              >
                                {useReconstructedSource ? (
                                  <>
                                    <Check className="w-3.5 h-3.5 text-green-400" />
                                    <span>Using AI Artwork</span>
                                  </>
                                ) : (
                                  <>
                                    <Eye className="w-3.5 h-3.5 text-stone-500" />
                                    <span>Switch to AI Artwork</span>
                                  </>
                                )}
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Display reconstruction details once successful */}
                        {reconstructedSvg && (
                          <div className="border-t border-stone-800 pt-3.5 space-y-3 animate-fade-in">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div className="bg-stone-950 p-2.5 rounded border border-stone-800/80 space-y-1.5">
                                <span className="text-[10px] font-bold font-mono tracking-wider text-stone-400 uppercase block">
                                  Matched Typographic Fonts:
                                </span>
                                <div className="flex flex-wrap gap-1.5">
                                  {detectedFonts.length > 0 ? (
                                    detectedFonts.map((font) => (
                                      <span
                                        key={font}
                                        className="text-[11px] font-mono px-2 py-0.5 rounded bg-stone-900 text-stone-200 border border-stone-800"
                                      >
                                        {font}
                                      </span>
                                    ))
                                  ) : (
                                    <span className="text-[11px] text-stone-500 italic">No web fonts required.</span>
                                  )}
                                </div>
                              </div>

                              <div className="bg-stone-950 p-2.5 rounded border border-stone-800/80 space-y-1">
                                <span className="text-[10px] font-bold font-mono tracking-wider text-stone-400 uppercase block">
                                  Vector Geometry Reasoning:
                                </span>
                                <p className="text-[11px] text-stone-300 leading-relaxed max-h-[72px] overflow-y-auto font-sans">
                                  {reconstructReasoning || "Reconstructed with perfect alignment and solid flat-color snapping."}
                                </p>
                              </div>
                            </div>

                            {/* Option to clear and revert */}
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between text-[11px] text-stone-400 gap-2">
                              <span className="flex items-center gap-1.5">
                                <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                                Pristine vector source active. Manual brush edits can still be applied on top.
                              </span>
                              <button
                                type="button"
                                onClick={() => {
                                  setUseReconstructedSource(false);
                                  setReconstructedSvg(null);
                                  setReconstructedImage(null);
                                }}
                                className="text-red-400 hover:text-red-300 transition underline decoration-dotted underline-offset-2 self-start sm:self-auto"
                              >
                                Clear AI Artwork & Revert
                              </button>
                            </div>
                          </div>
                        )}
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

                              {/* Gemini AI Paint Copilot */}
                              <div className="flex items-center gap-1.5 border-l border-stone-800 pl-3">
                                <span className="text-[11px] text-stone-300 font-bold shrink-0 flex items-center gap-1">
                                  <Sparkles className="w-3.5 h-3.5 text-red-400 animate-pulse" /> AI Paint Copilot:
                                </span>
                                <div className="flex gap-1.5">
                                  <input
                                    type="text"
                                    value={paintInstruction}
                                    onChange={(e) => setPaintInstruction(e.target.value)}
                                    placeholder="e.g. Draw a red 1px border, or color center cells"
                                    className="bg-stone-950 border border-stone-800 rounded px-2 py-1 text-[11px] w-48 text-stone-200 placeholder-stone-600 focus:outline-none focus:ring-1 focus:ring-red-500 font-sans"
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        e.preventDefault();
                                        handleApplyPaintCopilot();
                                      }
                                    }}
                                  />
                                  <button
                                    type="button"
                                    onClick={handleApplyPaintCopilot}
                                    disabled={isProcessingPaint || !paintInstruction.trim()}
                                    className="bg-stone-800 hover:bg-stone-750 text-white text-[11px] px-2 py-1 rounded font-bold transition flex items-center gap-1 shrink-0 disabled:opacity-50 cursor-pointer"
                                    title="Submit painting instruction to AI Copilot"
                                  >
                                    {isProcessingPaint ? (
                                      <RefreshCw className="w-3 h-3 animate-spin text-red-400" />
                                    ) : (
                                      "Paint"
                                    )}
                                  </button>
                                </div>
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
                              <span className={`w-2 h-2 rounded-full block animate-pulse ${useReconstructedSource ? "bg-green-500" : "bg-amber-500"}`} />
                              {useReconstructedSource ? "AI Reconstructed Vector Source" : "Processed Physical Scan Source"}
                            </span>
                            <span className="text-[10px] text-stone-500 font-mono">
                              {useReconstructedSource ? "Pristine SVG" : "Auto-cropped / Rotated"}
                            </span>
                          </div>
                          
                          <div className="border border-stone-800 rounded-lg overflow-auto bg-stone-900 max-h-[480px] p-4 flex items-center justify-center min-h-[220px]">
                            <div
                              className="relative"
                              style={{
                                width: `${targetWidthPx * zoomLevel}px`,
                                height: `${targetHeightPx * zoomLevel}px`,
                              }}
                            >
                              {/* Hidden Source Canvas that retains the actual rotated resolution */}
                              <canvas
                                ref={originalCanvasRef}
                                onMouseMove={(e) => handleMouseMove(e, false)}
                                onMouseLeave={handleMouseLeave}
                                className="w-full h-full cursor-crosshair rounded shadow-lg select-none"
                                style={{
                                  imageRendering: "pixelated",
                                }}
                              />

                              {/* Optional Loom Grid Overlay over Original Scan */}
                              {showGridOverlay && (
                                <div
                                  className="absolute inset-0 pointer-events-none z-5"
                                  style={{
                                    backgroundImage: `linear-gradient(to right, rgba(100, 116, 139, 0.25) 1px, transparent 1px),
                                                      linear-gradient(to bottom, rgba(100, 116, 139, 0.25) 1px, transparent 1px)`,
                                    backgroundSize: `${zoomLevel}px ${zoomLevel}px`,
                                  }}
                                />
                              )}

                              {/* Synced Cursor Hover Box Overlay */}
                              {hoveredCell && (
                                <div
                                  className="absolute border-2 border-red-500 pointer-events-none z-10"
                                  style={{
                                    width: `${zoomLevel}px`,
                                    height: `${zoomLevel}px`,
                                    left: `${hoveredCell.x * zoomLevel}px`,
                                    top: `${hoveredCell.y * zoomLevel}px`,
                                  }}
                                />
                              )}
                            </div>
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

                          <div className="border border-stone-800 rounded-lg overflow-auto bg-stone-900 max-h-[480px] p-4 flex items-center justify-center min-h-[220px]">
                            <div
                              className="relative"
                              style={{
                                width: `${targetWidthPx * zoomLevel}px`,
                                height: `${targetHeightPx * zoomLevel}px`,
                              }}
                            >
                              <canvas
                                ref={gridCanvasRef}
                              onMouseDown={handleGridMouseDown}
                              onMouseMove={handleGridMouseMove}
                              onMouseUp={handleGridMouseUp}
                              onMouseLeave={() => {
                                handleMouseLeave();
                                handleGridMouseUp();
                              }}
                              className={`w-full h-full rounded shadow-lg select-none transition-all ${isPaintMode ? "cursor-cell ring-2 ring-red-500/50" : "cursor-crosshair"}`}
                              style={{
                                imageRendering: "pixelated",
                              }}
                            />

                            {/* Render simulated loom wire grid overlay using pure HTML borders over the top if enabled */}
                            {showGridOverlay && (
                              <div
                                className="absolute inset-0 pointer-events-none"
                                style={{
                                  backgroundImage: `linear-gradient(to right, rgba(100, 116, 139, 0.25) 1px, transparent 1px),
                                                    linear-gradient(to bottom, rgba(100, 116, 139, 0.25) 1px, transparent 1px)`,
                                  backgroundSize: `${zoomLevel}px ${zoomLevel}px`,
                                }}
                              />
                            )}

                            {/* Hover Overlay cell details */}
                            {hoveredCell && (
                              <div
                                className="absolute border-2 border-green-400 pointer-events-none z-10"
                                style={{
                                  width: `${zoomLevel}px`,
                                  height: `${zoomLevel}px`,
                                  left: `${hoveredCell.x * zoomLevel}px`,
                                  top: `${hoveredCell.y * zoomLevel}px`,
                                }}
                              />
                            )}
                            </div>
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

              {/* Real-time 3D Jacquard Fabric & Weave structure Simulator */}
              <JacquardWeaveSimulator
                targetWidthPx={targetWidthPx}
                targetHeightPx={targetHeightPx}
                yarns={yarns}
                getCellColor={getCellColor}
                isProcessing={isProcessingPaint}
              />

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
        <p className="mt-2 flex items-center justify-center gap-1.5 text-stone-600 hover:text-stone-400 transition-colors">
          <Github className="w-3.5 h-3.5" />
          <a
            href="https://github.com/sohrowardi"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-stone-300 transition-colors font-semibold"
          >
            @sohrowardi
          </a>
        </p>
      </footer>
    </div>
  );
}
