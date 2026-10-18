require("dotenv").config();
const { spawn } = require("child_process");
const express = require("express");
const os = require("os");

const port = Number(process.env.DASHBOARD_PORT) || 3000;
const host = process.env.DASHBOARD_HOST || "0.0.0.0";
const myIp = (process.env.MY_IP || "127.0.0.1").trim();
const nodeName = process.env.NODE_NAME === "PC-Main" ? os.hostname() : (process.env.NODE_NAME || os.hostname());

const nodes = (process.env.CLUSTER_NODES || myIp).split(",").map(s => s.trim()).filter(Boolean);

let botProcess = null;
let proxyServer = null;
let currentLeader = null;
let isShuttingDown = false;

async function checkNodeHealth(ip) {
  try {
    const res = await fetch(`http://${ip}:${port}/api/health`, { signal: AbortSignal.timeout(2500) });
    if (!res.ok) return null;
    const data = await res.json();
    return data.ok ? data : null;
  } catch {
    return null;
  }
}

function startStandbyServer() {
  if (proxyServer) return;
  const app = express();
  app.get("/api/health", (req, res) => res.status(503).json({ ok: false, standby: true, node: nodeName, leader: currentLeader }));
  app.use((req, res) => {
    if (currentLeader && currentLeader !== myIp) {
      return res.redirect(`http://${currentLeader}:${port}${req.originalUrl}`);
    }
    res.status(503).send(`<html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta http-equiv="refresh" content="3"><title>وضع الانتظار</title></head><body style="background:#0f1015;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center;"><div><h2>⏳ الجهاز في وضع الانتظار...</h2><p>البوت شغال عند جهاز ثاني أو جاري استلام القيادة تلقائياً.</p></div></body></html>`);
  });
  proxyServer = app.listen(port, host, () => console.log(`📡 وضع الانتظار مفعل على البورت ${port}`)).on("error", () => {});
}

function stopStandbyServer() {
  return new Promise((resolve) => {
    if (!proxyServer) return resolve();
    proxyServer.close(() => { proxyServer = null; resolve(); });
  });
}

async function startBot() {
  if (botProcess) return;
  await stopStandbyServer();
  console.log(`🚀 [${nodeName}] استلام القيادة! جاري تشغيل البوت...`);
  botProcess = spawn("node", ["index.js"], { stdio: "inherit", env: { ...process.env, NODE_NAME: nodeName, MY_IP: myIp } });
  botProcess.on("exit", () => {
    botProcess = null;
    if (!isShuttingDown) startStandbyServer();
  });
}

function stopBot() {
  return new Promise((resolve) => {
    if (!botProcess) return resolve();
    botProcess.once("exit", () => { botProcess = null; resolve(); });
    botProcess.kill("SIGTERM");
    setTimeout(() => { if (botProcess) botProcess.kill("SIGKILL"); resolve(); }, 4000);
  });
}

async function monitorLoop() {
  if (isShuttingDown) return;
  let myIndex = nodes.indexOf(myIp);
  if (myIndex === -1) myIndex = 0;

  let foundLeader = null;
  for (let i = 0; i < myIndex; i++) {
    const ip = nodes[i];
    if (ip === myIp) continue;
    const health = await checkNodeHealth(ip);
    if (health) { foundLeader = ip; break; }
  }

  if (foundLeader) {
    currentLeader = foundLeader;
    if (botProcess) { await stopBot(); startStandbyServer(); }
    else if (!proxyServer) startStandbyServer();
  } else {
    currentLeader = myIp;
    if (!botProcess) await startBot();
  }
  setTimeout(monitorLoop, 6000);
}

process.on("SIGINT", async () => { isShuttingDown = true; await stopBot(); await stopStandbyServer(); process.exit(0); });
console.log(`🤖 نظام الإدارة الذكي شغال | الجهاز: ${nodeName}`);
monitorLoop();
