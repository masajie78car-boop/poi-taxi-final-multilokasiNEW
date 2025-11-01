import express from "express";
import bodyParser from "body-parser";
import fetch from "node-fetch";

const app = express();
app.use(bodyParser.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "poi-taxi-verify";
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;

// ✅ Verifikasi webhook dari Meta
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ Webhook verified!");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// ✅ Endpoint untuk menerima pesan
app.post("/webhook", async (req, res) => {
  try {
    const entry = req.body.entry?.[0];
    const changes = entry?.changes?.[0];
    const message = changes?.value?.messages?.[0];

    if (!message) {
      return res.sendStatus(200);
    }

    const from = message.from;
    const text = message.text?.body?.toLowerCase();

    console.log("📩 Pesan masuk:", text);

    if (text.startsWith("#daftarantrian")) {
      await sendMessage(from, "✅ Unit kamu terdaftar di antrian Mall Nusantara.");
    } else if (text.startsWith("#updateantrian")) {
      await sendMessage(from, "📋 Saat ini daftar antrian Mall Nusantara sedang diperbarui...");
    } else if (text.startsWith("#daftarlist")) {
      await sendMessage(from, "🚖 Kamu masuk daftar Stasiun Jatinegara (buffer).");
    } else if (text.startsWith("#updatelist")) {
      await sendMessage(from, "📋 Daftar antrian Stasiun Jatinegara sedang diperbarui...");
    } else {
      await sendMessage(from, "⚠️ Format tidak dikenali.");
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("❌ Error webhook:", err);
    res.sendStatus(500);
  }
});

async function sendMessage(to, text) {
  await fetch("https://graph.facebook.com/v20.0/me/messages", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      text: { body: text },
    }),
  });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("🚀 Server jalan di port", PORT));
