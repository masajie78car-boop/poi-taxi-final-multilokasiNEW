import express from "express";
import bodyParser from "body-parser";
import fetch from "node-fetch";
import { initializeApp } from "firebase/app";
import { getDatabase, ref, set, get, update, remove } from "firebase/database";

const app = express();
app.use(bodyParser.json());

// Firebase init
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  databaseURL: process.env.DATABASE_URL,
};
const firebaseApp = initializeApp(firebaseConfig);
const db = getDatabase(firebaseApp);

// Verifikasi webhook META
app.get("/webhook", (req, res) => {
  const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("Webhook verified");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// Terima pesan dari WA
app.post("/webhook", async (req, res) => {
  try {
    const body = req.body;
    if (!body.entry) return res.sendStatus(200);

    const msg = body.entry[0].changes[0].value.messages?.[0];
    if (!msg) return res.sendStatus(200);

    const from = msg.from;
    const text = msg.text?.body?.trim().toLowerCase();

    console.log("Pesan diterima:", text);

    if (text.startsWith("#daftarantrian")) {
      await handleDaftarAntrian(from, text);
    } else if (text.startsWith("#daftarlist")) {
      await handleDaftarList(from, text);
    } else if (text.startsWith("#updateantrian")) {
      await kirimUpdate(from, "mall_nusantara");
    } else if (text.startsWith("#updatelist")) {
      await kirimUpdate(from, "stasiun_jatinegara");
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("Error webhook:", err);
    res.sendStatus(500);
  }
});

// === Handler untuk perintah ===
async function handleDaftarAntrian(from, text) {
  const [_, noPolisi, noLambung] = text.split(" ");
  const refMall = ref(db, "pangkalan/mall_nusantara/antrian/" + noPolisi);
  const snapshot = await get(ref(db, "pangkalan/mall_nusantara/antrian"));
  const data = snapshot.val() || {};
  const aktif = Object.values(data).filter(d => d.status === "aktif");
  const status = aktif.length >= 3 ? "buffer" : "aktif";
  await set(refMall, { noPolisi, noLambung, status, createdAt: new Date().toISOString() });
  await sendMessage(from, `✅ Terdaftar: Mall Nusantara\nStatus: *${status.toUpperCase()}*`);
}

async function handleDaftarList(from, text) {
  const [_, noPolisi, noLambung] = text.split(" ");
  const refStasiun = ref(db, "pangkalan/stasiun_jatinegara/antrian/" + noPolisi);
  const snapshot = await get(ref(db, "pangkalan/stasiun_jatinegara/antrian"));
  const data = snapshot.val() || {};
  const aktif = Object.values(data).filter(d => d.status === "aktif");
  const status = aktif.length >= 6 ? "buffer" : "aktif";
  await set(refStasiun, { noPolisi, noLambung, status, createdAt: new Date().toISOString() });
  await sendMessage(from, `✅ Terdaftar: Stasiun Jatinegara\nStatus: *${status.toUpperCase()}*`);
}

async function kirimUpdate(from, lokasi) {
  const snap = await get(ref(db, `pangkalan/${lokasi}/antrian`));
  const data = snap.val() || {};
  if (Object.keys(data).length === 0) {
    await sendMessage(from, "📋 Tidak ada antrian saat ini.");
    return;
  }
  const list = Object.values(data)
    .map((d, i) => `${i + 1}. ${d.noPolisi} | ${d.noLambung} (${d.status})`)
    .join("\n");
  await sendMessage(from, `📋 Daftar ${lokasi.replace("_", " ")}:\n${list}`);
}

// === Fungsi kirim pesan ke WA ===
async function sendMessage(to, message) {
  const token = process.env.ACCESS_TOKEN;
  await fetch(`https://graph.facebook.com/v17.0/252091901004238/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      text: { body: message },
    }),
  });
}

app.listen(3000, () => console.log("✅ Webhook aktif di port 3000"));

