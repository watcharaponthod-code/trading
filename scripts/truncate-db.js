const { neon } = require("@neondatabase/serverless");
const fs = require("fs");
const path = require("path");

// Manually parse .env.local to avoid dependency on 'dotenv'
function loadEnv() {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) {
    console.error("❌ .env.local not found at", envPath);
    process.exit(1);
  }
  
  const envContent = fs.readFileSync(envPath, "utf-8");
  const env = {};
  envContent.split("\n").forEach(line => {
    const [key, ...value] = line.split("=");
    if (key && value) {
      env[key.trim()] = value.join("=").trim().replace(/^['"]|['"]$/g, '');
    }
  });
  return env;
}

const env = loadEnv();
const dbUrl = env.DATABASE_URL;

if (!dbUrl) {
  console.error("❌ DATABASE_URL not found in .env.local");
  process.exit(1);
}

const sql = neon(dbUrl);

async function clearMockData() {
  console.log("🧹 Clearing all mock data from the database...");

  try {
    // These tables will be cleared
    await sql`TRUNCATE TABLE trade_signals RESTART IDENTITY CASCADE`;
    await sql`TRUNCATE TABLE trades RESTART IDENTITY CASCADE`;
    await sql`TRUNCATE TABLE portfolio_snapshots RESTART IDENTITY CASCADE`;

    console.log("✅ All mock signals, trades, and portfolio snapshots removed!");
    console.log("📊 Now your dashboard will show ONLY real-time Alpaca data.");
  } catch (err) {
    console.error("❌ Failed to clear mock data:", err);
  } finally {
    process.exit(0);
  }
}

clearMockData();
