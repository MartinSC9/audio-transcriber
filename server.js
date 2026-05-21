import { readFileSync } from "fs";
import { createReadStream, mkdirSync, unlinkSync } from "fs";
import { join, dirname, extname } from "path";
import { fileURLToPath } from "url";
import express from "express";
import multer from "multer";
import Groq from "groq-sdk";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Cargar .env manualmente (sin dotenv)
try {
  const envFile = readFileSync(join(__dirname, ".env"), "utf-8");
  for (const line of envFile.split("\n")) {
    const [key, ...rest] = line.split("=");
    if (key && rest.length) process.env[key.trim()] = rest.join("=").trim();
  }
} catch {}

const app = express();
const PORT = 3500;

// Crear carpeta uploads
mkdirSync(join(__dirname, "uploads"), { recursive: true });

const storage = multer.diskStorage({
  destination: join(__dirname, "uploads"),
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}${extname(file.originalname)}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB (limite de Whisper)
  fileFilter: (req, file, cb) => {
    const allowed = [
      "audio/mpeg",
      "audio/mp3",
      "audio/wav",
      "audio/mp4",
      "audio/m4a",
      "audio/webm",
      "audio/ogg",
      "audio/flac",
      "video/mp4",
      "video/webm",
    ];
    if (allowed.includes(file.mimetype) || file.originalname.match(/\.(mp3|wav|m4a|mp4|webm|ogg|flac|oga)$/i)) {
      cb(null, true);
    } else {
      cb(new Error(`Formato no soportado: ${file.mimetype}`));
    }
  },
});

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Servir frontend
app.get("/", (req, res) => {
  res.sendFile(join(__dirname, "public", "index.html"));
});
app.use(express.static(join(__dirname, "public")));

// Endpoint de transcripcion
app.post("/transcribe", upload.single("audio"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No se recibio ningun archivo de audio" });
  }

  const filePath = req.file.path;

  try {
    const transcription = await groq.audio.transcriptions.create({
      file: createReadStream(filePath),
      model: "whisper-large-v3",
      language: req.body.language || undefined,
      response_format: "verbose_json",
    });

    res.json({
      text: transcription.text,
      language: transcription.language,
      duration: transcription.duration,
      segments: transcription.segments,
    });
  } catch (err) {
    console.error("Error transcribiendo:", err.message);
    res.status(500).json({ error: err.message });
  } finally {
    try { unlinkSync(filePath); } catch {}
  }
});

app.listen(PORT, () => {
  console.log(`Audio Transcriber corriendo en http://localhost:${PORT}`);
});
