import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, OneToMany } from "typeorm";
import { Attempt } from "./Attempt";

@Entity()
export class GenerationJob {
    @PrimaryGeneratedColumn("uuid")
    id!: string;

    // BURAYI GÜNCELLEDİK: type: "varchar" ekledik
    @Column({ type: "varchar" })
    original_image_url!: string;

    // BURAYI GÜNCELLEDİK: type: "text" ekledik
    @Column({ type: "text" })
    initial_prompt!: string;

    @OneToMany(() => Attempt, attempt => attempt.job)
    attempts!: Attempt[];

    @CreateDateColumn()
    created_at!: Date;

    @UpdateDateColumn()
    updated_at!: Date;
}