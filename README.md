#  AI Generation & Improvement API

This repository contains the backend service for managing AI image generation attempts and supporting iterative, agentic improvement requests for low-quality outputs. The system is designed to handle unreliable asynchronous AI workflows robustly.

## 🚀 Overview
The architecture is built to support a resilient lifecycle for image generation. Instead of blind retries, the system utilizes a Large Language Model (OpenRouter) acting as an "Agent" to analyze user feedback, rewrite prompts, and dynamically adjust diffusion strength parameters before delegating the generation task to an asynchronous worker queue.

## 🛠️ Tech Stack & Architecture
* **Framework:** Node.js with Express & TypeScript
* **Database:** PostgreSQL (Managed via TypeORM)
* **Queue System:** Redis & BullMQ for async job processing
* **AI Integrations:**
  * **Fal.ai (Flux):** For high-quality, image-to-image diffusion models.
  * **OpenRouter (GPT-4o-mini):** For prompt engineering and dynamic generation logic.

## 🧠 Core Design Decisions

### 1. Asynchronous Workflow
AI generation can take variable amounts of time. To prevent HTTP timeout issues and server blocking, all generation and improvement tasks are offloaded to **BullMQ**. The REST API responds instantly with a `202 Accepted` and a unique `attempt_id`, allowing the client to poll the status asynchronously.

### 2. Self-Referencing Lifecycle Modeling
To track how generations evolve over time, the `Attempt` entity uses a self-referencing relationship (`parent_attempt_id`). This creates a tree-like history of improvements stemming from a single original `GenerationJob`, preserving the entire context and history of user corrections.

### 3. Agentic Improvement Flow
When an image is marked as low quality, the system doesn't just re-roll. The `improvementService` queries an LLM to:
1. Understand the user's explicit feedback.
2. Generate a highly detailed, targeted prompt.
3. Determine a dynamic `strength` (denoising) value (e.g., higher strength for structural changes, lower for minor tweaks).

### 4. Idempotency & Concurrency Control
To prevent uncontrolled duplicate processing and race conditions, the `/improve` endpoint implements strict concurrency control. If an improvement request is already `QUEUED` or `PROCESSING` for a specific parent attempt, subsequent requests are rejected with a `409 Conflict`.

## 📡 API Endpoints

* `POST /api/generate` - Initiates a base image generation job.
* `POST /api/improve` - Submits feedback for a specific attempt and triggers the AI agent to initiate an improved generation.
* `GET /api/status/:attempt_id` - Polls the current status (`QUEUED`, `PROCESSING`, `COMPLETED`, `FAILED`) of an attempt.
* `GET /api/job/:job_id/history` - Operator view detailing the chronological evolution and tree structure of a job and all its subsequent improvement attempts.

## ⚙️ Running Locally

1. Clone the repository and run `npm install`.
2. Set up your `.env` file with `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `REDIS_HOST`, `REDIS_PORT`, `FAL_KEY`, and `OPENROUTER_API_KEY`. (Do not hardcode credentials in `docker-compose.yml` or source files).
3. Start the infrastructure via Docker: `docker-compose up -d`
4. Start the application: `npm run dev`

---
**Author:** Mustafa Alper Bilir
