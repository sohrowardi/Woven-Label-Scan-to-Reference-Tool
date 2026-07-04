# Woven Label Scan-to-Reference Tool
### *A Technical Design Specification & Programmer Team Integration Guide*

This documentation provides a comprehensive architectural and operational breakdown of the **Woven Label Scan-to-Reference Tool**. It is designed for developers, systems engineers, and textile programmers maintaining or extending this utility.

---

## 1. Executive Summary & Purpose

The **Woven Label Scan-to-Reference Tool** is a specialized computer vision pre-processing utility. It sits directly between a physical yarn scanner/camera and Jakob Müller AG's proprietary **MÜCAD** software suite (Basic, Mini, Micro, Digicolor). 

In industrial Jacquard weaving, designs are built on rigid, discrete grids where **one pixel represents exactly one thread intersection** (warp end $\times$ weft pick) on the loom. Raw scans of physical labels are inherently noisy, rotated, warped, blurred, and suffer from scanner sensor glare (especially on metallic lurex yarns). 

This utility solves the visual fatigue and human error of manual translation by:
1. Isolating and deskewing the fabric rotation so thread axes align perfectly to $0^\circ$ and $90^\circ$.
2. Resampling continuous image coordinates into a discrete pixel grid calculated from target physical dimensions ($mm$) and loom density values ($ends/cm$ and $picks/cm$).
3. Snapping average thread colors to a **strictly non-anti-aliased designer yarn palette** using the perceptual **CIELAB (Delta E 76)** distance algorithm.
4. Exporting a clean, crisp, thread-accurate **1:1 reference template** that can be loaded straight into MÜCAD as a background design trace layer.

---

## 2. The MÜCAD Signature Theme Preset

To match the operational parameters of Jakob Müller AG's equipment and software conventions, the default sandbox mockup, interactive UI borders, and active theme are aligned to the signature MÜCAD palette:
*   🔴 **Red (#FF0000):** Represents the background pattern weave structure.
*   ⚪ **White (#FFFFFF):** Represents front-facing weft yarn (e.g. the Gear Symbol and *"Müller"* branding text).
*   ⚫ **Black (#000000):** Represents warp ground/structural selvages, borders, and pattern locks.

---

## 3. Core Processing Pipeline

The transformation from a blurry photograph to a crisp loom point-map occurs in five sequential, deterministic stages:

```
[Raw Physical Scan/Photo]
         │
         ▼
[1. Spatial Rotation & Deskew] ──► Uses bilinear/nearest-neighbor rotation matrices 
         │                         to align warp threads vertically & wefts horizontally.
         ▼
[2. Contrast & Light Correction] ──► Normalizes scanner sheen, specular peaks, and shadows.
         │
         ▼
[3. Grid Calculation & Mapping] ──► Width_px  = (Width_mm / 10) * Warp_Density
         │                          Height_px = (Height_mm / 10) * Weft_Density
         ▼
[4. Sub-Pixel Area Sampling] ──► Averages RGB values in the calculated bounding box of each 
         │                       individual thread cell.
         ▼
[5. CIELAB Delta E Snapping] ──► Converts averaged RGB to CIE XYZ, then to L*a*b*, 
         │                       and matches to nearest palette color with zero anti-aliasing.
         ▼
[Lossless PNG Reference Map]
```

### 3.1 Sub-Pixel Area Averaging Formula
For a grid cell index $(g_x, g_y)$ in the loom matrix where the original image width is $W_{orig}$ and target pixel grid is $W_{target}$:
$$\text{Cell Width } (C_w) = \frac{W_{orig}}{W_{target}}, \quad \text{Cell Height } (C_h) = \frac{H_{orig}}{H_{target}}$$

The pixel boundaries sampled on the processed canvas are bounded by:
$$X_{start} = \lfloor g_x \cdot C_w \rfloor, \quad X_{end} = \min\left(W_{orig}, \lfloor (g_x + 1) \cdot C_w \rfloor\right)$$
$$Y_{start} = \lfloor g_y \cdot C_h \rfloor, \quad Y_{end} = \min\left(H_{orig}, \lfloor (g_y + 1) \cdot C_h \rfloor\right)$$

All pixels within $[X_{start}..X_{end}] \times [Y_{start}..Y_{end}]$ are averaged to form a single, representative RGB triplet $\mathbf{C}_{avg} = (R_{avg}, G_{avg}, B_{avg})$.

### 3.2 CIELAB Snapping Algorithm
Standard RGB Euclidean distance is highly inaccurate for matching physical yarn colors because human eyes do not perceive color differences linearly. The system converts colors to the **CIELAB** space ($L^*, a^*, b^*$) before calculating distances.

1. **RGB to CIE XYZ (D65 Illuminant):**
   $$r' = f(R/255), \quad g' = f(G/255), \quad b' = f(B/255)$$
   where:
   $$f(V) = \left( \frac{V + 0.055}{1.055} \right)^{2.4} \text{ if } V > 0.04045 \text{ else } \frac{V}{12.92}$$
   $$X = 41.24r' + 35.76g' + 18.05b'$$
   $$Y = 21.26r' + 71.52g' + 7.22b'$$
   $$Z = 1.93r' + 11.92g' + 95.05b'$$

2. **CIE XYZ to CIE $L^*a^*b^*$:**
   $$L^* = 116 \cdot h(Y/100) - 16$$
   $$a^* = 500 \cdot \left[ h(X/95.047) - h(Y/100) \right]$$
   $$b^* = 200 \cdot \left[ h(Y/100) - h(Z/108.883) \right]$$
   where:
   $$h(t) = t^{1/3} \text{ if } t > 0.008856 \text{ else } 7.787t + \frac{16}{116}$$

3. **Delta E (CIE76) Distance Metric:**
   $$\Delta E^* = \sqrt{(\Delta L^*)^2 + (\Delta a^*)^2 + (\Delta b^*)^2}$$
   The grid cell snaps strictly to the palette yarn index $i$ that minimizes $\Delta E^*$.

---

## 4. Codebase Architecture

The application is structured as a full-stack Node.js (TypeScript) application utilizing **Express** for API endpoints and **React 19 (Vite + Tailwind CSS)** for the interactive designer frontend.

### 4.1 Key File Registry

*   `server.ts` **(Backend Entry point):** 
    Sets up an Express server on port 3000. Houses the `/api/analyze-scan` endpoint, proxying structured requests safely to the server-side **Gemini 3.5 Flash** API using the `@google/genai` SDK.
*   `src/App.tsx` **(Frontend Workstation):** 
    Consolidates the full workspace. Contains state management for physical densities, manual deskew rotations, interactive zoom triggers, live canvas mouse sync tracking, palette management, and custom mock presets.
*   `src/utils/color.ts` **(Color Engine):**
    Contains the mathematical RGB $\rightarrow$ XYZ $\rightarrow$ LAB $\rightarrow$ Delta E 76 matrix equations and lurex specular reflective overrides.
*   `src/types.ts` **(Global Types):**
    Holds domain type interfaces for `YarnColor`, `ImageParams`, `TechSpecs`, and `AnalysisResult`.
*   `package.json` **(Dependency Setup):**
    Configured for server-side TypeScript execution via `tsx` in dev, and bundles the server into `dist/server.cjs` via `esbuild` for production deployment.

### 4.2 API Specifications

#### `POST /api/analyze-scan`
Analyzes a base64 encoded label image and returns a structured JSON payload containing predicted weave properties, thread density recommendations, and MÜCAD-specific weaving suggestions.

**Request Payload:**
```json
{
  "base64Image": "data:image/png;base64,iVBORw0KGgo...",
  "mimeType": "image/png"
}
```

**Response Payload (Strict JSON Schema):**
```json
{
  "estimatedWarpDensity": 100,
  "estimatedWeftDensity": 80,
  "estimatedWidthMm": 45,
  "estimatedHeightMm": 15,
  "weaveType": "Damask",
  "yarnPalette": [
    { "hex": "#ff0000", "name": "Ground Red", "role": "Background" },
    { "hex": "#ffffff", "name": "White Polyester", "role": "Text Detail" },
    { "hex": "#000000", "name": "Binder Black", "role": "Selvage Outline" }
  ],
  "mucadAdvice": [
    "Suggested binding: Weft satin 5 shadow backing for Red to prevent weft distortion.",
    "Minimize floats longer than 1.5mm (approx 15 ends at 100 ends/cm) on white text boundaries.",
    "Increase catch weft frequency on reverse edges to prevent loose weft loops."
  ]
}
```

---

## 5. Developer Guide: Building & Running

### 5.1 Environment Variables (`.env`)
Create a `.env` file at the root level. Ensure `GEMINI_API_KEY` is present to support the intelligent thread analyzer:
```env
GEMINI_API_KEY="AIzaSyYourSecretKeyHere"
```

### 5.2 Commands

```bash
# 1. Install all dependencies (pre-configured)
npm install

# 2. Run the full-stack development workspace
npm run dev

# 3. Build both Vite frontend and esbuild CJS server
npm run build

# 4. Spin up the production bundle
npm start
```

---

## 6. MÜCAD Integration Checklist for the Designer
1.  **Read physical dimensions:** Measure the label and input the exact $Width \times Height$ in millimeters.
2.  **Refer to machine pitch:** Input the correct Ends/cm (Warp) and Picks/cm (Weft) corresponding to the loom setting.
3.  **Adjust rotation:** Move the slider to align the weave rows perfectly.
4.  **Confirm color palette:** Verify that only the exact yarn cones loaded on your creel are present in the color palette.
5.  **Lossless download:** Click **"Download MÜCAD Background"** to get a 1:1 pixel PNG file. 
6.  **Load Template:** Open MÜCAD, click *File $\rightarrow$ Background Template*, load your downloaded PNG, select "Match 1:1 Loom Pixels", and begin direct tracing with zero blurry pixels.
