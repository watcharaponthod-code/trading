const WebSocket = require("ws");
const fs = require("fs");
const path = require("path");

const envPath = path.join(__dirname, "..", ".env.local");
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, "utf-8").split("\n").forEach(line => {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
  });
}

const API_KEY = process.env.ALPACA_API_KEY;
const API_SECRET = process.env.ALPACA_API_SECRET;

console.log("กำลังเชื่อมต่อ Alpaca WebSocket (Crypto - Realtime Trades 24/7)...");

// เชื่อมต่อเข้าไปยังท่อ Crypto ของ Alpaca 
const ws = new WebSocket("wss://stream.data.alpaca.markets/v1beta3/crypto/us");

ws.on("open", () => {
  console.log("✅ WebSocket เชื่อมต่อสำเร็จ! กำลังยืนยันตัวตน...");
});

ws.on("message", (data) => {
  const msgs = JSON.parse(data.toString());
  
  for(let msg of msgs) {
      if (msg.T === "success" && msg.msg === "connected") {
        ws.send(JSON.stringify({
            action: "auth",
            key: API_KEY,
            secret: API_SECRET
        }));
      }
      else if (msg.T === "success" && msg.msg === "authenticated") {
        console.log("✅ ยืนยันตัวตนผ่าน! กำลังติดตาม BTC/USD...");
        ws.send(JSON.stringify({
            action: "subscribe",
            trades: ["BTC/USD"],
            quotes: ["BTC/USD"]
        }));
      }
      else if (msg.T === "subscription") {
          console.log(`📡 เริ่มรับข้อมูล Real-Time แล้ว! รอซักครู่...`);
          console.log(`====================================================`);
      }
      else if (msg.T === "t" || msg.T === "q") {
          const type = msg.T === "t" ? "⚡ Trade" : "🚥 Quote";
          const time = new Date(msg.t).toLocaleTimeString('th-TH');
          const p = msg.p || msg.bp; // price or bid price
          console.log(`[${time}] ${type} ${msg.S} 👉 ราคา: $${p.toFixed(2)}`);
      }
      else {
          // แจ้งเตือนข้อความอื่นๆ (เช่น Error)
          console.log("⚠️ Server Response:", msg);
      }
  }
});

ws.on("error", (err) => console.log("Error:", err));
ws.on("close", () => console.log("🔌 ปิดการเชื่อมต่อแล้ว"));
