import {
  BelongsTo,
  Column,
  DataType,
  ForeignKey,
  HasMany,
  Model,
  PrimaryKey,
  AutoIncrement,
  Table,
  Default,
  HasOne,
  Index,
} from "sequelize-typescript";
import { Domain } from "./domain";
import { Session } from "./session";
import { Subject } from "./subject";

export enum CrawlingStatus {
  INACTIVE = "INACTIVE", PROCESSING = "PROCESSING", COMPLETE = "COMPLETE", IGNORE = "IGNORE"
}

@Table({ tableName: "urls", timestamps: true, createdAt: "created_at", updatedAt: "updated_at" })
export class Url extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  id!: number;

  @Column(DataType.TEXT)
  url!: string;

  @Column(DataType.TEXT)
  url_hash!: string;

  @Column(DataType.INTEGER)
  depth!: number;

  @Default(CrawlingStatus.INACTIVE)
  @Column({ type: DataType.ENUM({ values: Object.keys(CrawlingStatus) }) })
  crawling_status!: CrawlingStatus;

  @Column(DataType.DATE)
  visitation_begin!: Date

  @Column(DataType.DATE)
  visitation_end!: Date
  
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

  @HasMany(() => Subject)
  subjects!: Subject[];


  @Index
  @ForeignKey(() => Url)
  @Column(DataType.INTEGER)
  parent_id!: number;

  @HasOne(() => Url)
  parent!: Url
}
