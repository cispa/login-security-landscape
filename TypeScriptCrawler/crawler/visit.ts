import { config as dotEnvConfig } from "dotenv";
// Load environment variables
dotEnvConfig()

import { Logging } from "../utils/logging";
import Crawler from ".";
import config from "../config";
import { Subject, SubjectType } from "../database/models/subject";
import { Session } from "../database/models/session";
import { Url } from "../database/models/url";
import { sequelize } from "../database/db";
import { benchmark } from "../utils/benchmark";
import DatabaseHelper from "../utils/database-helper";

(async () => {
    const taskBenchmark = benchmark(`Performing task ${config.dynamic.subject} as crawler id="${config.dynamic.crawler}"`)

    // Assign passed id to crawler
    const crawler = new Crawler()
    crawler.id = config.dynamic.crawler

    // Fetch assigned subject
    const subject = await Subject.findOne({
        where: {
            id: config.dynamic.subject
        },
        include: [Session, Url]
    })
    if (!subject) {
        return;
    }

    try {
        // Copy subject data and start crawl visit on task (pass task data according to task type)
        if (subject.type == SubjectType.CXSS_VERFICATION) {
            const task = {
                id: subject.id,
                url: subject.start_url,
                url_id: subject.url_id,
                domain_id: subject.domain_id,
                type: subject.type,
                taskData: subject.additional_information.taskData,
                session: subject.session
            }
            await crawler.visit(task)
        } else if (subject.type == SubjectType.RECONNAISSANCE) {
            await crawler.visit({
                id: subject.id,
                url: subject.start_url,
                url_id: subject.url_id,
                domain_id: subject.domain_id,
                type: subject.type,
                taskData: {
                    depth: subject.url.depth,
                },
                session: subject.session
            })
        } else if (subject.type == SubjectType.SCREENSHOT) {
            await crawler.visit({
                id: subject.id,
                url: subject.start_url,
                url_id: subject.url_id,
                domain_id: subject.domain_id,
                type: subject.type,
                taskData: subject.additional_information,
                session: subject.session
            })
        } else {
            Logging.error("Next subjects have incorrect type!?")
        }

    } catch (err: unknown) {
        // On error, save error in subject additional information and mark it as skip
        Logging.error(`Fatal error during visit.ts occured. Error: ${(err as Error).toString()}`)
        await DatabaseHelper.skipSubject(subject.id, subject.url_id, (err as Error).toString())
    } finally {
        // After visiting, close database connection and exist process
        await sequelize.close();
        taskBenchmark.stop();
        process.exit(0)
    }
})()

const termination = (signal: string): NodeJS.SignalsListener => {
    return () => {
        setTimeout(async () => {
            Logging.error(`Crawler visit process got terminated with signal ${signal}.`)
            await sequelize.close();
            process.exit(1);
        }, 1).unref();
    };
}

process
    .on('SIGTERM', termination('SIGTERM'))
    .on('SIGINT', termination('SIGINT'));