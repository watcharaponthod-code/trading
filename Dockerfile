# ใช้ Node.js 18 เป็นพื้นฐาน
FROM node:18-slim

# ติดตั้ง dependencies ที่จำเป็นสำหรับดีเทลบางอย่างของ Node
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

# ตั้งโฟลเดอร์ทำงาน
WORKDIR /app

# คัดลอกไฟล์ package เพื่อติดตั้ง lib
COPY package*.json ./

# ติดตั้ง lib ทั้งหมด และ pm2 เพื่อคุมบอท
RUN npm install
RUN npm install -g pm2

# คัดลอกโค้ดทั้งหมดเข้าเครื่อง
COPY . .

# สร้างไฟล์ Next.js สำหรับ Production
RUN npm run build

# เปิด Port 3000 สำหรับหน้า Dashboard
EXPOSE 3000

# สั่งรันด้วย PM2 เพื่อให้เปิดทั้งเว็บและบอทเทรด Real-time
# เราจะใช้ pm2-runtime เพื่อให้ Docker ไม่ปิดตัวลง
CMD ["pm2-runtime", "ecosystem.config.js"]
