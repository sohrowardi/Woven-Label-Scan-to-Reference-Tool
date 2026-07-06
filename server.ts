import express from "express";
import path from "path";
import dotenv from "dotenv";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";

dotenv.config();

const app = express();
const PORT = 3000;

// Set high limit for JSON parser to allow receiving base64 image uploads comfortably
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// Initialize Google GenAI on the server
const apiKey = process.env.GEMINI_API_KEY;
const ai = apiKey
  ? new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    })
  : null;

// Helper function to call generateContent with retry and fallback mechanisms to avoid 503 UNAVAILABLE errors
async function generateContentWithRetry(aiClient: any, options: {
  model: string;
  contents: any;
  config?: any;
}) {
  const modelsToTry = [options.model, "gemini-3.1-flash-lite", "gemini-flash-latest"];
  const uniqueModels = Array.from(new Set(modelsToTry.filter(Boolean)));
  let lastError: any = null;

  for (const model of uniqueModels) {
    let attempts = 3;
    let delay = 1000; // start with 1s delay
    
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        console.log(`[Gemini API] Attempt ${attempt} using model: ${model}`);
        const response = await aiClient.models.generateContent({
          ...options,
          model: model,
        });
        return response;
      } catch (error: any) {
        lastError = error;
        const errMsg = error?.message || "";
        const errCode = error?.status || error?.code || error?.error?.code || 0;
        
        console.warn(`[Gemini API] Attempt ${attempt} failed with model ${model}. Status/Code: ${errCode}. Error: ${errMsg}`);
        
        const isTemporary = 
          errCode === 503 || 
          errCode === 429 || 
          errMsg.includes("503") || 
          errMsg.includes("429") || 
          errMsg.toLowerCase().includes("unavailable") || 
          errMsg.toLowerCase().includes("high demand") || 
          errMsg.toLowerCase().includes("exhausted") || 
          errMsg.toLowerCase().includes("rate limit");
          
        if (isTemporary && attempt < attempts) {
          console.log(`[Gemini API] Retrying in ${delay}ms...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
          delay *= 2; // exponential backoff
        } else {
          break;
        }
      }
    }
  }
  
  const isQuotaError = 
    lastError?.message?.includes("quota") || 
    lastError?.message?.includes("429") || 
    lastError?.message?.toLowerCase().includes("exhausted") || 
    lastError?.status === 429;
    
  if (isQuotaError) {
    throw new Error("You have exceeded your Gemini API Free Tier Quota limit (20 requests/day). To continue using the app without limits, please add your own paid API key in the Settings > Secrets panel (or check your billing plan).");
  }
  
  throw lastError || new Error("Failed to generate content after trying multiple models.");
}

// API Routes
app.post("/api/analyze-scan", async (req: express.Request, res: express.Response) => {
  try {
    if (!ai) {
      return res.status(500).json({
        error: "Gemini API is not configured. Please add your GEMINI_API_KEY in the Secrets panel.",
      });
    }

    const { base64Image, mimeType } = req.body;
    if (!base64Image) {
      return res.status(400).json({ error: "Missing image data." });
    }

    // Strip header if present
    const cleanBase64 = base64Image.replace(/^data:image\/\w+;base64,/, "");

    const systemInstruction = `You are a professional industrial textile engineer and woven label design consultant.
Your specialty is analyzing physical woven labels (brand labels, care labels) from high-resolution scans or photos and translating them into technical weaving parameters.
You are helping a designer recreate these labels inside MÜCAD (proprietary design software for Jakob Müller Jacquard looms).

Analyze the provided label scan and estimate:
1. Warp density (ends/cm) and Weft density (picks/cm). Typically warp is 60-120 and weft is 40-100 depending on Taffeta/Damask/Satin weave structures.
2. The physical dimensions of the label design area (Width and Height in mm).
3. The type of weave (e.g., Taffeta, Damask, Satin, HD Satin).
4. The exact yarn palette: extract up to 8 distinct solid yarn colors. Ignore shadows, folds, or lint. Group shiny/metallic (lurex) highlights into their true single solid underlying yarn color (e.g. gold, silver).
5. Detailed structural design recommendations specifically for MÜCAD (such as handling float length constraints, minimizing weft-packing density distortions, avoiding warp/weft bleed-through in red-on-white designs, and suggestions for weave-database bindings).

Your output must be structured, precise, and highly reliable.`;

    const userPrompt = "Analyze this physical woven label scan and extract all technical parameters for MÜCAD recreation.";

    const imagePart = {
      inlineData: {
        mimeType: mimeType || "image/png",
        data: cleanBase64,
      },
    };

    const textPart = {
      text: userPrompt,
    };

    const response = await generateContentWithRetry(ai, {
      model: "gemini-3.5-flash",
      contents: { parts: [imagePart, textPart] },
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            estimatedWarpDensity: {
              type: Type.NUMBER,
              description: "Estimated warp thread density (ends per cm), typically between 50 and 150.",
            },
            estimatedWeftDensity: {
              type: Type.NUMBER,
              description: "Estimated weft thread density (picks per cm), typically between 40 and 120.",
            },
            estimatedWidthMm: {
              type: Type.NUMBER,
              description: "Estimated physical width of the label in mm (e.g., 20 to 80).",
            },
            estimatedHeightMm: {
              type: Type.NUMBER,
              description: "Estimated physical height of the label in mm (e.g., 10 to 40).",
            },
            weaveType: {
              type: Type.STRING,
              description: "The identified weave structure, e.g., Damask, Double Damask, Satin, Taffeta, or HD Satin.",
            },
            yarnPalette: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  hex: { type: Type.STRING, description: "HEX color code (e.g., #FFFFFF)." },
                  name: { type: Type.STRING, description: "Descriptive name of the color." },
                  role: { type: Type.STRING, description: "The role of the yarn, e.g., 'Background', 'Primary text', 'Logo accent', or 'Shiny/Lurex'." },
                },
                required: ["hex", "name", "role"],
              },
              description: "List of detected distinct yarn colors in the label (typically 2 to 8).",
            },
            mucadAdvice: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: "Professional structural suggestions and advice for rebuilding this design in MÜCAD, considering floats, bleeding, and yarn types.",
            },
          },
          required: [
            "estimatedWarpDensity",
            "estimatedWeftDensity",
            "estimatedWidthMm",
            "estimatedHeightMm",
            "weaveType",
            "yarnPalette",
            "mucadAdvice",
          ],
        },
      },
    });

    const resultText = response.text;
    if (!resultText) {
      throw new Error("Empty response received from Gemini.");
    }

    const parsedData = JSON.parse(resultText.trim());
    return res.json(parsedData);
  } catch (error: any) {
    console.error("Gemini Scan Analysis Error:", error);
    return res.status(500).json({ error: error.message || "Failed to analyze label scan." });
  }
});

// AI Border Detection Endpoint
app.post("/api/detect-borders", async (req: express.Request, res: express.Response) => {
  try {
    if (!ai) {
      return res.status(500).json({
        error: "Gemini API is not configured. Please add your GEMINI_API_KEY in the Secrets panel.",
      });
    }

    const { base64Image, mimeType } = req.body;
    if (!base64Image) {
      return res.status(400).json({ error: "Missing image data." });
    }

    const cleanBase64 = base64Image.replace(/^data:image\/\w+;base64,/, "");

    const systemInstruction = `You are an expert computer vision and image preprocessing model specializing in physical woven textile labels.
Your task is to detect the active woven label in a raw image scan or photograph. The image may contain desktop backgrounds, scanner beds, borders, shadows, or other visual noise.
Identify the four corners of the actual physical woven label in the image:
1. Top-Left (topLeft)
2. Top-Right (topRight)
3. Bottom-Right (bottomRight)
4. Bottom-Left (bottomLeft)

Return these four corner points as percentage coordinates (0.0 to 100.0) relative to the image canvas.
For example, a point in the middle is { "x": 50.0, "y": 50.0 }. The top-left corner is { "x": 0.0, "y": 0.0 }.
Be highly precise and trace the outer boundaries of the woven fabric piece. Ignore the background completely.
Even if the label is slightly rotated, skewed, or at a perspective angle, output the exact corners of the label's shape.`;

    const userPrompt = "Identify the exact four corner points of the physical woven label in this scan. Return their positions as percentages of the total image width and height.";

    const response = await generateContentWithRetry(ai, {
      model: "gemini-3.5-flash",
      contents: {
        parts: [
          { inlineData: { mimeType: mimeType || "image/png", data: cleanBase64 } },
          { text: userPrompt }
        ]
      },
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            topLeft: {
              type: Type.OBJECT,
              properties: {
                x: { type: Type.NUMBER, description: "X percentage (0.0 - 100.0) of Top-Left corner." },
                y: { type: Type.NUMBER, description: "Y percentage (0.0 - 100.0) of Top-Left corner." }
              },
              required: ["x", "y"]
            },
            topRight: {
              type: Type.OBJECT,
              properties: {
                x: { type: Type.NUMBER, description: "X percentage (0.0 - 100.0) of Top-Right corner." },
                y: { type: Type.NUMBER, description: "Y percentage (0.0 - 100.0) of Top-Right corner." }
              },
              required: ["x", "y"]
            },
            bottomRight: {
              type: Type.OBJECT,
              properties: {
                x: { type: Type.NUMBER, description: "X percentage (0.0 - 100.0) of Bottom-Right corner." },
                y: { type: Type.NUMBER, description: "Y percentage (0.0 - 100.0) of Bottom-Right corner." }
              },
              required: ["x", "y"]
            },
            bottomLeft: {
              type: Type.OBJECT,
              properties: {
                x: { type: Type.NUMBER, description: "X percentage (0.0 - 100.0) of Bottom-Left corner." },
                y: { type: Type.NUMBER, description: "Y percentage (0.0 - 100.0) of Bottom-Left corner." }
              },
              required: ["x", "y"]
            },
            confidence: { type: Type.NUMBER, description: "Confidence score between 0.0 and 1.0" }
          },
          required: ["topLeft", "topRight", "bottomRight", "bottomLeft", "confidence"]
        }
      }
    });

    const resultText = response.text;
    if (!resultText) {
      throw new Error("Empty response received from Gemini.");
    }

    const parsedData = JSON.parse(resultText.trim());
    return res.json(parsedData);
  } catch (error: any) {
    console.error("Gemini Detect Borders Error:", error);
    return res.status(500).json({ error: error.message || "Failed to detect label borders." });
  }
});

// AI Thread Angle Detection Endpoint
app.post("/api/detect-thread-angle", async (req: express.Request, res: express.Response) => {
  try {
    if (!ai) {
      return res.status(500).json({
        error: "Gemini API is not configured. Please add your GEMINI_API_KEY in the Secrets panel.",
      });
    }

    const { base64Image, mimeType } = req.body;
    if (!base64Image) {
      return res.status(400).json({ error: "Missing image data." });
    }

    const cleanBase64 = base64Image.replace(/^data:image\/\w+;base64,/, "");

    const systemInstruction = `You are a specialist computer vision model for textile engineering and physical weave structure analysis.
Your job is to inspect the high-resolution scanned woven label image and determine the rotation angle needed to align the warp and weft threads perfectly to the grid.
Identify the vertical warp thread direction and the horizontal weft thread direction.
Determine the angle in degrees (normally between -45.0 and 45.0) that the image should be rotated clockwise (positive values) or counter-clockwise (negative values) to make:
1. The vertical threads (warp) parallel to the Y-axis (completely straight vertical orientation).
2. The horizontal threads (weft) parallel to the X-axis (completely straight horizontal orientation).

Analyze text lines, woven grid lines, edges, and texture to determine this rotation alignment correction with extreme precision. Even if the texture is subtle or fine, find the primary orientation grid.`;

    const userPrompt = "Determine the rotation correction angle in degrees to straighten the warp and weft thread alignment of this label.";

    const response = await generateContentWithRetry(ai, {
      model: "gemini-3.5-flash",
      contents: {
        parts: [
          { inlineData: { mimeType: mimeType || "image/png", data: cleanBase64 } },
          { text: userPrompt }
        ]
      },
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            rotationAngle: {
              type: Type.NUMBER,
              description: "The rotation angle in degrees to apply. Positive for clockwise, negative for counter-clockwise."
            },
            confidence: { type: Type.NUMBER, description: "Confidence score between 0.0 and 1.0" },
            reasoning: { type: Type.STRING, description: "Brief description of the analysis." }
          },
          required: ["rotationAngle", "confidence", "reasoning"]
        }
      }
    });

    const resultText = response.text;
    if (!resultText) {
      throw new Error("Empty response received from Gemini.");
    }

    const parsedData = JSON.parse(resultText.trim());
    return res.json(parsedData);
  } catch (error: any) {
    console.error("Gemini Detect Thread Angle Error:", error);
    return res.status(500).json({ error: error.message || "Failed to detect thread angle." });
  }
});

// Unified AI Border Detection & Thread Straightening Endpoint
app.post("/api/auto-detect-straighten", async (req: express.Request, res: express.Response) => {
  try {
    if (!ai) {
      return res.status(500).json({
        error: "Gemini API is not configured. Please add your GEMINI_API_KEY in the Secrets panel.",
      });
    }

    const { base64Image, mimeType } = req.body;
    if (!base64Image) {
      return res.status(400).json({ error: "Missing image data." });
    }

    const cleanBase64 = base64Image.replace(/^data:image\/\w+;base64,/, "");

    const systemInstruction = `You are an expert computer vision system and textile engineer specializing in physical woven labels.
Your task is to analyze the scanned woven label image and identify BOTH the active outer boundary corners of the label and the required rotation correction angle to perfectly align the threads.

1. OUTER BORDERS (topLeft, topRight, bottomRight, bottomLeft):
   Identify the four corners of the actual physical woven label in the image.
   The scan might contain background colors, scanner beds, borders, shadows, or other noise. Identify the exact outer borders of the woven fabric piece.
   Return these as percentage coordinates (0.0 to 100.0) relative to the image canvas.
   - topLeft: top-left corner (typically around x: 10, y: 10)
   - topRight: top-right corner (typically around x: 90, y: 10)
   - bottomRight: bottom-right corner (typically around x: 90, y: 90)
   - bottomLeft: bottom-left corner (typically around x: 10, y: 90)

2. THREAD ALIGNMENT ROTATION (rotationAngle):
   Identify the vertical warp thread direction and the horizontal weft thread direction.
   Determine the angle in degrees (normally between -45.0 and 45.0) that the image should be rotated clockwise (positive values) or counter-clockwise (negative values) to make:
   - The vertical threads (warp) parallel to the Y-axis (completely straight vertical orientation).
   - The horizontal threads (weft) parallel to the X-axis (completely straight horizontal orientation).

Ensure the analysis is highly intelligent and robust, disregarding scanning noise, warp/weft skewing, or perspective distortion. Return all values inside a single JSON object.`;

    const userPrompt = "Analyze this physical woven label scan. Detect the exact four corners of the label as percentage coordinates and find the precise thread alignment correction angle in degrees.";

    const response = await generateContentWithRetry(ai, {
      model: "gemini-3.5-flash",
      contents: {
        parts: [
          { inlineData: { mimeType: mimeType || "image/png", data: cleanBase64 } },
          { text: userPrompt }
        ]
      },
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            topLeft: {
              type: Type.OBJECT,
              properties: {
                x: { type: Type.NUMBER, description: "X percentage (0.0 - 100.0) of Top-Left corner." },
                y: { type: Type.NUMBER, description: "Y percentage (0.0 - 100.0) of Top-Left corner." }
              },
              required: ["x", "y"]
            },
            topRight: {
              type: Type.OBJECT,
              properties: {
                x: { type: Type.NUMBER, description: "X percentage (0.0 - 100.0) of Top-Right corner." },
                y: { type: Type.NUMBER, description: "Y percentage (0.0 - 100.0) of Top-Right corner." }
              },
              required: ["x", "y"]
            },
            bottomRight: {
              type: Type.OBJECT,
              properties: {
                x: { type: Type.NUMBER, description: "X percentage (0.0 - 100.0) of Bottom-Right corner." },
                y: { type: Type.NUMBER, description: "Y percentage (0.0 - 100.0) of Bottom-Right corner." }
              },
              required: ["x", "y"]
            },
            bottomLeft: {
              type: Type.OBJECT,
              properties: {
                x: { type: Type.NUMBER, description: "X percentage (0.0 - 100.0) of Bottom-Left corner." },
                y: { type: Type.NUMBER, description: "Y percentage (0.0 - 100.0) of Bottom-Left corner." }
              },
              required: ["x", "y"]
            },
            rotationAngle: {
              type: Type.NUMBER,
              description: "The rotation angle in degrees to apply. Positive for clockwise, negative for counter-clockwise."
            },
            confidence: { type: Type.NUMBER, description: "Confidence score between 0.0 and 1.0" },
            reasoning: { type: Type.STRING, description: "Brief description of the border and angle analysis." }
          },
          required: ["topLeft", "topRight", "bottomRight", "bottomLeft", "rotationAngle", "confidence", "reasoning"]
        }
      }
    });

    const resultText = response.text;
    if (!resultText) {
      throw new Error("Empty response received from Gemini.");
    }

    const parsedData = JSON.parse(resultText.trim());
    return res.json(parsedData);
  } catch (error: any) {
    console.error("Gemini Auto-Detect-Straighten Error:", error);
    return res.status(500).json({ error: error.message || "Failed to auto-detect and straighten label." });
  }
});

// AI Artwork Reconstruction & Vector Refinement Endpoint
app.post("/api/reconstruct-artwork", async (req: express.Request, res: express.Response) => {
  try {
    if (!ai) {
      return res.status(500).json({
        error: "Gemini API is not configured. Please add your GEMINI_API_KEY in the Secrets panel.",
      });
    }

    const { base64Image, mimeType, paletteColors, refinementPrompt } = req.body;
    if (!base64Image) {
      return res.status(400).json({ error: "Missing image data." });
    }

    const cleanBase64 = base64Image.replace(/^data:image\/\w+;base64,/, "");

    const colorsDescription = paletteColors && paletteColors.length > 0
      ? `The target label yarn palette contains these solid colors:
${paletteColors.map((c: any) => `- HEX: ${c.hex} (Name: ${c.name}, Role: ${c.role})`).join("\n")}
You MUST ONLY use these exact HEX colors for your fill and stroke attributes in the SVG. Do NOT introduce any other colors!`
      : "Ensure you use distinct, high-contrast solid colors that match the scanned label colors.";

    const refinementInstructions = refinementPrompt
      ? `\nCRITICAL CUSTOM MODIFICATION REQUEST BY THE DESIGNER:
The user has requested these specific modifications to the reconstructed vector artwork:
"${refinementPrompt}"
You MUST strictly incorporate this modification into the generated SVG while retaining all other layout details faithfully. Change coordinates, text, layout, colors or shapes as instructed.`
      : "";

    const systemInstruction = `You are a professional digital label designer and vector graphic artist specializing in physical woven textile label reconstructions.
Your task is to analyze the scanned physical woven label image (which has thread textures, dust, shadows, noise, blurred text, and scanning artifacts) and reconstruct its clean, pristine digital artwork as a single, perfectly valid, fully self-contained SVG document.

CRITICAL AESTHETIC & MATHEMATICAL DIRECTIVES (NO NOISE, 100% SMOOTH):
1. NO SCANNING OR THREAD NOISE:
   - You MUST NOT trace any weave grain, fabric fibers, warp/weft textures, or pixel noise. 
   - Every shape, border, and character MUST be perfectly flat, solid, and smooth.
   - Do NOT output thousands of tiny, dense, jagged path segments. Smooth out all curves and straighten all lines.

2. TRACING & GEOMETRIC RECONSTRUCTION:
   - Reconstruct borders, frames, and background stripes using mathematically straight, crisp '<rect>' elements or simple clean lines, rather than crooked paths.
   - Recreate emblems, icons, logos, or brand marks using clean, simplified vector geometries. Use the minimum number of control points necessary. Use smooth cubic/quadratic Bézier curve segments ('C', 'S', 'Q', 'T') for rounded parts to ensure 100% smooth curves.

3. TYPOGRAPHY IS ABSOLUTE (DO NOT TRACE LETTERS AS PATHS):
   - You are STRICTLY FORBIDDEN from drawing or tracing characters, letters, or words as jagged path coordinates. Tracing text makes it look messy and crooked.
   - Instead, you MUST represent all text using actual SVG <text> tags with appropriate font-family, font-size, font-weight, letter-spacing, and coordinates.
   - Identify the font style on the scanned label:
     * If geometric sans-serif (Futura-like), use "Space Grotesk", "Montserrat", "Inter", or "Bebas Neue".
     * If clean neo-grotesque, use "Inter" or "Roboto".
     * If classic elegant serif (Garamond/Baskerville), use "EB Garamond" or "Lora".
     * If high-contrast premium luxury serif (Didot/Bodoni), use "Playfair Display" or "Cinzel".
     * If technical monospaced, use "JetBrains Mono" or "Fira Code".
   - Embed the Google Font stylesheet using an @import statement inside a <style> block at the top of your SVG, e.g.:
     \`@import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;700&family=Montserrat:wght@400;600&family=Space+Grotesk:wght@400;700&display=swap');\`
   - Apply the correct \`font-family\` attribute to your \`<text>\` elements. Adjust \`letter-spacing\`, \`font-weight\`, and font size to perfectly replicate the layout and spacing.

4. COLOR PALETTE FIDELITY:
   ${colorsDescription}
   Every visible component (background, texts, paths, borders) must be filled or stroked with a color from this palette. The background MUST be a full-size solid background '<rect>' (e.g. width="100%" height="100%") filled with the main background color.

5. CONSERVATIVE & FAITHFUL RESTORATION:
   - Keep exact relative sizes, positions, alignments, and aspect ratios.
   - Recreate the clean original vector artwork that the physical weaving machine was programmed with.${refinementInstructions}

The output must be a single, complete, valid SVG string. Return ONLY the JSON object with properties 'cleanSvg', 'detectedFonts', and 'reasoning'.`;

    const userPrompt = refinementPrompt
      ? `Reconstruct the scanned woven label label with the following modification: ${refinementPrompt}. Return a single-page clean SVG code, a list of detected Google fonts, and your brief reasoning.`
      : `Perform a high-fidelity vector reconstruction of the scanned woven label label. Return a single-page clean SVG code, a list of detected Google fonts, and your brief reasoning.`;

    const response = await generateContentWithRetry(ai, {
      model: "gemini-3.5-flash",
      contents: [
        { inlineData: { mimeType: mimeType || "image/png", data: cleanBase64 } },
        { text: userPrompt }
      ],
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            cleanSvg: {
              type: Type.STRING,
              description: "The complete, valid SVG markup string containing the reconstructed vector artwork. It must start with '<svg' and end with '</svg>'. Must include the embedded Google Font imports and styles."
            },
            detectedFonts: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: "The Google Font family names identified and imported in the SVG."
            },
            reasoning: {
              type: Type.STRING,
              description: "Brief reasoning about font matching, text layout, logo geometries traced, and color assignments."
            }
          },
          required: ["cleanSvg", "detectedFonts", "reasoning"]
        }
      }
    });

    const resultText = response.text;
    if (!resultText) {
      throw new Error("Empty response received from Gemini.");
    }

    const parsedData = JSON.parse(resultText.trim());
    return res.json(parsedData);
  } catch (error: any) {
    console.error("Gemini Artwork Reconstruct Error:", error);
    return res.status(500).json({ error: error.message || "Failed to reconstruct artwork." });
  }
});

// AI Yarn Color Palette Generator Endpoint
app.post("/api/generate-palette", async (req: express.Request, res: express.Response) => {
  try {
    if (!ai) {
      return res.status(500).json({
        error: "Gemini API is not configured. Please add your GEMINI_API_KEY in the Secrets panel.",
      });
    }

    const { prompt, currentPalette } = req.body;
    if (!prompt) {
      return res.status(400).json({ error: "Missing prompt specification." });
    }

    const currentDesc = currentPalette && currentPalette.length > 0
      ? `Here is the current active yarn palette:\n${currentPalette.map((c: any) => `- HEX: ${c.hex}, Name: ${c.name}, Role: ${c.role}`).join("\n")}`
      : "No active palette currently set.";

    const systemInstruction = `You are an expert textile designer specializing in color theory and yarn dyes for premium damask and satin woven labels.
Your goal is to generate a harmonized color palette of 2 to 8 solid yarn colors based on the user's specific request or desired aesthetic mood (e.g. "metallic elegance", "heritage organic cotton", "retro athletic").

For each yarn, define:
1. hex: A perfectly matched hexadecimal color code (e.g. "#D4AF37" for gold).
2. name: A beautiful, industry-appropriate dye name (e.g. "Warm Marigold", "Indigo Navy", "Bleached Linen").
3. role: The design role this thread will play in the warp/weft binding (e.g. "Background Ground", "Main Text", "Shiny Accent Outline", "Border Trim").

${currentDesc}
Ensure the resulting colors are harmonious, highly distinct, and fully ready for weaving machine threading setups.`;

    const response = await generateContentWithRetry(ai, {
      model: "gemini-3.5-flash",
      contents: { text: `Generate a cohesive weaving yarn palette based on this design theme: "${prompt}"` },
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            yarnPalette: {
              type: Type.ARRAY,
              description: "The harmonized dye colors representing the yarn palette.",
              items: {
                type: Type.OBJECT,
                properties: {
                  hex: { type: Type.STRING, description: "Color hexadecimal code starting with '#' (e.g., #2C5E43)." },
                  name: { type: Type.STRING, description: "Professional textile shade name (e.g., Pine Green)." },
                  role: { type: Type.STRING, description: "Primary role of this yarn color in the woven label." }
                },
                required: ["hex", "name", "role"]
              }
            },
            reasoning: {
              type: Type.STRING,
              description: "Explanation of why these yarn colors were chosen for the requested theme."
            }
          },
          required: ["yarnPalette", "reasoning"]
        }
      }
    });

    const parsedData = JSON.parse(response.text?.trim() || "{}");
    return res.json(parsedData);
  } catch (error: any) {
    console.error("Gemini Palette Generation Error:", error);
    return res.status(500).json({ error: error.message || "Failed to generate yarn color palette." });
  }
});

// AI Smart Filter Optimization Preset Endpoint
app.post("/api/ai-filter-preset", async (req: express.Request, res: express.Response) => {
  try {
    if (!ai) {
      return res.status(500).json({
        error: "Gemini API is not configured. Please add your GEMINI_API_KEY in the Secrets panel.",
      });
    }

    const { base64Image, mimeType, presetName } = req.body;
    if (!presetName) {
      return res.status(400).json({ error: "Missing preset selection." });
    }

    const hasImage = !!base64Image;
    const cleanBase64 = hasImage ? base64Image.replace(/^data:image\/\w+;base64,/, "") : "";

    const systemInstruction = `You are an expert digital scan restorer and image processing specialist.
Your task is to recommend optimal digital canvas filter coefficients to pre-process a woven label scan according to a specific enhancement goal:
- "high-contrast": Amplify edges and eliminate shadows to clearly distinguish boundaries.
- "shadow-reduction": Brighten dark folds or uneven lighting from a curved label scan.
- "sharp-text": Highlight small care instructions text or branding fonts.
- "glow-reduction": Dampen reflections or glare from shiny metallic lurex threads.

Provide the exact slider coefficients:
1. brightness: integer offset from -50 to 50.
2. contrast: integer offset from -50 to 70.
3. sharpness: integer offset from 0 to 50.
4. denoise: integer from 1 to 5.
5. edgeDetect: boolean (true if high contrast borders are needed).`;

    const userPrompt = `Determine the ideal image pre-processing parameters for the preset "${presetName}".` +
      (hasImage ? " Base your decision on analyzing the provided scan characteristics." : "");

    const contents: any[] = [];
    if (hasImage) {
      contents.push({ inlineData: { mimeType: mimeType || "image/png", data: cleanBase64 } });
    }
    contents.push({ text: userPrompt });

    const response = await generateContentWithRetry(ai, {
      model: "gemini-3.5-flash",
      contents,
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            brightness: { type: Type.INTEGER, description: "Brightness value from -50 to 50." },
            contrast: { type: Type.INTEGER, description: "Contrast value from -50 to 70." },
            sharpness: { type: Type.INTEGER, description: "Sharpness filter factor from 0 to 50." },
            denoise: { type: Type.INTEGER, description: "Denoise kernel size from 1 to 5." },
            edgeDetect: { type: Type.BOOLEAN, description: "Whether to enable high-pass edge detection." },
            reasoning: { type: Type.STRING, description: "Reasoning for choosing these coefficients." }
          },
          required: ["brightness", "contrast", "sharpness", "denoise", "edgeDetect", "reasoning"]
        }
      }
    });

    const parsedData = JSON.parse(response.text?.trim() || "{}");
    return res.json(parsedData);
  } catch (error: any) {
    console.error("Gemini Filter Preset Error:", error);
    return res.status(500).json({ error: error.message || "Failed to calculate smart filter presets." });
  }
});

// AI Loom Specifications Consultant Endpoint
app.post("/api/ai-loom-specs", async (req: express.Request, res: express.Response) => {
  try {
    if (!ai) {
      return res.status(500).json({
        error: "Gemini API is not configured. Please add your GEMINI_API_KEY in the Secrets panel.",
      });
    }

    const { currentSpecs, query, base64Image, mimeType } = req.body;
    if (!query) {
      return res.status(400).json({ error: "Missing engineering query." });
    }

    const hasImage = !!base64Image;
    const cleanBase64 = hasImage ? base64Image.replace(/^data:image\/\w+;base64,/, "") : "";

    const systemInstruction = `You are a legendary Jakob Müller weaving loom engineer and senior MÜCAD textile programming consultant.
Your job is to assist design engineers in calculating the absolute optimal label dimensions (width/height in mm) and thread densities (warp ends/cm and weft picks/cm) to program into Jacquard looms.

You must solve the user's specific weaving prompt, such as:
- "adjust for ultra fine silk yarns to get crisp text"
- "calculate specs for a thick cotton badge label"
- "optimize warp/weft ratio to avoid shrinkage during heat press"

Respond with adjusted values:
1. widthMm: The physical width in mm.
2. heightMm: The physical height in mm.
3. warpDensity: Warp ends per cm.
4. weftDensity: Weft picks per cm.
5. advice: Bullet points of expert advice for MÜCAD loom setup.
6. reasoning: Mathematical or physical justification for your suggested values.`;

    const contents: any[] = [];
    if (hasImage) {
      contents.push({ inlineData: { mimeType: mimeType || "image/png", data: cleanBase64 } });
    }
    contents.push({
      text: `Calculate the optimal loom parameters based on this prompt: "${query}".
Current Setup Specs: Width ${currentSpecs.widthMm}mm, Height ${currentSpecs.heightMm}mm, Warp ${currentSpecs.warpDensity} ends/cm, Weft ${currentSpecs.weftDensity} picks/cm.`
    });

    const response = await generateContentWithRetry(ai, {
      model: "gemini-3.5-flash",
      contents,
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            widthMm: { type: Type.NUMBER },
            heightMm: { type: Type.NUMBER },
            warpDensity: { type: Type.NUMBER },
            weftDensity: { type: Type.NUMBER },
            advice: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Specific steps to carry out in MÜCAD loom programming." },
            reasoning: { type: Type.STRING, description: "Technical and physical weaving arguments." }
          },
          required: ["widthMm", "heightMm", "warpDensity", "weftDensity", "advice", "reasoning"]
        }
      }
    });

    const parsedData = JSON.parse(response.text?.trim() || "{}");
    return res.json(parsedData);
  } catch (error: any) {
    console.error("Gemini Loom Specs Error:", error);
    return res.status(500).json({ error: error.message || "Failed to calculate loom specifications." });
  }
});

// AI Paint & Manual Grid Correction Copilot Endpoint
app.post("/api/ai-paint-copilot", async (req: express.Request, res: express.Response) => {
  try {
    if (!ai) {
      return res.status(500).json({
        error: "Gemini API is not configured. Please add your GEMINI_API_KEY in the Secrets panel.",
      });
    }

    const { width, height, paletteColors, instruction } = req.body;
    if (!width || !height || !instruction) {
      return res.status(400).json({ error: "Missing dimensions or brush instructions." });
    }

    const paletteDesc = paletteColors && paletteColors.length > 0
      ? `You MUST ONLY assign pixels to the following HEX color codes or use the value "eraser" to clear overrides:\n${paletteColors.map((c: any) => `- ${c.hex} (${c.name})`).join("\n")}`
      : "Assign pixels to clear, solid hex colors or use 'eraser'.";

    const systemInstruction = `You are a digital Jacquard weave grid painter. You translate pixel-brush painting instructions into a list of grid coordinates to edit.
The grid size is ${width} columns (x from 0 to ${width - 1}) and ${height} rows (y from 0 to ${height - 1}).

${paletteDesc}

Analyze the user's painting request (e.g. "draw a 1-pixel yellow horizontal line in the exact middle", "paint a blue square of size 5 in the center", "erase a border around the entire map") and return a precise list of coordinate edits.
Avoid outputting more than 400 coordinate objects to stay within token sizes. Keep edits elegant and minimal.

Returns an array of:
- x: column index (0 to ${width - 1})
- y: row index (0 to ${height - 1})
- hex: the color HEX code or "eraser"`;

    const response = await generateContentWithRetry(ai, {
      model: "gemini-3.5-flash",
      contents: { text: `Weaving grid instruction: "${instruction}"` },
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            edits: {
              type: Type.ARRAY,
              description: "The list of cell color overrides to apply to the loom pixel map.",
              items: {
                type: Type.OBJECT,
                properties: {
                  x: { type: Type.INTEGER },
                  y: { type: Type.INTEGER },
                  hex: { type: Type.STRING, description: "Hexadecimal color from the palette, or 'eraser'." }
                },
                required: ["x", "y", "hex"]
              }
            },
            reasoning: { type: Type.STRING, description: "Explanation of how the brush coordinates were calculated." }
          },
          required: ["edits", "reasoning"]
        }
      }
    });

    const parsedData = JSON.parse(response.text?.trim() || "{}");
    return res.json(parsedData);
  } catch (error: any) {
    console.error("Gemini Paint Copilot Error:", error);
    return res.status(500).json({ error: error.message || "Failed to process manual paint instructions." });
  }
});

// Configure Vite or Static Asset delivery
async function setupServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Woven Label Reference Tool server listening on port ${PORT}`);
  });
}

setupServer().catch((err) => {
  console.error("Failed to start server:", err);
});
