import cron from "node-cron";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { createServer } from "http";

// HTTP server — Render nõuab porti, UptimeRobot pingib
const PORT = process.env.PORT || 10000;
createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("ig-scheduler ok");
}).listen(PORT, "0.0.0.0", () => console.log(`HTTP server listening on 0.0.0.0:${PORT}`));

const __dirname = dirname(fileURLToPath(import.meta.url));
const posts = JSON.parse(readFileSync(resolve(__dirname, "posts.json"), "utf-8"));

const IG_ID = process.env.IG_USER_ID;
const PAGE_TOKEN = process.env.META_PAGE_TOKEN;

if (!IG_ID || !PAGE_TOKEN) {
  console.error("Puuduvad env muutujad: IG_USER_ID, META_PAGE_TOKEN");
  process.exit(1);
}

async function graphPost(path, body) {
  const params = new URLSearchParams({ ...body, access_token: PAGE_TOKEN });
  const res = await fetch(`https://graph.facebook.com/v25.0${path}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: params,
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error?.message || res.status);
  return data;
}

async function checkAndPost() {
  const now = Math.floor(Date.now() / 1000);
  // Postita kui scheduled_ts on möödunud kuni 10 minutit tagasi
  const window = 10 * 60;

  for (const post of posts) {
    if (post.posted) continue;
    if (now >= post.ts && now <= post.ts + window) {
      console.log(`[${new Date().toISOString()}] Postitan: ${post.id}`);
      try {
        // 1. Loo meedia konteiner
        const container = await graphPost(`/${IG_ID}/media`, {
          image_url: post.image_url,
          caption: post.caption,
        });
        console.log(`  Konteiner: ${container.id}`);

        // 2. Oota 5 sekundit
        await new Promise((r) => setTimeout(r, 5000));

        // 3. Publitseeri
        const pub = await graphPost(`/${IG_ID}/media_publish`, {
          creation_id: container.id,
        });
        console.log(`  ✓ Postitatud! Media ID: ${pub.id}`);
        post.posted = true;
        post.media_id = pub.id;
      } catch (err) {
        console.error(`  ✗ Viga: ${err.message}`);
      }
    }
  }
}

// Jookseb iga 5 minuti tagant
cron.schedule("*/5 * * * *", () => {
  checkAndPost().catch(console.error);
});

console.log(`[${new Date().toISOString()}] IG Scheduler käivitatud. ${posts.length} postitust ootamas.`);
posts.forEach((p) => {
  const dt = new Date(p.ts * 1000).toISOString();
  console.log(`  ${p.id}: ${dt}`);
});

// Käivita kohe ka esimesel käivitamisel
checkAndPost().catch(console.error);
