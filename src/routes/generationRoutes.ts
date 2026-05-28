import { Router, Request, Response } from "express";
import { AppDataSource } from "../data-source";
import { GenerationJob } from "../entities/GenerationJob";
import { Attempt, AttemptStatus } from "../entities/Attempt";
import { generationQueue } from "../queue/generationQueue";
import { analyzeAndImprovePrompt } from "../services/improvementService"; // AI Servisimizi dahil ettik
import { z } from "zod";

const router = Router();

// Zod Schemas
const generateSchema = z.object({
    original_image_url: z.string().url("Geçerli bir URL girmelisiniz."),
    initial_prompt: z.string().min(3, "Prompt en az 3 karakter olmalıdır.")
});

const improveSchema = z.object({
    parent_attempt_id: z.string().uuid("Geçerli bir UUID girmelisiniz."),
    feedback: z.string().min(3, "Feedback en az 3 karakter olmalıdır.")
});

// ==========================================
// 1. İLK GÖRSEL ÜRETİM (GENERATE) ENDPOINT'İ
// ==========================================
router.post("/generate", async (req: Request, res: Response): Promise<any> => {
    try {
        const validation = generateSchema.safeParse(req.body);

        if (!validation.success) {
            return res.status(400).json({ error: "Girdi doğrulama hatası", details: validation.error.format() });
        }

        const { original_image_url, initial_prompt } = validation.data;

        // 1. Ana İşi (GenerationJob) Veritabanına Kaydet
        const jobRepository = AppDataSource.getRepository(GenerationJob);
        const newJob = jobRepository.create({
            original_image_url,
            initial_prompt
        });
        await jobRepository.save(newJob);

        // 2. İlk Denemeyi (Attempt) Veritabanına Kaydet (QUEUED durumunda)
        const attemptRepository = AppDataSource.getRepository(Attempt);
        const newAttempt = attemptRepository.create({
            job: newJob,
            status: AttemptStatus.QUEUED
        });
        await attemptRepository.save(newAttempt);

        // 3. İşlemi Arka Plan Kuyruğuna (Redis) Gönder
        await generationQueue.add("generate-image-task", {
            attempt_id: newAttempt.id,
            original_image_url: newJob.original_image_url,
            prompt: newJob.initial_prompt
            // İlk üretimde strength yollamıyoruz, Worker kendi varsayılanını (0.75) kullanacak
        }, {
            attempts: 3,
            backoff: { type: "exponential", delay: 2000 }
        });

        // 4. Kullanıcıya Hızlıca Cevap Dön (İşlemi beklemiyoruz!)
        return res.status(202).json({
            message: "İşlem başarıyla sıraya alındı.",
            job_id: newJob.id,
            attempt_id: newAttempt.id,
            status: newAttempt.status
        });

    } catch (error) {
        console.error("Generate Endpoint Hatası:", error);
        return res.status(500).json({ error: "Sunucu tarafında bir hata oluştu." });
    }
});

// ==========================================
// 2. İYİLEŞTİRME (IMPROVE) ENDPOINT'İ
// ==========================================
router.post("/improve", async (req: Request, res: Response): Promise<any> => {
    try {
        const validation = improveSchema.safeParse(req.body);

        if (!validation.success) {
            return res.status(400).json({ error: "Girdi doğrulama hatası", details: validation.error.format() });
        }

        const { parent_attempt_id, feedback } = validation.data;

        const attemptRepository = AppDataSource.getRepository(Attempt);
        
        // 1. Önceki başarısız/beğenilmeyen denemeyi buluyoruz
        const parentAttempt = await attemptRepository.findOne({
            where: { id: parent_attempt_id as string },
            relations: { job: true, parent_attempt: true }
        });

        if (!parentAttempt) {
            return res.status(404).json({ error: "Belirtilen Attempt bulunamadı." });
        }

        // =========================================================================
        // [YENİ - ÇAKIŞMA KİLİDİ (IDEMPOTENCY / CONCURRENCY CONTROL)]
        // Jürinin istediği: "Prevent uncontrolled duplicate or conflicting attempts"
        // Bu parent attempt için halihazırda kuyrukta bekleyen veya işlenen bir çocuk var mı?
        // =========================================================================
        const existingActiveImprovement = await attemptRepository.findOne({
            where: [
                { parent_attempt: { id: parent_attempt_id as string }, status: AttemptStatus.QUEUED },
                { parent_attempt: { id: parent_attempt_id as string }, status: AttemptStatus.PROCESSING }
            ]
        });

        if (existingActiveImprovement) {
            // 409 Conflict: Sunucu durumunda bir çakışma var (Zaten bir işlem sürüyor)
            return res.status(409).json({
                error: "Bu işlem için zaten devam eden bir iyileştirme var. Lütfen önce onun bitmesini bekleyin.",
                active_attempt_id: existingActiveImprovement.id,
                status: existingActiveImprovement.status
            });
        }
        // =========================================================================

        // 2. Geçmiş Geri Bildirimleri (Feedback History) Toplama
        const feedbackHistory: string[] = [];
        let currentParent: Attempt | null | undefined = parentAttempt;
        
        while (currentParent && currentParent.improvement_context) {
            feedbackHistory.unshift(currentParent.improvement_context);
            if (currentParent.parent_attempt) {
                 currentParent = await attemptRepository.findOne({
                     where: { id: currentParent.parent_attempt.id },
                     relations: { parent_attempt: true }
                 });
            } else {
                 currentParent = null;
            }
        }
        feedbackHistory.push(feedback);

        // 3. OpenRouter AI'ını kullanarak yeni prompt ve strength değerlerini hesaplatıyoruz
        const aiDecision = await analyzeAndImprovePrompt(parentAttempt.job.initial_prompt, feedbackHistory);

        // 4. YENİ BİR ATTEMPT OLUŞTUR
        const newAttempt = attemptRepository.create({
            job: parentAttempt.job,
            parent_attempt: parentAttempt,
            improvement_context: feedback,
            status: AttemptStatus.QUEUED
        });
        await attemptRepository.save(newAttempt);

        // 5. İşi Redis kuyruğuna gönderiyoruz
        await generationQueue.add("improve-image-task", {
            attempt_id: newAttempt.id,
            original_image_url: parentAttempt.job.original_image_url,
            prompt: aiDecision.improvedPrompt,
            strength: aiDecision.recommendedStrength
        }, {
            attempts: 3,
            backoff: { type: "exponential", delay: 2000 }
        });

        // 6. Kullanıcıya bilgi dön
        return res.status(202).json({
            message: "İyileştirme işlemi sıraya alındı.",
            parent_attempt_id: parentAttempt.id,
            new_attempt_id: newAttempt.id,
            new_parameters: aiDecision
        });

    } catch (error) {
        console.error("Improve Endpoint Hatası:", error);
        return res.status(500).json({ error: "Sunucu tarafında bir hata oluştu." });
    }
});


// ==========================================
// 3. DURUM SORGULAMA (STATUS) ENDPOINT'İ
// ==========================================
router.get("/status/:attempt_id", async (req: Request, res: Response): Promise<any> => {
    try {
        const { attempt_id } = req.params;

        const attemptRepository = AppDataSource.getRepository(Attempt);
        
        // Denemeyi ve bağlı olduğu ana işi (job) veritabanından çekiyoruz
        // Denemeyi ve bağlı olduğu ana işi (job) veritabanından çekiyoruz
        const attempt = await attemptRepository.findOne({
            where: { id: attempt_id as string }, // DÜZELTİLEN KISIM: as string eklendi
            relations: { job: true }
        });

        if (!attempt) {
            return res.status(404).json({ error: "Belirtilen işlem (Attempt) bulunamadı." });
        }

        // İstemciye (Frontend/Kullanıcı) sadece ihtiyacı olan temiz veriyi dönüyoruz
        const responseData = {
            attempt_id: attempt.id,
            job_id: attempt.job.id,
            status: attempt.status, // QUEUED, PROCESSING, COMPLETED veya FAILED
            original_image_url: attempt.job.original_image_url,
            generated_image_url: attempt.generated_image_url || null,
            error_reason: attempt.error_reason || null,
            created_at: attempt.created_at,
            updated_at: attempt.updated_at
        };

        return res.status(200).json(responseData);

    } catch (error) {
        console.error("Status Endpoint Hatası:", error);
        return res.status(500).json({ error: "Sunucu tarafında bir hata oluştu." });
    }
});

// ==========================================
// 4. OPERATÖR GÖRÜNÜMÜ: İŞ TARİHÇESİ (JOB HISTORY) ENDPOINT'İ
// ==========================================
router.get("/job/:job_id/history", async (req: Request, res: Response): Promise<any> => {
    try {
        const { job_id } = req.params;

        const jobRepository = AppDataSource.getRepository(GenerationJob);
        const attemptRepository = AppDataSource.getRepository(Attempt);

        // 1. Önce ana işin (Job) kendisini buluyoruz
        const job = await jobRepository.findOne({
            where: { id: job_id as string }
        });

        if (!job) {
            return res.status(404).json({ error: "Belirtilen Job bulunamadı." });
        }

        // 2. Bu işe ait TÜM denemeleri (Attempts) kronolojik sırayla çekiyoruz
        // parent_attempt ilişkisini de ekliyoruz ki hangisi hangisinin çocuğu görebilelim
        const attempts = await attemptRepository.find({
            where: { job: { id: job_id as string } },
            relations: { parent_attempt: true },
            order: { created_at: "ASC" } // Eskiden yeniye doğru sırala
        });

        // 3. "Tarihçe" (Lifecycle) ağacını oluşturuyoruz
        const historyTree = attempts.map(attempt => ({
            attempt_id: attempt.id,
            status: attempt.status,
            is_improvement: !!attempt.parent_attempt, // Eğer bir ebeveyni varsa bu bir iyileştirmedir
            parent_attempt_id: attempt.parent_attempt?.id || null,
            improvement_context: attempt.improvement_context || "Initial Generation", // İlk üretim mi, şikayet mi?
            generated_image_url: attempt.generated_image_url || null,
            error_reason: attempt.error_reason || null,
            timestamp: attempt.created_at
        }));

        // 4. Tüm tabloyu operatöre (veya Frontend'e) dönüyoruz
        return res.status(200).json({
            job_id: job.id,
            original_image_url: job.original_image_url,
            initial_prompt: job.initial_prompt,
            total_attempts: attempts.length,
            history: historyTree
        });

    } catch (error) {
        console.error("History Endpoint Hatası:", error);
        return res.status(500).json({ error: "Sunucu tarafında bir hata oluştu." });
    }
});

export default router;