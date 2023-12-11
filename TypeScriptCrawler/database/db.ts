/* eslint-disable @typescript-eslint/no-explicit-any */
import {
    Model,
    ModelCtor,
    Sequelize,
    SequelizeOptions,
} from "sequelize-typescript";
import { Domain } from "./models/domain";
import { Subject } from "./models/subject";
import { Url } from "./models/url";
import { Session } from "./models/session";
import { Worker } from "./models/worker";

// If db is not setup, create connection
if (!(global as any).db) {
    const dbModels: ModelCtor<Model<any, any>>[] = [
        Domain,
        Subject,
        Url,
        Session,
        Worker
    ];

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const log = (query: string, timing?: number) => {
        // console.log(`${query} took ${timing} ms`);
    }

    let db: Sequelize;

    try {
        const options: SequelizeOptions = {
            host: process.env.POSTGRES_HOST!,
            dialect: "postgres",
            benchmark: true,
            logging: log,
            models: dbModels,
            // NOTE: Configure to database specifications
            pool: {
                max: 6,
                min: 0,
                acquire: 90000
            }
        };
        db = new Sequelize(
            process.env.POSTGRES_DB!,
            process.env.POSTGRES_USER!,
            process.env.POSTGRES_PASSWORD!,
            options
        );

    } catch (err) {
        // console.log(err);
        db = null!;
    }

    (global as any).db = db;
}


export const sequelize = (global as any).db;
