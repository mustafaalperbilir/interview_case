import "reflect-metadata";
import { DataSource } from "typeorm";
import { GenerationJob } from "./entities/GenerationJob";
import { Attempt } from "./entities/Attempt";
import * as dotenv from "dotenv";

// .env dosyasındaki değişkenleri sürece dahil ediyoruz
dotenv.config();

export const AppDataSource = new DataSource({
    type: "postgres",
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || "5432"), // Port için varsayılan standart kalabilir
    username: process.env.DB_USER,
    password: process.env.DB_PASSWORD, // BÜTÜN HARDCODED ŞİFRELERİ KALDIRDIK! Doğrudan .env ne derse o.
    database: process.env.DB_NAME,
    ssl: true,
    synchronize: true, // Geliştirme ortamında tabloları otomatik oluşturur
    logging: false,
    entities: [GenerationJob, Attempt],
    subscribers: [],
    migrations: [],
});