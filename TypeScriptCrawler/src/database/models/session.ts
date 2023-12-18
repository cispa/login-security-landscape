import {
    Column,
    DataType,
    HasMany,
    Model,
    PrimaryKey,
    AutoIncrement,
    Table,
} from "sequelize-typescript";
import { Subject } from "./subject";
import { Url } from "./url";

export enum SessionStatus {
    ACTIVE = "ACTIVE",
    UNLOCKED = "UNLOCKED",
}

@Table({ tableName: "sessions", timestamps: true, createdAt: "created_at", updatedAt: "updated_at" })
export class Session extends Model {
    @PrimaryKey
    @AutoIncrement
    @Column(DataType.INTEGER)
    id!: number;

    @Column(DataType.JSON)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    session_information!: any;

    @Column(DataType.JSON)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    session_data!: any;

    @Column({ type: DataType.ENUM({ values: Object.keys(SessionStatus) }) })
    session_status!: SessionStatus;


    @Column(DataType.JSON)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    additional_information!: any;

    @HasMany(() => Url)
    urls!: Url[];

    @HasMany(() => Subject)
    subjects!: Subject[];
}
