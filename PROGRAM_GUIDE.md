# Technical Architecture & Implementation Guide: Woven Label Scan-to-Reference Tool

This document provides a comprehensive breakdown of the **Woven Label Scan-to-Reference Tool** for our development team. It outlines the image pre-processing pipeline, the mathematical color translation space, the real-time drawing mechanics, and the automatic deskew alignment algorithms.

---

## 1. Operational Overview & Purpose

Woven label production systems (such as Jakob Müller's **MÜCAD**) require high-accuracy, pixel-perfect digital reference templates representing individual thread intersections (warp ends and weft picks). 

This tool serves as an interactive bridge between physical, high-resolution scans of care labels and the industrial loom programming system. It processes incoming physical scans, resamples them according to physical weave densities, snaps the colors to a target designer thread palette using perceptual color difference formulas, allows for sub-pixel correction, and outputs lossless indexed images and CSV pattern matrices.

---

## 2. Image Processing Pipeline & Digital Thread Resampling

```
[ Scanned Care Label (High-Res Image) ]
                   │
                   ▼
     [ Rotation / Deskew Alignment ]  <─── Automated Edge Projection Search (Auto Deskew)
                   │
                   ▼
     [ Contrast & Brightness Filters ]
                   │
                   ▼
    [ Sub-Pixel Block Neighborhood Averaging ]
                   │
                   ▼
     [ Perceptual CIELAB CIE76 Snapping ] <─── Interactive Paint Brush Overrides
                   │
                   ▼
 [ 1:1 Loom Pattern / MÜCAD Background Export ]
```

### 2.1 Spatial Thread Remapping
To convert physical dimensions (e.g., width in cm) into loom pixels (warp ends and weft picks), we evaluate the weave density specs:
*   $\text{Target Width (Pixels)} = \text{Label Width (cm)} \times \text{Warp Density (Ends/cm)}$
*   $\text{Target Height (Pixels)} = \text{Label Height (cm)} \times \text{Weft Density (Picks/cm)}$

### 2.2 Sub-Pixel Block Averaging
Once the target coordinates are defined, each grid cell $(gx, gy)$ maps to a bounding box in the high-resolution original image. We average the RGB channels within this sub-pixel block to obtain a representative color value that minimizes aliases and sensor noise:

$$\bar{R} = \frac{1}{N} \sum_{i=1}^{N} R_i, \quad \bar{G} = \frac{1}{N} \sum_{i=1}^{N} G_i, \quad \bar{B} = \frac{1}{N} \sum_{i=1}^{N} B_i$$

---

## 3. Mathematical Foundations of CIELAB Color Snapping

Standard RGB Euclidian distance does not correspond to how humans perceive color difference (e.g., yellow and green have similar mathematical Euclidean distance as dark blue and light blue, but look vastly different). To achieve thread-accurate matches, we translate RGB values into the **CIE $L^*a^*b^*$** color space, which is designed to be perceptually uniform.

### 3.1 RGB to XYZ Conversion
We first map standard RGB (sRGB) to the CIEXYZ color space by linearization (de-gamma) and matrix multiplication:

$$V_{\text{linear}} = \begin{cases} 
      \frac{V_{\text{srgb}}}{12.92} & V_{\text{srgb}} \le 0.04045 \\
      \left(\frac{V_{\text{srgb}} + 0.055}{1.055}\right)^{2.4} & V_{\text{srgb}} > 0.04045 
   \end{cases}$$

Using the D65 standard illuminant reference, we perform matrix multiplication:

$$\begin{bmatrix} X \\ Y \\ Z \end{bmatrix} = \begin{bmatrix} 
0.4124 & 0.3576 & 0.1805 \\ 
0.2126 & 0.7152 & 0.0722 \\ 
0.0193 & 0.1192 & 0.9505 
\end{bmatrix} \begin{bmatrix} R_{\text{linear}} \\ G_{\text{linear}} \\ B_{\text{linear}} \end{bmatrix}$$

### 3.2 XYZ to CIELAB Conversion
Using reference white points for D65 ($X_n = 95.047$, $Y_n = 100.000$, $Z_n = 108.883$):

$$L^* = 116 \cdot f\left(\frac{Y}{Y_n}\right) - 16$$
$$a^* = 500 \cdot \left[ f\left(\frac{X}{X_n}\right) - f\left(\frac{Y}{Y_n}\right) \right]$$
$$b^* = 200 \cdot \left[ f\left(\frac{Y}{Y_n}\right) - f\left(\frac{Z}{Z_n}\right) \right]$$

where:

$$f(t) = \begin{cases} 
      t^{1/3} & t > 0.008856 \\
      7.787 \cdot t + \frac{16}{116} & t \le 0.008856 
   \end{cases}$$

### 3.3 Perceptual Distance ($\Delta E_{76}$)
To find the closest match in the thread palette, we evaluate the Euclidian distance between the scanned cell's Lab coordinates $(L^*_1, a^*_1, b^*_1)$ and each yarn color's coordinates $(L^*_2, a^*_2, b^*_2)$:

$$\Delta E^*_{ab} = \sqrt{(L^*_2 - L^*_1)^2 + (a^*_2 - a^*_1)^2 + (b^*_2 - b^*_1)^2}$$

The color in the thread palette with the minimum $\Delta E$ is selected. Perceptual thresholds are visualized as follows:
*   **$\Delta E < 2.0$**: Excellent Match (near-imperceptible difference)
*   **$2.0 \le \Delta E < 5.0$**: Good Match (acceptable variation)
*   **$\Delta E \ge 5.0$**: Loose Fit (requires manual inspection)

---

## 4. Advanced Alignment & Automated Deskew Algorithm

To correct labels scanned with minor rotational misalignments, we evaluate the contrast projection profile along multiple angles $\theta \in [-15^\circ, +15^\circ]$.

### Projection Profile Analysis
For each angle $\theta$:
1.  We rotate the image canvas by $\theta$.
2.  We calculate the average intensity $P_y$ of horizontal rows (representing weft threads) and $P_x$ of vertical columns (representing warp threads).
3.  We evaluate the standard deviation/variance of these profiles. When threads are perfectly aligned with the axes, high-contrast rows and columns alternate, causing high variance.

$$V_{\text{row}} = \frac{1}{H} \sum_{y=1}^{H} (P_y - \bar{P}_y)^2, \quad V_{\text{col}} = \frac{1}{W} \sum_{x=1}^{W} (P_x - \bar{P}_x)^2$$

$$V_{\text{total}} = V_{\text{row}} + V_{\text{col}}$$

4.  The angle $\theta$ that maximizes $V_{\text{total}}$ is selected as the optimum alignment angle.

---

## 5. Interactive Correction State & Loom Pattern Export

### 5.1 Manual Loom Paint Brush
When manual correction mode is enabled, the editor intercepts pointer clicks and drags on the high-resolution grid.
*   **Manual Edits Storage**: Coordinates are recorded as string keys `"gx,gy"` mapped to the selected hex color in `manualEdits`.
*   **Eraser Mode**: Removing a coordinate override deletes the key from `manualEdits`, immediately restoring the automatic, real-time CIELAB snapped value.

### 5.2 Exporters
1.  **MÜCAD Lossless PNG**: Generates a raw $W \times H$ canvas containing exact palette color matches. This ensures a 1:1 pixel representation compatible with jacquard programming systems without compression artifacts.
2.  **Loom Pattern CSV Matrix**: Exports a comma-separated values file where each value corresponds to the 0-indexed yarn color ID of the selected palette. Industrial weavers can import this directly into loom control terminals.

---

## 6. Directory Structure & Key Files

*   `src/types.ts`: Holds schema declarations for `YarnColor`, `ImageParams`, and `TechSpecs`.
*   `src/utils/color.ts`: Performance-tuned implementation of RGB ➔ XYZ ➔ CIELAB conversions and CIE76 DeltaE distance evaluation.
*   `src/App.tsx`: Controls state synchronization, layout, multi-touch drag coordinates, pre-processing rendering, and export utilities.
