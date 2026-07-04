/**
 * Color utility functions for CIELAB snapping.
 */

export function rgbToXyz(r: number, g: number, b: number): [number, number, number] {
  let rL = r / 255;
  let gL = g / 255;
  let bL = b / 255;

  rL = rL > 0.04045 ? Math.pow((rL + 0.055) / 1.055, 2.4) : rL / 12.92;
  gL = gL > 0.04045 ? Math.pow((gL + 0.055) / 1.055, 2.4) : gL / 12.92;
  bL = bL > 0.04045 ? Math.pow((bL + 0.055) / 1.055, 2.4) : bL / 12.92;

  rL *= 100;
  gL *= 100;
  bL *= 100;

  // D65 Standard Observer
  const x = rL * 0.4124 + gL * 0.3576 + bL * 0.1805;
  const y = rL * 0.2126 + gL * 0.7152 + bL * 0.0722;
  const z = rL * 0.0193 + gL * 0.1192 + bL * 0.9505;

  return [x, y, z];
}

export function xyzToLab(x: number, y: number, z: number): [number, number, number] {
  // D65 Illuminant Reference
  const xN = 95.047;
  const yN = 100.000;
  const zN = 108.883;

  let xR = x / xN;
  let yR = y / yN;
  let zR = z / zN;

  xR = xR > 0.008856 ? Math.pow(xR, 1 / 3) : 7.787 * xR + 16 / 116;
  yR = yR > 0.008856 ? Math.pow(yR, 1 / 3) : 7.787 * yR + 16 / 116;
  zR = zR > 0.008856 ? Math.pow(zR, 1 / 3) : 7.787 * zR + 16 / 116;

  const l = 116 * yR - 16;
  const a = 500 * (xR - yR);
  const b = 200 * (yR - zR);

  return [l, a, b];
}

export function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  const [x, y, z] = rgbToXyz(r, g, b);
  return xyzToLab(x, y, z);
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const cleanHex = hex.replace("#", "");
  // Pad if short form
  let fullHex = cleanHex;
  if (cleanHex.length === 3) {
    fullHex = cleanHex
      .split("")
      .map((c) => c + c)
      .join("");
  }
  const num = parseInt(fullHex, 16) || 0;
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

export function hexToLab(hex: string): [number, number, number] {
  const { r, g, b } = hexToRgb(hex);
  return rgbToLab(r, g, b);
}

/**
 * CIELAB DeltaE76 color distance formula.
 * Represents human color difference perception accurately.
 */
export function getDeltaE76(lab1: [number, number, number], lab2: [number, number, number]): number {
  const dL = lab1[0] - lab2[0];
  const dA = lab1[1] - lab2[1];
  const dB = lab1[2] - lab2[2];
  return Math.sqrt(dL * dL + dA * dA + dB * dB);
}

/**
 * Snaps an RGB color to the closest color in the yarn palette using DeltaE76.
 */
export function snapToPalette(
  r: number,
  g: number,
  b: number,
  palette: Array<{ hex: string; isMetallic?: boolean }>,
  lurexThreshold: number = 220 // Bright specular reflection filter
): { hex: string; index: number } {
  if (palette.length === 0) {
    return { hex: "#ffffff", index: -1 };
  }

  // Specular check: if yarn is extremely bright and reflective,
  // check if we have a metallic/shiny thread in the palette to snap to
  const isBright = (r + g + b) / 3 > lurexThreshold;
  if (isBright) {
    const metallicYarnIdx = palette.findIndex((p) => p.isMetallic);
    if (metallicYarnIdx !== -1) {
      return { hex: palette[metallicYarnIdx].hex, index: metallicYarnIdx };
    }
  }

  const currentLab = rgbToLab(r, g, b);
  let minDistance = Infinity;
  let bestMatchIdx = 0;

  palette.forEach((color, idx) => {
    const targetLab = hexToLab(color.hex);
    const dist = getDeltaE76(currentLab, targetLab);
    if (dist < minDistance) {
      minDistance = dist;
      bestMatchIdx = idx;
    }
  });

  return { hex: palette[bestMatchIdx].hex, index: bestMatchIdx };
}
