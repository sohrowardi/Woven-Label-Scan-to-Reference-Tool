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
