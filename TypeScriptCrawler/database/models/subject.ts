import {
  AutoIncrement,
  BelongsTo,
  Column,
  DataType,
  Default,
  ForeignKey,
  Index,
  Model,
  PrimaryKey,
  Table,
} from "sequelize-typescript";
import { Session } from "./session";
import { Url } from "./url";
import { Worker } from "./worker";
import { Domain } from "./domain";

export enum SubjectStatus {
  UNVISITED = "UNVISITED",
  PROCESSING = "PROCESSING",
  VISITED = "VISITED",
  SKIP = "SKIP"
}

export enum SubjectType {
  RECONNAISSANCE = "RECONNAISSANCE",
  VERIFICATION = "VERIFICATION",
  CXSS_VERFICATION = "CXSS_VERFICATION",
  SCREENSHOT = "SCREENSHOT"
}

@Table({ tableName: "subjects", timestamps: true, createdAt: "created_at", updatedAt: "updated_at" })
export class Subject extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  id!: number;

  @Default(SubjectType.RECONNAISSANCE)
  @Column({ type: DataType.ENUM({ values: Object.keys(SubjectType) }) })
  type!: SubjectType;

  @Column(DataType.TEXT)
  start_url!: string;

  @Column(DataType.TEXT)
  final_url!: string;

  @Index
  @Default(SubjectStatus.UNVISITED)
  @Column({ type: DataType.ENUM({ values: Object.keys(SubjectStatus) }) })
  status!: SubjectStatus;

  @Column(DataType.JSON)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  additional_information!: any;

  @Column(DataType.DATE)
  visitation_begin!: Date

  @Column(DataType.DATE)
  visitation_end!: Date

  @BelongsTo(() => Url)
  url!: Url;

  @Index
  @ForeignKey(() => Url)
  @Column(DataType.INTEGER)
  url_id!: number;

  @BelongsTo(() => Domain)
  domain!: Domain;

  @Index
  @ForeignKey(() => Domain)
  @Column(DataType.INTEGER)
  domain_id!: number;

  @BelongsTo(() => Session)
  session!: Session;

  @Index
  @ForeignKey(() => Session)
  @Column(DataType.INTEGER)
  session_id!: number;

  @Index
  @ForeignKey(() => Worker)
  @Column(DataType.INTEGER)
  worker!: number;
}
