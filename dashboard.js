const express = require("express");
const crypto = require("crypto");
const path = require("path");
const os = require("os");

module.exports = function startDashboard(client, distube) {
  const password = process.env.DASHBOARD_PASSWORD || "Aa123456";
  const port = Number(process.env.DASHBOARD_PORT) || 3000;
  const host = process.env.DASHBOARD_HOST || "0.0.0.0";
  const nodeName = process.env.NODE_NAME || os.hostname();

  const sessions = new Set();
  const hash = (s) => crypto.createHash("sha256").update(String(s)).digest();
  const sameText = (a, b) => crypto.timingSafeEqual(hash(a), hash(b));
  const getSid = (req) => (req.headers.cookie || "").split(";").map(s => s.trim()).find(s => s.startsWith("sid="))?.slice(4);

  const app = express();
  app.use(express.json());
  app.use("/api", (req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });

  app.get("/api/health", (req, res) => res.json({ ok: client.isReady(), node: nodeName, ping: client.ws.ping }));
  app.get("/", (req, res) => res.sendFile(path.join(__dirname, "dashboard.html")));

  app.post("/api/login", (req, res) => {
    if (!sameText(req.body?.password ?? "", password)) return res.status(401).json({ error: "كلمة السر غلط" });
    const sid = crypto.randomBytes(24).toString("hex");
    sessions.add(sid);
    res.setHeader("Set-Cookie", `sid=${sid}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`);
    res.json({ ok: true });
  });

  app.use("/api", (req, res, next) => {
    if (!sessions.has(getSid(req))) return res.status(401).json({ error: "سجل دخول" });
    next();
  });

  const songInfo = (s) => ({ name: s.name, url: s.url, duration: s.duration || 0, formattedDuration: s.formattedDuration || "0:00", thumbnail: s.thumbnail ?? null });

  app.get("/api/guilds", (req, res) => {
    res.json({
      node: nodeName,
      botName: client.user?.username ?? "iron monkey",
      botAvatar: client.user?.displayAvatarURL({ size: 128 }) ?? null,
      ping: client.ws.ping,
      guilds: client.guilds.cache.map(g => ({ id: g.id, name: g.name })),
    });
  });

  app.get("/api/guild/:id", (req, res) => {
    const guild = client.guilds.cache.get(req.params.id);
    if (!guild) return res.status(404).json({ error: "سيرفر غير موجود" });
    const channels = guild.channels.cache.filter(c => c.isVoiceBased()).map(c => ({ id: c.id, name: c.name, membersCount: c.members?.size || 0 }));
    const q = distube.getQueue(guild.id);
    res.json({
      node: nodeName,
      ping: client.ws.ping,
      channels,
      queue: q ? { songs: q.songs.map(songInfo), paused: q.paused, volume: q.volume, repeatMode: q.repeatMode, currentTime: q.currentTime, channel: q.voiceChannel?.name ?? null, channelId: q.voiceChannel?.id ?? null } : null,
    });
  });

  app.post("/api/guild/:id/play", async (req, res) => {
    try {
      const guild = client.guilds.cache.get(req.params.id);
      const q = distube.getQueue(req.params.id);
      const channel = guild?.channels.cache.get(req.body?.channelId || q?.voiceChannel?.id);
      const query = String(req.body?.query ?? "").trim();
      if (!channel || !channel.isVoiceBased()) throw new Error("اختر روم صوتي");
      if (!query) throw new Error("اكتب اسم أغنية أو رابط");
      await distube.play(channel, query);
      res.json({ ok: true });
    } catch (e) { res.status(400).json({ error: String(e.message).slice(0, 200) }); }
  });

  app.post("/api/guild/:id/action", async (req, res) => {
    try {
      const q = distube.getQueue(req.params.id);
      if (!q) throw new Error("ما فيه شي يشتغل");
      const { action, value } = req.body ?? {};
      switch (action) {
        case "pause": if (!q.paused) q.pause(); break;
        case "resume": if (q.paused) q.resume(); break;
        case "toggle": if (q.paused) q.resume(); else q.pause(); break;
        case "skip": if (q.songs.length > 1) await q.skip(); else await q.stop(); break;
        case "stop": await q.stop(); break;
        case "volume": q.setVolume(Math.min(100, Math.max(1, Number(value) || 50))); break;
        case "loop": q.setRepeatMode([0, 1, 2].includes(Number(value)) ? Number(value) : 0); break;
        case "shuffle": await q.shuffle(); break;
        case "seek": await q.seek(Math.max(0, Number(value) || 0)); break;
        case "remove": { const i = Number(value); if (i > 0 && i < q.songs.length) q.songs.splice(i, 1); break; }
        case "jump": { const idx = Number(value); if (idx > 0 && idx < q.songs.length) { const [t] = q.songs.splice(idx, 1); q.songs.splice(1, 0, t); await q.skip(); } break; }
        case "clear": if (q.songs.length > 1) q.songs.splice(1); break;
      }
      res.json({ ok: true });
    } catch (e) { res.status(400).json({ error: String(e.message).slice(0, 200) }); }
  });

  app.listen(port, host, () => console.log(`🌐 الداشبورد شغال: http://localhost:${port}`));
};
