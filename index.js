import express from "express";
import bodyParser from "body-parser";
import fetch from "node-fetch";
import { initializeApp } from "firebase/app";
import { getDatabase, ref, set, get, update, onValue } from "firebase/database";

const app = express();
app.use(bodyParser.json());

// === Firebase Config ===
const firebaseConfig = {
  apiKey: "AIzaSyArjIuAyCRw85LStoiJzgIdLyhs8HXPFhs",
  authDomain: "poi-taxi.firebaseapp.com",
  databaseURL: "https://poi-taxi-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "poi-taxi",
  storageBucket: "poitaxi.firebasestorage.app",
  messagingSenderId: "774582687333",
  appId: "1:774582687333:web:ee95e1e3e705beaee4d88c"
};
const firebaseApp = initializeApp(firebaseConfig);
const db = getDatabase(firebaseApp);

// === ENV (isi di vercel dashboard) ===
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "poi-taxi-vercel";
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const ADMIN_GROUP = process.env.ADMIN_GROUP; // grup / admin WA tujuan notifikasi

// === Fungsi kirim pesan WA ===
async function sendMessage(to, message) {
  try {
    await fetch(`https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        text: { body: message },
      }),
    });
  } catch (err) {
    console.error("Gagal kirim pesan:", err);
  }
}

// === Verifikasi Webhook ===
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode && token === VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else res.sendStatus(403);
});

// === Terima Pesan dari Meta ===
app.post("/webhook", async (req, res) => {
  try {
    const entry = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!entry) return res.sendStatus(200);

    const from = entry.from;
    const text = entry.text?.body?.trim().toLowerCase() || "";

    if (text.startsWith("#daftarantrian")) {
      await handleDaftar(from, text, "mall_nusantara", 3);
    } else if (text.startsWith("#daftarlist")) {
      await handleDaftar(from, text, "stasiun_jatinegara", 6);
    } else if (text.startsWith("#updateantrian")) {
      await handleUpdate(from, "mall_nusantara");
    } else if (text.startsWith("#updatelist")) {
      await handleUpdate(from, "stasiun_jatinegara");
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("Error webhook:", err);
    res.sendStatus(500);
  }
});

// === Fungsi Daftar Antrian ===
async function handleDaftar(from, text, lokasi, maxAktif) {
  const parts = text.split(" ");
  const noPolisi = parts[1]?.toUpperCase();
  const noLambung = parts[2]?.toUpperCase();

  if (!noPolisi || !noLambung) {
    return sendMessage(from, `⚠️ Format salah.\nGunakan:\n\n#daftarantrian B1234XYZ KM1001`);
  }

  const refPath = ref(db, `pangkalan/${lokasi}/antrian`);
  const snap = await get(refPath);
  const data = snap.val() || {};
  const arr = Object.values(data);
  const aktif = arr.filter(d => d.status === "aktif");
  const buffer = arr.filter(d => d.status === "buffer");

  const status = aktif.length < maxAktif ? "aktif" : "buffer";
  const waktu = new Date().toISOString();

  await set(ref(db, `pangkalan/${lokasi}/antrian/${noPolisi}`), {
    noPolisi, noLambung, status, createdAt: waktu
  });

  if (status === "aktif") {
    await sendMessage(from, `✅ Anda masuk *ANTRIAN AKTIF* di ${formatLokasi(lokasi)}\n🚖 No Polisi: ${noPolisi}\n🔢 No Lambung: ${noLambung}\nSilakan standby di Lobby.`);
  } else {
    await sendMessage(from, `🕒 Anda masuk *BUFFER MENUNGGU* di ${formatLokasi(lokasi)}\n🚖 No Polisi: ${noPolisi}\n🔢 No Lambung: ${noLambung}\nSilakan kirim *ShareLive Location* sekarang.`);
  }
}

// === Fungsi Update Antrian ===
async function handleUpdate(from, lokasi) {
  const refPath = ref(db, `pangkalan/${lokasi}/antrian`);
  const snap = await get(refPath);
  const data = snap.val() || {};
  const arr = Object.values(data).sort((a,b)=>new Date(a.createdAt)-new Date(b.createdAt));
  const aktif = arr.filter(d => d.status === "aktif");
  const buffer = arr.filter(d => d.status === "buffer");

  let pesan = `📋 *Daftar Antrian ${formatLokasi(lokasi)}*\n\n`;
  pesan += `🚕 *Aktif (${aktif.length})*\n`;
  if (aktif.length) aktif.forEach((d,i)=>pesan += `${i+1}. ${d.noPolisi} | ${d.noLambung}\n`);
  else pesan += `- Belum ada antrian aktif\n`;

  pesan += `\n🕒 *Buffer (${buffer.length})*\n`;
  if (buffer.length) buffer.forEach((d,i)=>pesan += `${i+1}. ${d.noPolisi} | ${d.noLambung}\n`);
  else pesan += `- Tidak ada buffer\n`;

  await sendMessage(from, pesan);
}

// === Realtime Listener: Buffer Naik Jadi Aktif ===
onValue(ref(db, "pangkalan"), async (snap) => {
  const all = snap.val();
  if (!all) return;

  for (const lokasi in all) {
    const list = all[lokasi].antrian || {};
    for (const id in list) {
      const d = list[id];
      if (d.status === "naik") { // trigger manual dari panel
        // ubah jadi aktif
        await update(ref(db, `pangkalan/${lokasi}/antrian/${id}`), { status: "aktif" });
        const pesan = `🚕 ${d.noPolisi} | ${d.noLambung}\nSilakan menuju Lobby ${formatLokasi(lokasi)}.\nGiliran Anda berikutnya.`;
        if (ADMIN_GROUP) await sendMessage(ADMIN_GROUP, pesan);
        await sendMessage(id, pesan);
      }
    }
  }
});

// === Helper Lokasi ===
function formatLokasi(id) {
  if (id === "mall_nusantara") return "Mall Nusantara";
  if (id === "stasiun_jatinegara") return "Stasiun Jatinegara";
  return id;
}

app.listen(3000, () => console.log("✅ Bot Poi Taxi Multi-Lokasi aktif di port 3000"));
export default app;
