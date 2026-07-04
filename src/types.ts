/**
 * Domain types for the Woven Label Scan-to-Reference Tool.
 */

export interface YarnColor {
  id: string;
  hex: string;
  name: string;
  role: string;
  isMetallic?: boolean;
}

export interface ImageParams {
  brightness: number; // -100 to 100
  contrast: number;   // -100 to 100
  rotation: number;   // -180 to 180 degrees
  denoise: number;    // 0 to 5 (radius/strength)
  edgeDetect: boolean;
  sharpness: number;  // 0 to 100
}

export interface TechSpecs {
  widthMm: number;
  heightMm: number;
  warpDensity: number; // ends per cm
  weftDensity: number; // picks per cm
}

export interface GridNudge {
  offsetX: number; // px shift
  offsetY: number; // px shift
  scaleX: number;  // 1.0 is default
  scaleY: number;  // 1.0 is default
}

export interface AnalysisResult {
  estimatedWarpDensity: number;
  estimatedWeftDensity: number;
  estimatedWidthMm: number;
  estimatedHeightMm: number;
  weaveType: string;
  yarnPalette: Array<{
    hex: string;
    name: string;
    role: string;
  }>;
  mucadAdvice: string[];
}
