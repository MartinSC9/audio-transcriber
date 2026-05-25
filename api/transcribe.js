import { writeFileSync, createReadStream, unlinkSync } from "fs";
import { join, extname } from "path";
import { tmpdir } from "os";
import Groq from "groq-sdk";

export const config = {
  api: {
    bodyParser: false,
  },
};

const ALLOWED_ORIGINS = [
  "https://audio-transcriber-ebon.vercel.app",
  "http://localhost:3500",
];

function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const buffer = Buffer.concat(chunks);
      const contentType = req.headers["content-type"] || "";
      const boundaryMatch = contentType.match(/boundary=(.+)/);
      if (!boundaryMatch) return reject(new Error("No boundary found"));

      const boundary = boundaryMatch[1];
      const parts = buffer.toString("binary").split(`--${boundary}`);
      const result = { fields: {}, file: null };

      for (const part of parts) {
        if (part === "--\r\n" || part === "--" || !part.trim()) continue;

        const [headerSection, ...bodyParts] = part.split("\r\n\r\n");
        if (!bodyParts.length) continue;

        const body = bodyParts.join("\r\n\r\n").replace(/\r\n$/, "");
        const nameMatch = headerSection.match(/name="([^"]+)"/);
        if (!nameMatch) continue;

        const filenameMatch = headerSection.match(/filename="([^"]+)"/);
        if (filenameMatch) {
          result.file = {
            name: filenameMatch[1],
            data: Buffer.from(body, "binary"),
          };
        } else {
          result.fields[nameMatch[1]] = body.trim();
        }
      }
      resolve(result);
    });
    req.on("error", reject);
  });
}

export default async function handler(req, res) {
  // CORS / Origin check
  const origin = req.headers["origin"] || req.headers["referer"] || "";
  const isAllowed = ALLOWED_ORIGINS.some((o) => origin.startsWith(o));

  if (!isAllowed) {
    return res.status(403).json({ error: "Acceso no autorizado" });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Verificar header custom anti-abuse
  const clientToken = req.headers["x-at-token"];
  if (clientToken !== "cu-digital-audio-transcriber-2024") {
    return res.status(403).json({ error: "Acceso no autorizado" });
  }

  let tmpPath = null;

  try {
    const { fields, file } = await parseMultipart(req);

    if (!file) {
      return res.status(400).json({ error: "No se recibio ningun archivo de audio" });
    }

    const ext = extname(file.name) || ".mp3";
    tmpPath = join(tmpdir(), `audio-${Date.now()}${ext}`);
    writeFileSync(tmpPath, file.data);

    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

    const transcription = await groq.audio.transcriptions.create({
      file: createReadStream(tmpPath),
      model: "whisper-large-v3",
      language: fields.language || undefined,
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
    if (tmpPath) try { unlinkSync(tmpPath); } catch {}
  }
}
