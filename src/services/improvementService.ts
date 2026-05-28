import * as dotenv from "dotenv";

dotenv.config();

export const analyzeAndImprovePrompt = async (
    initialPrompt: string,
    feedbackHistory: string[]
): Promise<{ improvedPrompt: string; recommendedStrength: number }> => {
    const openRouterKey = process.env.OPENROUTER_API_KEY;

    if (!openRouterKey) {
        throw new Error("OPENROUTER_API_KEY bulunamadı!");
    }

    const formattedHistory = feedbackHistory.map((f, i) => `Step ${i + 1} feedback: "${f}"`).join("\n");

    // AI'a vereceğimiz DOĞRU sistem komutu (Prompt Engineering)
    const systemPrompt = `You are an expert AI image generation prompt engineer.
The user originally tried to generate an image with this prompt: "${initialPrompt}".
Over multiple attempts, the user provided the following feedback history to improve the image:
${formattedHistory}

Your task is to generate a new, highly detailed prompt that addresses the LATEST feedback while keeping the context of previous improvements in mind.
Also, you must provide a 'strength' value between 0.1 and 1.0 for an Image-to-Image diffusion model. 
- HIGH values (0.80 - 0.95): Use this when the user wants to DRASTICALLY change the original image (e.g., turning a modern car into a vintage 1930s car, changing the core structure).
- LOW values (0.20 - 0.50): Use this when the user only wants minor tweaks, keeping the original image structure largely intact.

Return ONLY a valid JSON object in this exact format:
{"improvedPrompt": "new detailed prompt here", "recommendedStrength": 0.85}`;
    try {
        console.log("🧠 [AI Service] OpenRouter'a iyileştirme isteği atılıyor...");
        
        // OpenRouter üzerinden hızlı ve ucuz bir model (GPT-4o-mini vb.) kullanıyoruz
        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${openRouterKey}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: "openai/gpt-4o-mini", // OpenRouter'daki geçerli modellerden biri
                response_format: { type: "json_object" }, // Kesinlikle JSON dönmesini emrediyoruz
                messages: [
                    { role: "system", content: systemPrompt }
                ]
            })
        });

        const data = await response.json();
        const resultContent = data.choices[0].message.content;
        
        // Gelen JSON string'i parse ediyoruz
        const parsedResult = JSON.parse(resultContent);
        
        console.log("🧠 [AI Service] Yeni Karar:", parsedResult);

        return {
            improvedPrompt: parsedResult.improvedPrompt,
            recommendedStrength: parsedResult.recommendedStrength
        };

    } catch (error) {
        console.error("❌ [AI Service] OpenRouter API hatası:", error);
        // Eğer LLM patlarsa, sistemi çökertmemek için fallback (varsayılan) değer dönüyoruz
        return {
            improvedPrompt: `${initialPrompt}, ${feedbackHistory[feedbackHistory.length - 1] || ""}, highly detailed`,
            recommendedStrength: 0.5 
        };
    }
};