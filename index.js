import express from "express";
import bodyParser from "body-parser";
import fetch from "node-fetch";

const app = express();
app.use(bodyParser.json()); // pastikan parse JSON

const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "poi-taxi-verify";
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN || "";
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID || ""; // wajib

// *** simple healthcheck root
app.get("/", (req, res) => res.send("POI Taxi Bot - server alive"));

// Verifikasi webhook (GET)
app.get("/webhook", (req, res) => {
  try {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    console.log("GET /webhook", { mode, token, challenge });
    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.sendStatus(403);
  } catch (e) {
    console.error("GET /webhook err", e);
    return res.sendStatus(500);
  }
});

// POST webhook (pesan masuk)
app.post("/webhook", async (req, res) => {
  try {
    console.log("POST /webhook body:", JSON.stringify(req.body).slice(0,2000));
    // navigasi payload dengan aman
    const messages = req.body?.entry?.[0]?.changes?.[0]?.value?.messages;
    if (!messages || !messages.length) {
      console.log("No messages in payload, returning 200");
      return res.sendStatus(200);
    }
    const message = messages[0];
    const from = message.from; // nomor pengirim
    const text = message.text?.body || "";
    console.log("📩 Pesan masuk dari:", from, "->", text);

    // contoh handling sederhana
    const lower = text.trim().toLowerCase();
    if (lower.startsWith("#daftarantrian")) {
      await sendMessage(from, "✅ Terdaftar: Mall Nusantara (uji)");
    } else if (lower.startsWith("#daftarlist")) {
      await sendMessage(from, "✅ Terdaftar: Stasiun Jatinegara (uji)");
    } else if (lower.startsWith("#updateantrian") || lower.startsWith("#updatelist")) {
      await sendMessage(from, "📋 Mengirim daftar (uji)...");
    } else {
      await sendMessage(from, "⚠️ Format tidak dikenali. Gunakan #daftarantrian atau #updateantrian");
    }

    return res.sendStatus(200);
  } catch (err) {
    console.error("POST /webhook error:", err);
    return res.sendStatus(500);
  }
});

// fungsi kirim WA menggunakan PHONE_NUMBER_ID (HARUS DISET DI ENV)
async function sendMessage(to, text) {
  try {
    if (!PHONE_NUMBER_ID || !WHATSAPP_TOKEN) {
      console.error("WHATSAPP_TOKEN or PHONE_NUMBER_ID missing!");
      return;
    }
    const url = `https://graph.facebook.com/v17.0/${PHONE_NUMBER_ID}/messages`;
    const body = {
      messaging_product: "whatsapp",
      to: to,
      type: "text",
      text: { body: text }
    };
    console.log("KIRIM ->", url, body);
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });
    const txt = await r.text();
    console.log("WA send response status:", r.status, "body:", txt);
    if (!r.ok) console.error("Gagal kirim WA:", r.status, txt);
  } catch (e) {
    console.error("sendMessage error:", e);
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server listening on port", PORT));
