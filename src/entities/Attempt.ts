import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn } from "typeorm";
import { GenerationJob } from "./GenerationJob";

export enum AttemptStatus {
    QUEUED = "QUEUED",
    PROCESSING = "PROCESSING",
    COMPLETED = "COMPLETED",
    FAILED = "FAILED"
}

@Entity()
export class Attempt {
    @PrimaryGeneratedColumn("uuid")
    id!: string;

    @ManyToOne(() => GenerationJob, job => job.attempts)
    @JoinColumn({ name: "job_id" })
    job!: GenerationJob;

    @ManyToOne(() => Attempt, { nullable: true })
    @JoinColumn({ name: "parent_attempt_id" })
    parent_attempt?: Attempt; 

    @Column({
        type: "enum",
        enum: AttemptStatus,
        default: AttemptStatus.QUEUED
    })
    status!: AttemptStatus;

    // BURAYI GÜNCELLEDİK: type: "varchar" ekledik
    @Column({ type: "varchar", nullable: true })
    generated_image_url?: string;

    @Column({ type: "text", nullable: true })
    error_reason?: string;

    @Column({ type: "text", nullable: true })
    improvement_context?: string;

    @Column({ type: "jsonb", nullable: true })
    ai_metadata?: Record<string, any>;

    @CreateDateColumn()
    created_at!: Date;

    @UpdateDateColumn()
    updated_at!: Date;
}