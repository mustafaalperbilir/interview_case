import { Queue } from "bullmq";
import * as dotenv from "dotenv";

dotenv.config();

// Redis bağlantı ayarları (Docker'da 6379 portunda çalışıyor)
export const redisConnection = {
    host: process.env.REDIS_HOST || "localhost",
    port: parseInt(process.env.REDIS_PORT || "6379"),
    password: process.env.REDIS_PASSWORD, // .env'den şifreyi al
    tls: process.env.REDIS_PASSWORD ? {} : undefined // Şifre varsa (Bulut) TLS kullan, yoksa (Lokal) kullanma
};

// 'ai-generation-queue' adında bir kuyruk oluşturuyoruz
export const generationQueue = new Queue("ai-generation-queue", { 
    connection: redisConnection 
});

console.log("🐂 BullMQ Kuyruğu başlatıldı: ai-generation-queue");