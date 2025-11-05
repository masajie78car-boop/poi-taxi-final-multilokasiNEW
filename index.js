// index.js (ES module) - untuk Vercel serverless function
import express from "express";
import fetch from "node-fetch";
import { initializeApp } from "firebase/app";
import { getDatabase, ref, get, set } from "firebase/database";

const app = express();
app.use(express.json()); // parse JSON body

// ===== Environment variables (set di Vercel) =====
// VERIFY_TOKEN : token verifikasi webhook (terdaftar di Facebook App)
// ACCESS_TOKEN  : token access WhatsApp API (EAA...)
// PHONE_NUMBER_ID : id phone number dari Meta (angka/string)
// FIREBASE_API_KEY : (boleh kosong jika tidak dipakai by client SDK) - tetap set
// DATABASE_URL  : https://xxx-default-rtdb.asia-southeast1.firebasedatabase.app
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const DATABASE_URL = process.env.DATABASE_URL;

// ===== init Firebase (Realtime DB read/write) =====
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY || "",
  databaseURL: DATABASE_URL || ""
};
const firebaseApp = initializeApp(firebaseConfig);
const db = getDatabase(firebaseApp);

// ===== GET webhook verification (Facebook) =====
app.get("/api/webhook", (req, res) => {
  try {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode && token && mode === "subscribe" && token === VERIFY_TOKEN) {
      console.log("✅ Webhook verified");
      return res.status(200).send(challenge);
    } else {
      console.warn("❌ Webhook verification failed:", { mode, tokenProvided: !!token });
      return res.sendStatus(403);
    }
  } catch (err) {
    console.error("GET /api/webhook error:", err);
    return res.sendStatus(500);
  }
});

// ===== POST webhook (messages) =====
app.post("/api/webhook", (req, res) => {
  // respond cepat so Vercel doesn't time out Facebook verification
  res.status(200).send("EVENT_RECEIVED");

  (async () => {
    try {
      const body = req.body;
      // Facebook-graph body structure may vary; try to find incoming message
      const change = body.entry?.[0]?.changes?.[0]?.value;
      const message = change?.messages?.[0] || body?.entry?.[0]?.messaging?.[0]?.message;
      if (!message) {
        console.log("Received webhook but no message object found.");
        return;
      }

      const from = message.from || message?.sender?.id; // phone number id or sender id
      const text = (message.text?.body || message?.body || "").trim();
      console.log("Pesan diterima:", text, "dari:", from);

      if (!text || !from) return;

      const lower = text.toLowerCase();

      if (lower.startsWith("#daftarantrian")) {
        await handleDaftar(from, text, "mall_nusantara", 3);
      } else if (lower.startsWith("#daftarlist")) {
        await handleDaftar(from, text, "stasiun_jatinegara", 6);
      } else if (lower.startsWith("#updateantrian")) {
        await handleUpdate(from, "mall_nusantara");
      } else if (lower.startsWith("#updatelist")) {
        await handleUpdate(from, "stasiun_jatinegara");
      } else {
        // optional: ignore or reply unknown
        // await sendMessage(from, "❓ Perintah tidak dikenal. Gunakan #daftarantrian atau #updateantrian.");
      }
    } catch (err) {
      console.error("Error processing webhook POST:", err);
    }
  })();
});

// ===== helper: pendaftaran =====
async function handleDaftar(from, rawText, lokasi, maxAktif) {
  try {
    const parts = rawText.trim().split(/\s+/);
    const noPolisi = (parts[1] || "").toUpperCase();
    const noLambung = (parts[2] || "").toUpperCase();

    if (!noPolisi || !noLambung) {
      return sendMessage(from, "❌ Format salah. Gunakan:\n#daftarantrian B1234XYZ KM1234");
    }

    const snap = await get(ref(db, `pangkalan/${lokasi}/antrian`));
    const data = snap.val() || {};
    const arr = Object.values(data || {});
    const aktif = arr.filter(d => d.status === "aktif");

    const status = (aktif.length >= maxAktif) ? "buffer" : "aktif";

    await set(ref(db, `pangkalan/${lokasi}/antrian/${noPolisi}`), {
      noPolisi,
      noLambung,
      status,
      createdAt: new Date().toISOString(),
    });

    await sendMessage(from, `✅ Terdaftar di *${lokasi.replace("_"," ")}*\nStatus: *${status.toUpperCase()}*`);

    if (status === "buffer") {
      await sendMessage(from, "🕒 Anda masuk daftar *buffer*. Kirim ShareLive agar admin tahu posisi Anda.");
    }
  } catch (err) {
    console.error("handleDaftar error:", err);
    await sendMessage(from, "❌ Terjadi kesalahan saat mendaftar. Coba lagi.");
  }
}

// ===== helper: update =====
async function handleUpdate(from, lokasi) {
  try {
    const snap = await get(ref(db, `pangkalan/${lokasi}/antrian`));
    const data = snap.val() || {};
    if (!Object.keys(data).length) {
      return sendMessage(from, "📋 Belum ada antrian aktif di sini.");
    }
    const list = Object.values(data)
      .map((d, i) => `${i+1}. ${d.noPolisi} | ${d.noLambung} (${d.status})`)
      .join("\n");
    await sendMessage(from, `📋 *Antrian ${lokasi.replace("_"," ")}:*\n${list}`);
  } catch (err) {
    console.error("handleUpdate error:", err);
    await sendMessage(from, "❌ Gagal mengambil daftar antrian.");
  }
}

// ===== helper: send WhatsApp message (Meta Graph API) =====
async function sendMessage(to, text) {
  try {
    if (!ACCESS_TOKEN || !PHONE_NUMBER_ID) {
      console.error("ACCESS_TOKEN or PHONE_NUMBER_ID not set.");
      return;
    }
    const url = `https://graph.facebook.com/v17.0/${PHONE_NUMBER_ID}/messages`;
    const payload = {
      messaging_product: "whatsapp",
      to: to,
      text: { body: text }
    };
    const r = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload),
      timeout: 15000
    });
    const j = await r.json().catch(()=>null);
    if (!r.ok) {
      console.error("sendMessage failed", r.status, j);
    } else {
      console.log("Pesan terkirim ke", to, "resp:", j?.messages?.[0]?.id || "ok");
    }
  } catch (err) {
    console.error("sendMessage error:", err);
  }
}

// Export default app for Vercel (do NOT call app.listen())
export default app;
xt, lokasi, maxAktif) {
  const parts = text.split(" ");
  const noPolisi = parts[1]?.toUpperCase();
  const noLambung = parts[2]?.toUpperCase();

  if (!noPolisi || !noLambung) {
    return sendMessage(from, "❌ Format salah.\nGunakan:\n#daftarantrian B1234XYZ KM1234");
  }

  const snap = await get(ref(db, `pangkalan/${lokasi}/antrian`));
  const data = snap.val() || {};
  const aktif = Object.values(data).filter((d) => d.status === "aktif");

  const status = aktif.length >= maxAktif ? "buffer" : "aktif";
  await set(ref(db, `pangkalan/${lokasi}/antrian/${noPolisi}`), {
    noPolisi,
    noLambung,
    status,
    createdAt: new Date().toISOString(),
  });

  await sendMessage(
    from,
    `✅ Terdaftar di *${lokasi.replace("_", " ")}*\nStatus: *${status.toUpperCase()}*`
  );

  if (status === "buffer") {
    await sendMessage(
      from,
      "🕒 Anda masuk daftar *buffer*. Kirim ShareLive agar admin tahu posisi Anda."
    );
  }
}

// ==== Fungsi update daftar ====
async function handleUpdate(from, lokasi) {
  const snap = await get(ref(db, `pangkalan/${lokasi}/antrian`));
  const data = snap.val() || {};
  if (Object.keys(data).length === 0) {
    return sendMessage(from, "📋 Belum ada antrian aktif di sini.");
  }

  const list = Object.values(data)
    .map((d, i) => `${i + 1}. ${d.noPolisi} | ${d.noLambung} (${d.status})`)
    .join("\n");

  await sendMessage(from, `📋 *Antrian ${lokasi.replace("_", " ")}:*\n${list}`);
}

// ==== Fungsi kirim pesan WhatsApp ====
async function sendMessage(to, text) {
  const token = process.env.ACCESS_TOKEN;
  const url = "https://graph.facebook.com/v17.0/917786831407342/messages";
  await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      text: { body: text },
    }),
  });
}

// ✅ Ekspor app untuk Vercel
export default app;
