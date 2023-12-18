import { config as dotEnvConfig } from "dotenv";
// Load environment variables
dotEnvConfig()

import config from "./config";
import { sequelize } from "./database/db";
import { Session } from "./database/models/session";
import { Worker } from "./database/models/worker";
import { Task, TaskQueue } from "./crawler/taskqueue";
import { benchmark } from "./utils/benchmark";
import DatabaseHelper from "./utils/database-helper";
import { Logging } from "./utils/logging";
import { sleep } from "./utils/sleep";
import { spawn } from "child_process";
import * as path from 'path';

let numberOfFinishedSubjects = 0;
let id: number | undefined;
const queue = new TaskQueue();

const spawnCrawler = (crawlerId: number, subject: Task) => {
    return new Promise((resolve) => {
        // Start the crawler process
        const child = spawn('node', [
            '--max-old-space-size=16384',
            path.join(__dirname, "crawler", "visit.js"),
            '--crawler',
            crawlerId,
            '--subject',
            subject.id,
            // Pass relevant optional configuration options from CLI
            ...(config.dynamic.datapath ? ['--datapath', config.dynamic.datapath] : []),
            ...(config.dynamic.module ? ['--module', config.dynamic.module] : []),
            ...(config.dynamic.user_data_dir ? ['--user_data_dir', config.dynamic.user_data_dir] : []),
            ...(config.dynamic.chromium ? ['--chromium'] : []),
            ...(config.dynamic.firefox ? ['--firefox'] : []),
            ...(config.dynamic.browser_executable_path ? ['--browser_executable_path', config.dynamic.browser_executable_path] : []),
            ...(config.dynamic.user_agent ? ['--user_agent', config.dynamic.user_agent] : []),
            ...(config.dynamic.headfull ? ['--headfull'] : [])
        ], { 'detached': true });

        child.stdout.setEncoding('utf8');
        // Listen for messages from the child process
        child.stdout.on('data', (data: string) => {
            console.log(data.trim())
        });

        let errored = false;
        let errorMessage = "";

        child.stderr.setEncoding('utf8');
        // Listen for error output from the child process
        child.stderr.on('data', (data: string) => {
            // Capture the error if its output
            errorMessage = data.trim();
            errored = true;
        });

        // Kill the process after specified timeout (config.maxTime.subject from config.ts)
        let killed = false;
        const timeout = setTimeout(() => {
            killed = true;
            Logging.warn("Killing the child process forcefully...")
            child.kill('SIGINT');
        }, config.maxTime.subject);

        // Handle closing of child crawler process
        child.on('close', async function () {
            clearTimeout(timeout);
            if (errored) {
                // On error, save error message in additional information portion of subject row
                Logging.warn("Crawler process had an error")

                Logging.error(`Skipping subject due to crawler process exiting with error. Error: ${errorMessage}`)
                // Mark subject as skipped
                await DatabaseHelper.skipSubject(subject.id, subject.url_id as number, `Skipping subject due to crawler process exiting with error. Error: ${errorMessage}`)

                resolve(false)
            } else if (killed) {
                // If process got killed (crawl exceeded max time per subject), store message in additional information
                Logging.warn("Crawler process kille got killed")

                Logging.error(`Skipping subject due to being early terminated by managing process.`)
                // Mark subject as skipped
                await DatabaseHelper.skipSubject(subject.id, subject.url_id as number, `Skipping subject due to being early terminated by managing process.`)

                resolve(false)
            } else {
                Logging.info("Terminated crawl process successfully.")
                resolve(true)
            }
        });
    })
}

(async () => {
    Logging.info(`Starting crawler in ${config.headfull ? "headfull" : "headless"} mode.`)
    id = await DatabaseHelper.registerCrawler();
    queue.workerId = id;
    let pollingCounter = 0;
    const pollingMax = 1000;

    let currentUrlId = undefined;
    let currentDomainId = undefined;
    let currentSession: Session | undefined;
    // eslint-disable-next-line no-constant-condition
    while (true) {
        const iterationBenchmark = benchmark("Performing new iteration in main.ts")

        const fetchWorkBenchmark = benchmark("Fetching work for crawler")
        // Attempt to fetch work either staying in same URL, then staying on current domain (and session if exists) and lastly with no preset
        let subject: Task | undefined = await queue.dequeue(currentUrlId, currentDomainId, currentSession?.id);
        if (!subject && currentUrlId) {
            currentUrlId = undefined;
            subject = await queue.dequeue(currentUrlId, currentDomainId, currentSession?.id);
            Logging.info("Attempting to fetch new subject without fixed url id but with session & domain.")
        }

        if (!subject && !currentUrlId && currentDomainId) {
            currentDomainId = undefined;
            subject = await queue.dequeue(currentUrlId, currentDomainId, currentSession?.id);
            Logging.info("Attempting to fetch new subject without fixed url id and with session & domain.")
        }

        if (!subject && !currentUrlId && !currentDomainId) {
            subject = await queue.dequeue();
            Logging.info("Attempting to fetch new subject without fixed url id and without domain.")
        }
        // If polling enabled and no subject fetched, retry again if possible
        if (config.dynamic.polling && !subject) {
            const pollingInterval = parseInt(config.dynamic.polling) * 1000;

            // If running forever or below poll max treshold, enter this loop to retry
            if ((pollingCounter < pollingMax) || config.dynamic.forever) {
                Logging.warn(`Sleeping for ${pollingInterval} milli-seconds for the ${pollingCounter}-th time.`)
                pollingCounter++;

                // Update worker table set current_subject to null
                await Worker.update({
                    current_subject: null
                }, {
                    where: {
                        id: id
                    }
                })

                // Synchronous sleep for pollingInterval (in milliseconds)
                await sleep(pollingInterval);
                continue;
            } else {
                // If exceeded polling treshold, clear current subject (superflous) and terminate crawler process
                await Worker.update({
                    current_subject: null
                }, {
                    where: {
                        id: id
                    }
                })

                await DatabaseHelper.deregisterCrawler({
                    workerId: id!,
                    numberOfFinishedSubjects: numberOfFinishedSubjects,
                    message: `Terminating crawler due to having polling-treshhold met. Shutting down...`
                })
                await sequelize.close()
                process.exit(0);
            }
        }
        // If no polling enabled/not running forever and no work, unregister crawler and terminate process
        if (!subject && !currentUrlId && !currentSession) {
            // If no new work got fetched,
            await Worker.update({
                current_subject: null
            }, {
                where: {
                    id: id
                }
            })

            Logging.info("No more work for this crawler.")
            await DatabaseHelper.deregisterCrawler({
                workerId: id!,
                numberOfFinishedSubjects: numberOfFinishedSubjects,
                message: "Normal worker termination"
            })
            await sequelize.close()
            process.exit(0);
        }
        // Work was fetched, update current url, domain and session information
        currentUrlId = subject!.url_id;
        currentDomainId = subject!.domain_id;
        currentSession = subject?.session;
        await Worker.update({
            current_subject: subject!.id
        }, {
            where: {
                id: id
            }
        })
        fetchWorkBenchmark.stop()
        // Spawn crawler to work on fetched subject
        await spawnCrawler(id!, subject!);
        numberOfFinishedSubjects++;

        iterationBenchmark.stop()
        // Reset polling counter due to having got new work again
        pollingCounter = 0;
    }
})()

const termination = (signal: string): NodeJS.SignalsListener => {
    return () => {
        setTimeout(async () => {
            await DatabaseHelper.deregisterCrawler({
                workerId: id!,
                numberOfFinishedSubjects: numberOfFinishedSubjects,
                message: `Crawler process got terminated with signal ${signal}.`
            })
            await sequelize.close();
            process.exit(1);
        }, 1).unref();
    };
}

process
    .on('SIGTERM', termination('SIGTERM'))
    .on('SIGINT', termination('SIGINT'));