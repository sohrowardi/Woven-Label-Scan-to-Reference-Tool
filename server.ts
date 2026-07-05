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

    const response = await ai.models.generateContent({
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

    const response = await ai.models.generateContent({
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

    const response = await ai.models.generateContent({
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
