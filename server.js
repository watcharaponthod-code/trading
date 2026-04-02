/**
 * Custom Next.js Server + Streaming Backend 
 * รันคำสั่ง: node server.js
 */

const { createServer } = require("http")
const { parse } = require("url")
const next = require("next")
const { spawn } = require("child_process")

const dev = process.env.NODE_ENV !== "production"
const app = next({ dev })
const handle = app.getRequestHandler()
const PORT = process.env.PORT || 3000

app.prepare().then(() => {
  // 1. เริ่มระบบ Next.js Web Dashboard
  createServer((req, res) => {
    const parsedUrl = parse(req.url, true)
    handle(req, res, parsedUrl)
  }).listen(PORT, (err) => {
    if (err) throw err
    console.log(`\n✅ [WEB] Next.js Dashboard รันอยู่บน http://localhost:${PORT}`)
    
    // 2. หลังจาก Backend ขึ้นแล้ว ให้สั่งรัน Streaming Worker ในเบื้องหลังทันที
    console.log(`\n🚀 [BACKEND] กำลังผนวกระบบ Streaming (Real-Time Trade) เข้ากับ Backend...`)
    
    const worker = spawn("node", ["scripts/streaming-worker.js"], {
       env: { ...process.env, WORKER_BASE_URL: `http://localhost:${PORT}` },
       stdio: "inherit" // ให้ log ของ worker โผล่มารวมกับ backend
    })

    worker.on("close", (code) => {
      console.log(`⚠️ [BACKEND] Streaming Worker หลุดการเชื่อมต่อ (code: ${code})`)
    })
  })
})
