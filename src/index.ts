import "reflect-metadata";
import express from "express";
import { AppDataSource } from "./data-source";
import * as dotenv from "dotenv";
import generationRoutes from "./routes/generationRoutes"; 
import { startWorker } from "./worker/generationWorker";

dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

app.get("/health", (req, res) => {
    res.json({ status: "OK", message: "TRYPIX AI Worker Backend is running!" });
});

//  /api rotası altındaki tüm istekleri generationRoutes'a yönlendir
app.use("/api", generationRoutes); 

AppDataSource.initialize()
    .then(() => {
        console.log("📦 Veritabanı bağlantısı başarılı!");
        startWorker();
        
        app.listen(PORT, () => {
            console.log(`🚀 Sunucu ${PORT} portunda çalışıyor. http://localhost:${PORT}/health adresine gidebilirsin.`);
        });
    })
    .catch((error) => {
        console.error("❌ Veritabanına bağlanırken bir hata oluştu:", error);
    });