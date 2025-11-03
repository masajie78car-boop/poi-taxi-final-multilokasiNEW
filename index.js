import express from "express";
import bodyParser from "body-parser";
import fetch from "node-fetch";
import { initializeApp } from "firebase/app";
import { getDatabase, ref, set, get } from "firebase/database";

const app = express();
app.use(bodyParser.json());

// ==== Firebase Init ====
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  databaseURL: process.env.DATABASE_URL,
};
const firebaseApp = initializeApp(firebaseConfig);
const db = getDatabase(firebaseApp);

// ==== Webhook Verification ====
app.get("/webhook", (req, res) => {
  const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  console.log("🔍 VERIFY REQUEST:", req.query);

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ WEBHOOK VERIFIED!");
    res.status(200).send(challenge);
  } else {
    console.log("❌ WEBHOOK VERIFICATION FAILED");
    res.sendStatus(403);
  }
});

// ==== Handle Incoming Messages ====
app.post("/webhook", async (req, res) => {
  try {
    const change = req.body.entry?.[0]?.changes?.[0]?.value;
    const message = change?.messages?.[0];
    if (!message) return res.sendStatus(200);

    const from = message.from;
    const text = message.text?.body?.trim() || "";
    console.log("📩 Pesan masuk:", text);

    if (text.startsWith("#daftarantrian")) {
      await handleDaftar(from, text, "mall_nusantara", 3);
    } else if (text.startsWith("#daftarlist")) {
      await handleDaftar(from, text, "stasiun_jatinegara", 6);
    } else if (text.startsWith("#updateantrian")) {
      await handleUpdate(from, "mall_nusantara");
    } else if (text.startsWith("#updatelist")) {
      await handleUpdate(from, "stasiun_jatinegara");
    } else {
      await sendMessage(
        from,
        "❓ Perintah tidak dikenali.\nGunakan salah satu:\n#daftarantrian / #daftarlist / #updateantrian / #updatelist"
      );
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("❌ Webhook error:", err);
    res.sendStatus(500);
  }
});

// ==== Fungsi Daftar ====
async function handleDaftar(from, text, lokasi, maxAktif) {
  const parts = text.split(" ");
  const noPolisi = parts[1]?.toUpperCase();
  const noLambung = parts[2]?.toUpperCase();

  if (!noPolisi || !noLambung) {
    return sendMessage(
      from,
      "❌ Format salah!\nGunakan: #daftarantrian B1234XYZ KM1234"
    );
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

// ==== Fungsi Update ====
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

// ==== Kirim Pesan WhatsApp ====
async function sendMessage(to, text) {
  const token = process.env.ACCESS_TOKEN;
  const url = "https://graph.facebook.com/v17.0/252091901004238/messages";

  console.log("📤 Mengirim pesan ke", to);

  const res = await fetch(url, {
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

  const data = await res.json();
  console.log("📬 Response:", data);
}

export default app;
