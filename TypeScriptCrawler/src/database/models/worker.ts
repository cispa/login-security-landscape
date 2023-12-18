import {
  Column,
  DataType,
  Model,
  PrimaryKey,
  Table,
  AutoIncrement,
  ForeignKey
} from "sequelize-typescript";
import { Subject } from "./subject";

export enum WorkerType {
  BROWSER = "BROWSER",
  URL = "URL",
}

export enum WorkerStatus {
  ACTIVE = "ACTIVE",
  FINISHED = "FINISHED"
}

@Table({ tableName: "workers", timestamps: true, createdAt: "created_at", updatedAt: "updated_at" })
export class Worker extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  id!: number;

  @Column({ type: DataType.ENUM({ values: Object.keys(WorkerType) }) })
  type!: WorkerType;

  @Column(DataType.DATE)
  started_at!: Date;

  @Column(DataType.DATE)
  finished_at!: Date;

  @Column(DataType.INTEGER)
  subject_count!: number;

  @Column({ type: DataType.ENUM({ values: Object.keys(WorkerStatus) }) })
  status!: WorkerStatus;

  @Column(DataType.TEXT)
  message!: string;


  @ForeignKey(() => Subject)
  @Column(DataType.INTEGER)
  current_subject!: number;
}
