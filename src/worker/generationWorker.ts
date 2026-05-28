import { Worker, Job } from "bullmq";
import { AppDataSource } from "../data-source";
import { Attempt, AttemptStatus } from "../entities/Attempt";
import { redisConnection } from "../queue/generationQueue";
import { fal } from "@fal-ai/client";
import * as dotenv from "dotenv";

dotenv.config();

fal.config({
    credentials: process.env.FAL_KEY,
});

export const startWorker = () => {
    console.log("👷 Worker başlatıldı ve kuyruk dinleniyor...");

    const worker = new Worker("ai-generation-queue", async (job: Job) => {
        //  Kuyruktan artık OpenRouter'ın ürettiği dinamik 'strength' değerini de alıyoruz
        const { attempt_id, prompt, original_image_url, strength } = job.data;
        const attemptRepo = AppDataSource.getRepository(Attempt);

        try {
            let attempt = await attemptRepo.findOne({ where: { id: attempt_id } });
            if (!attempt) throw new Error("Attempt bulunamadı!");

            attempt.status = AttemptStatus.PROCESSING;
            await attemptRepo.save(attempt);

            console.log(`[Worker] 🚀 İşlem başladı: ${attempt_id}. Model tetikleniyor...`);

            //  Eğer gelen iş bir iyileştirme işiyse onun strength değerini kullan, 
            // eğer ilk üretimse varsayılan olarak 0.75 kullan.
            const finalStrength = strength !== undefined ? strength : 0.75;
            console.log(`[Worker] 📊 Kullanılan Yapay Zeka Sadakat Oranı (Strength): ${finalStrength}`);

            const result: any = await fal.subscribe("fal-ai/flux/dev/image-to-image", {
                input: {
                    prompt: prompt,
                    image_url: original_image_url,
                    strength: finalStrength, // Artık tamamen dinamik!
                    image_size: "landscape_4_3",
                    num_inference_steps: 28
                } as any
            });

            console.log("[Worker] 📡 Fal.ai'den gelen ham yanıt:", JSON.stringify(result, null, 2));

            const targetImages = result.images || result.data?.images;

            if (!targetImages || targetImages.length === 0) {
                throw new Error("Fal.ai API'si başarılı bir görsel çıktısı üretemedi veya boş döndü.");
            }

            const generatedImageUrl = targetImages[0].url;

            attempt.status = AttemptStatus.COMPLETED;
            attempt.generated_image_url = generatedImageUrl;
            attempt.ai_metadata = result;
            await attemptRepo.save(attempt);

            console.log(`[Worker] ✅ İşlem BAŞARILI! Yeni resim: ${generatedImageUrl}`);

        } catch (error: any) {
            console.error(`[Worker] ❌ HATA OLUŞTU:`, error.message);

            try {
                let attempt = await attemptRepo.findOne({ where: { id: attempt_id } });
                if (attempt) {
                    attempt.status = AttemptStatus.FAILED;
                    attempt.error_reason = error.message;
                    await attemptRepo.save(attempt);
                }
            } catch (dbError: any) {
                console.error(`[Worker] ❌ KRİTİK HATA: FAILED durumu veritabanına kaydedilemedi!`, dbError.message);
            }
        }
    }, {
        connection: redisConnection,
        lockDuration: 60000 // Eğer worker çökerse, işlem sonsuza kadar kilitli kalmaz
    });

    return worker;
};