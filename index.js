import fetch from "node-fetch";
import { initializeApp } from "firebase/app";
import { getDatabase, ref, get, set } from "firebase/database";

// === FIREBASE INIT ===
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  databaseURL: process.env.DATABASE_URL,
};
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

export default async function handler(req, res) {
  // === VERIFIKASI DARI META ===
  if (req.method === "GET") {
    const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode && token && mode === "subscribe" && token === VERIFY_TOKEN) {
      console.log("✅ WEBHOOK VERIFIED");
      res.status(200).send(challenge);
    } else {
      res.status(403).send("Verification failed");
    }
    return;
  }

  // === TERIMA PESAN WA ===
  if (req.method === "POST") {
    try {
      const change = req.body.entry?.[0]?.changes?.[0]?.value;
      const message = change?.messages?.[0];
      if (!message) return res.status(200).send("No message");

      const from = message.from;
      const text = (message.text?.body || "").trim().toLowerCase();
      console.log("Pesan masuk:", text);

      if (text.startsWith("#daftarantrian")) {
        await handleDaftar(from, text, "mall_nusantara");
      } else if (text.startsWith("#updateantrian")) {
        await handleUpdate(from, "mall_nusantara");
      } else if (text.startsWith("#daftarlist")) {
        await handleDaftar(from, text, "stasiun_jatinegara");
      } else if (text.startsWith("#updatelist")) {
        await handleUpdate(from, "stasiun_jatinegara");
      } else {
        await sendMessage(from, "⚠️ Format tidak dikenal.");
      }

      res.status(200).send("EVENT_RECEIVED");
    } catch (err) {
      console.error("❌ Error Webhook:", err);
      res.status(500).send("Server error");
    }
  } else {
    res.status(405).send("Method Not Allowed");
  }
}

// === DAFTAR ANTRIAN ===
async function handleDaftar(from, text, lokasi) {
  const parts = text.split(" ");
  const noPol = parts[1]?.toUpperCase();

  if (!noPol) {
    return sendMessage(from, "❌ Format salah. Gunakan: #daftarantrian B1234XYZ");
  }

  const snap = await get(ref(db, `pangkalan/${lokasi}/antrian`));
  const data = snap.val() || {};
  const aktif = Object.values(data).filter((d) => d.status === "aktif");
  const status = aktif.length >= 3 ? "buffer" : "aktif";

  await set(ref(db, `pangkalan/${lokasi}/antrian/${noPol}`), {
    noPol,
    status,
    createdAt: new Date().toISOString(),
  });

  await sendMessage(from, `✅ ${noPol} terdaftar di *${lokasi.replace("_", " ")}*\nStatus: ${status}`);
}

// === UPDATE ANTRIAN ===
async function handleUpdate(from, lokasi) {
  const snap = await get(ref(db, `pangkalan/${lokasi}/antrian`));
  const data = snap.val() || {};

  if (Object.keys(data).length === 0) {
    return sendMessage(from, "📋 Belum ada antrian aktif.");
  }

  const list = Object.values(data)
    .map((d, i) => `${i + 1}. ${d.noPol} (${d.status})`)
    .join("\n");

  await sendMessage(from, `📋 *Antrian ${lokasi.replace("_", " ")}:*\n${list}`);
}

// === KIRIM PESAN ===
async function sendMessage(to, text) {
  const token = process.env.ACCESS_TOKEN;
  const phoneId = process.env.PHONE_ID;

  await fetch(`https://graph.facebook.com/v19.0/${phoneId}/messages`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      text: { body: text },
    }),
  });
}
