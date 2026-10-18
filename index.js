require("dotenv").config();
const fs = require("fs");
const os = require("os");
const { Client, GatewayIntentBits, EmbedBuilder, SlashCommandBuilder, ActivityType } = require("discord.js");
const { DisTube } = require("distube");
const { SoundCloudPlugin } = require("@distube/soundcloud");
const { DirectLinkPlugin } = require("@distube/direct-link");
const { YtDlpPlugin } = require("@distube/yt-dlp");

const nodeName = process.env.NODE_NAME || os.hostname();
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });

const distube = new DisTube(client, {
  plugins: [new SoundCloudPlugin(), new DirectLinkPlugin(), new YtDlpPlugin({ update: true })],
  emitNewSongOnly: true,
  ffmpeg: { path: require("ffmpeg-static") },
});

const commands = [
  new SlashCommandBuilder().setName("play").setDescription("شغّل أغنية (اسم أو رابط)").addStringOption(o => o.setName("song").setDescription("اسم الأغنية أو الرابط").setRequired(true)),
  new SlashCommandBuilder().setName("skip").setDescription("تخطي الأغنية الحالية"),
  new SlashCommandBuilder().setName("pause").setDescription("إيقاف مؤقت"),
  new SlashCommandBuilder().setName("resume").setDescription("كمّل التشغيل"),
  new SlashCommandBuilder().setName("shuffle").setDescription("خلط القائمة"),
  new SlashCommandBuilder().setName("stop").setDescription("إيقاف التشغيل والخروج"),
  new SlashCommandBuilder().setName("queue").setDescription("عرض قائمة التشغيل"),
  new SlashCommandBuilder().setName("nowplaying").setDescription("الأغنية الحالية"),
  new SlashCommandBuilder().setName("volume").setDescription("تغيير الصوت").addIntegerOption(o => o.setName("level").setDescription("من 1 إلى 100").setMinValue(1).setMaxValue(100).setRequired(true)),
  new SlashCommandBuilder().setName("loop").setDescription("تكرار").addStringOption(o => o.setName("mode").setDescription("نوع التكرار").setRequired(true).addChoices({ name: "إيقاف", value: "off" }, { name: "الأغنية", value: "song" }, { name: "القائمة", value: "queue" })),
].map(c => c.toJSON());

client.once("ready", async () => {
  console.log(`✅ شغال باسم ${client.user.tag} | المستضيف: ${nodeName}`);
  client.user.setActivity(`🎵 لوحة التحكم | ${nodeName}`, { type: ActivityType.Listening });
  try {
    const name = process.env.BOT_NAME;
    if (name && client.user.username !== name) await client.user.setUsername(name);
    const avatarPath = process.env.BOT_AVATAR;
    if (avatarPath && fs.existsSync(avatarPath) && process.env.UPDATE_AVATAR === "true") await client.user.setAvatar(avatarPath);
  } catch (e) {}
  await client.application.commands.set(commands).catch(() => {});
  require("./dashboard")(client, distube);
});

client.on("interactionCreate", async (i) => {
  if (!i.isChatInputCommand() || !i.guild) return;
  const voiceChannel = i.member.voice.channel;
  const queue = distube.getQueue(i.guildId);
  try {
    switch (i.commandName) {
      case "play":
        if (!voiceChannel) return i.reply({ content: "ادخل روم صوتي أول 🎧", ephemeral: true });
        await i.deferReply();
        await distube.play(voiceChannel, i.options.getString("song"), { member: i.member, textChannel: i.channel });
        return i.deleteReply().catch(() => {});
      case "skip":
        if (!queue) return i.reply({ content: "ما فيه شي يشتغل", ephemeral: true });
        if (queue.songs.length > 1) await queue.skip(); else await queue.stop();
        return i.reply("⏭️ تم التخطي");
      case "pause":
        if (!queue) return i.reply({ content: "ما فيه شي يشتغل", ephemeral: true });
        queue.pause(); return i.reply("⏸️ تم الإيقاف المؤقت");
      case "resume":
        if (!queue) return i.reply({ content: "ما فيه شي يشتغل", ephemeral: true });
        queue.resume(); return i.reply("▶️ كملت التشغيل");
      case "shuffle":
        if (!queue) return i.reply({ content: "ما فيه شي يشتغل", ephemeral: true });
        await queue.shuffle(); return i.reply("🔀 تم خلط القائمة");
      case "stop":
        if (!queue) return i.reply({ content: "ما فيه شي يشتغل", ephemeral: true });
        await queue.stop(); return i.reply("⏹️ تم الإيقاف");
      case "queue":
        if (!queue) return i.reply({ content: "القائمة فاضية", ephemeral: true });
        const list = queue.songs.slice(0, 10).map((s, n) => `${n === 0 ? "▶️" : n + "."} **${s.name}** (${s.formattedDuration})`).join("\n");
        return i.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle("🎶 قائمة التشغيل").setDescription(list)] });
      case "nowplaying":
        if (!queue) return i.reply({ content: "ما فيه شي يشتغل", ephemeral: true });
        const s = queue.songs[0];
        return i.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle("🎵 يشتغل الحين").setDescription(`[${s.name}](${s.url})\nالمدة: ${s.formattedDuration}`).setThumbnail(s.thumbnail ?? null)] });
      case "volume":
        if (!queue) return i.reply({ content: "ما فيه شي يشتغل", ephemeral: true });
        queue.setVolume(i.options.getInteger("level"));
        return i.reply(`🔊 الصوت: ${i.options.getInteger("level")}%`);
      case "loop":
        if (!queue) return i.reply({ content: "ما فيه شي يشتغل", ephemeral: true });
        queue.setRepeatMode({ off: 0, song: 1, queue: 2 }[i.options.getString("mode")]);
        return i.reply("🔁 تم تغيير التكرار");
    }
  } catch (e) {
    const msg = `صار خطأ: ${e.message?.slice(0, 150) ?? "غير معروف"}`;
    if (i.deferred || i.replied) i.editReply(msg).catch(() => {});
    else i.reply({ content: msg, ephemeral: true }).catch(() => {});
  }
});

distube
  .on("playSong", (q, s) => q.textChannel?.send(`🎵 يشتغل الحين: **${s.name}** (${s.formattedDuration})`).catch(() => {}))
  .on("addSong", (q, s) => { if (q.songs.length > 1) q.textChannel?.send(`➕ انضافت للقائمة: **${s.name}**`).catch(() => {}); })
  .on("error", (err, q) => q?.textChannel?.send(`⚠️ خطأ: ${err.message?.slice(0, 150)}`).catch(() => {}));

process.on("unhandledRejection", () => {});
process.on("uncaughtException", () => {});
async function shutdown() { try { distube.voices.collection.forEach(v => v.leave()); await client.destroy(); } catch {} process.exit(0); }
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

client.login(process.env.DISCORD_TOKEN);
