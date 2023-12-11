import {
  Column,
  DataType,
  HasMany,
  Model,
  PrimaryKey,
  AutoIncrement,
  Table,
  BelongsTo,
  ForeignKey,
  Index
} from "sequelize-typescript";
import { Url } from "./url";
import { Session } from "./session";
import { Subject } from "./subject";

@Table({ tableName: "domains", timestamps: true, createdAt: "created_at", updatedAt: "updated_at" })
export class Domain extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  id!: number;

  @Column(DataType.STRING)
  name!: string;

  @Column(DataType.INTEGER)
  rank!: number;

  @Column(DataType.INTEGER)
  url_count!: number;

  @HasMany(() => Url)
  urls!: Url[];

  @HasMany(() => Subject)
  subjects!: Subject[];

  @Column(DataType.DATE)
  visitation_begin!: Date

  @Column(DataType.DATE)
  visitation_end!: Date
  
  @BelongsTo(() => Session)
  session!: Session;

  @Index
  @ForeignKey(() => Session)
  @Column(DataType.INTEGER)
  session_id!: number;
}
