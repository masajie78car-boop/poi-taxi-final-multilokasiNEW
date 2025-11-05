import fetch from "node-fetch";

export default async function handler(req, res) {
  if (req.method === "GET") {
    // ✅ Verifikasi Webhook dari Meta
    const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode && token && mode === "subscribe" && token === VERIFY_TOKEN) {
      console.log("WEBHOOK_VERIFIED");
      res.status(200).send(challenge);
    } else {
      res.status(403).send("Forbidden");
    }
  } else if (req.method === "POST") {
    try {
      const body = req.body;

      if (body.object === "whatsapp_business_account") {
        for (const entry of body.entry) {
          const changes = entry.changes || [];
          for (const change of changes) {
            const messages = change.value?.messages || [];
            for (const message of messages) {
              const from = message.from;
              const text = message.text?.body || "";
              console.log("Pesan masuk:", text);

              let balasan = "";

              if (text.startsWith("#daftarantrian")) {
                balasan = "✅ Pendaftaran antrian berhasil.";
              } else if (text.startsWith("#updateantrian")) {
                balasan = "ℹ️ Status antrian sedang diperbarui.";
              } else {
                balasan = "Perintah tidak dikenal.";
              }

              await fetch(
                `https://graph.facebook.com/v19.0/${process.env.PHONE_ID}/messages`,
                {
                  method: "POST",
                  headers: {
                    Authorization: `Bearer ${process.env.ACCESS_TOKEN}`,
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({
                    messaging_product: "whatsapp",
                    to: from,
                    text: { body: balasan },
                  }),
                }
              );
            }
          }
        }
      }

      res.status(200).send("EVENT_RECEIVED");
    } catch (err) {
      console.error("❌ Error di webhook:", err);
      res.status(500).send("Server error");
    }
  } else {
    res.status(405).send("Method not allowed");
  }
}
