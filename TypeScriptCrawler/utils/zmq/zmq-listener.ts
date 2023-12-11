import { config as dotEnvConfig } from "dotenv";
// Load environment variables
dotEnvConfig()

import { Op } from "sequelize";
import { sequelize } from "../../database/db";
import { Session, SessionStatus } from "../../database/models/session";
import { Subject, SubjectStatus } from "../../database/models/subject";
import { SubjectFactory } from "../factories/subject-factory";
import { Logging } from "../logging";
import { ZMQWrapper, ZMQWrapperTest } from "./zmq-wrapper";
import parser from "../../config/parser";
import { Worker, WorkerStatus } from "../../database/models/worker";
import moment from "moment";
import config from "../../config";
import { readCsv } from "../csv";
import * as schedule from "node-schedule";

const args = parser.parse_args()
let sessionCount = 0;

interface ZMQConfigurationTestMode {
    enabled: boolean; // Flag whether testmode is enabled
    maxSessionCount: number; // Flag how many sessions to fetch at max in testmode
}

interface ZMQConfiguration {
    testMode?: ZMQConfigurationTestMode;
}

// Configuration for ZMQ listener
const listenerConfiguration: ZMQConfiguration = {
    testMode: {
        enabled: config.dynamic.demo,
        maxSessionCount: Number.MAX_SAFE_INTEGER // NOTE: Set to smaller number to reduce number of test sessions generated
    }
};
// Retrieve arguments from command line. Required:
// - crawlers for count of running crawlers
// - fetchinterval as number of seconds of wait time between fetching from account framework
// If any arguments are missing, aborting the zmq listener process.
if (!args.crawlers) {
    Logging.error("No crawler count has been supplied. Terminating")
    process.exit(-1);
}
const PARALLEL_CRAWLER_COUNT: number = args.crawlers;

if (!args.fetchinterval) {
    Logging.error("No fetching interval specified. Terminating")
    process.exit(-1);
}
const ZMQ_FETCH_INTERVAL: number = args.fetchinterval;

if (ZMQ_FETCH_INTERVAL < 60) {
    Logging.warn("Fetching interval for sessions is relatively high. This might introduce lack of sessions and unexpected load on ZMQ server.")
}

if (PARALLEL_CRAWLER_COUNT % 2 !== 0) {
    Logging.warn("Detected usage unequal number of crawlers. This might introduce unwanted issues, use with caution")
}

const siteList: string[] = [];

/**
 * Fetches a session from the account framework, depending on whether crawlers are available to work on one (e.g. not busy and limit of two crawler per session is also exceeded).
 * It queues first a subject with the session linked and afterwards one without attached session, so crawlers which work on oldest subject first, begin by working on
 * session with attached session, to release session asap after being done.
 * 
 */
const fetchSession = async () => {
    if (listenerConfiguration.testMode && listenerConfiguration.testMode.maxSessionCount) {
        if (sessionCount >= listenerConfiguration.testMode.maxSessionCount) {
            return;
        }
    }
    // Initialize ZMQ wrapper depending on configuration with test element or real
    const zmqSession = !listenerConfiguration.testMode ? new ZMQWrapper() : new ZMQWrapperTest();
    await zmqSession.init();
    // Assign session count
    zmqSession.sessionCount = sessionCount;

    // Check if there are new sessions needed and then fetch
    const unvisitedSubjects = await Subject.count({
        where: {
            status: SubjectStatus.UNVISITED,
            worker: null
        }
    })

    // If there are any subjects available for crawlers to work on, return
    if (unvisitedSubjects > 0) {
        Logging.info("Not fetching new session since available subjects exist.")
        return;
    }

    // If there are no subjects for crawlers, check if there are crawlers running
    const totalWorkers = await Worker.count({
        where: {
            status: {
                [Op.ne]: WorkerStatus.FINISHED
            }
        }
    })

    const workersInactive = await Worker.count({
        where: {
            current_subject: null,
            status: WorkerStatus.ACTIVE
        }
    })

    if (totalWorkers > 0) {
        // Retrieve number  of active sessions
        const numberOfActiveSessions = await Session.count({
            where: {
                session_status: SessionStatus.ACTIVE
            }
        })

        // If number of active sessions suffices for crawler count (two crawlers per session), do return
        if (numberOfActiveSessions * 2 >= Math.min(PARALLEL_CRAWLER_COUNT, totalWorkers)) {
            Logging.info(`Not fetching new sessions since enough are ACTIVE for crawler count`);
            return;
        }

        // If number of sessions does not suffice, but there are no workers which are active, return
        if (workersInactive === 0) {
            Logging.info("Not fetching new subjects since all workers have tasks in crawler pool.")
            return;
        } else {
            // Retrieve first entry from sitelist (undefined if not existing)
            const requestSite = siteList.shift();
            // If site to be requested is undefined and there is zmqlist to work on configured, return (list is finished)
            if (config.dynamic.zmqlist && !requestSite) {
                Logging.warn(`Not fetching new session from ZMQ since it has finished site list.`)
                return;
            }
            // Retrieve session zmq session (site is passed as optional, if undefined ignored by wrapper function)
            const session: Session | undefined = await zmqSession.getSession(requestSite);

            // Check if wrapper returned a session
            if (session) {
                // If session was successfully requested, write to database
                const { landing_page } = session.session_information.account.website;
                Logging.info(`Attempting to create a new subject for fetched session for landing_page ${landing_page}`);
                // Increment number of fetched sessions so far
                sessionCount++;

                let additionalInfo = {}
                // Store login form address for subject without session for screenshotting
                if (session.session_information.loginform) {
                    const { formurl, formurlfinal, success } = session.session_information.loginform
                    additionalInfo = {
                        formurl, formurlfinal, success
                    }
                }

                try {
                    // Create subject for session with session linked first
                    await SubjectFactory.createSubjectFromUrlString(landing_page, 0, additionalInfo, undefined, undefined, session)
                } catch (err: unknown) {
                    console.log(err);
                    Logging.error(`Failed to create new subject for session id="${session.id}" with context.`)
                }

                try {
                    // Create subject for session without session linked second
                    await SubjectFactory.createSubjectFromUrlString(landing_page, 0, additionalInfo, undefined, undefined, undefined)
                } catch (err: unknown) {
                    console.log(err);
                    Logging.error(`Failed to create new subject for session id="${session.id}" without context.`);
                }
                Logging.info(`Created two new subjects for fetched session for landing_page ${landing_page}`);
            } else {
                // If session was not requested successfully, re-add in sitelist to work on if it was set (try later again)
                if (requestSite) {
                    // Re-attempt to fetch session for that site
                    siteList.push(requestSite);
                }
                Logging.warn(`No new session fetched via ZMQ.`)
            }
        }
    }
}

/**
 * Unlock all active sessions for which no work is present anymore. 
 */
const unlockSessions = async () => {
    const currentTime = new Date();
    const sessions = await Session.findAll({
        where: {
            session_status: SessionStatus.ACTIVE
        }
    });
    Logging.info("Starting session unlocking cronjob.")
    // For each session, check if session is expired due to configuration or no work present anymore
    for (let index = 0; index < sessions.length; index++) {
        const element = sessions[index];

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (moment(currentTime).diff((element as any).created_at, 'seconds') >= ((config.maxTime.session) / 1000)) {
            // If session is  older than maxTime per session plus potential screenshotting treshold: unlock the session without ZMQ
            await Session.update({
                session_status: SessionStatus.UNLOCKED,
                additional_information: {
                    message: "Unlocked only in database due to session being expired in zmq connection."
                }
            }, {
                where: {
                    id: element.id
                }
            })
        } else {
            // If session is valid (less old than maxTime.session+treshold?), then look whether session is done and unlock with ZMQ
            const subjectCount = await Subject.count({
                where: {
                    session_id: element.id,
                    status: {
                        [Op.and]: [
                            { [Op.ne]: SubjectStatus.VISITED },
                            { [Op.ne]: SubjectStatus.SKIP },
                        ]
                    }
                }
            })
            // If there are no subjects for that session (=session is done), unlock it
            if (subjectCount === 0) {
                const zmqSession = !listenerConfiguration.testMode ? new ZMQWrapper() : new ZMQWrapperTest();
                await zmqSession.init()
                await zmqSession.unlockSession(element.id)
            }
        }
    }

    Logging.info("Finished session unlocking cronjob")
}

/**
 * Main entry function for zmq listener class, runs fetchSession in configured time interval (in seconds) and
 * schedules session unlocking as a cronjob running every minute.
 */
async function zmqListen() {
    Logging.info("Started ZMQ listener.")
    // Connect to database
    await sequelize.sync();
    let interval: NodeJS.Timeout | undefined;

    // If sitelist is configured to fetch from, queue entries into siteList
    if (config.dynamic.zmqlist) {
        Logging.info(`Prepending files from zmq list file at ${config.dynamic.zmqlist}`)
        const zmqList = config.dynamic.zmqlist;
        // Read sitelist csv from disk (structure: list of domains without delimiters)
        const list = await readCsv(zmqList, undefined);

        // Append to list
        for (let index = 0; index < list.length; index++) {
            const element = list[index];
            siteList.push(element[0])
        }
    }
    // Fetch session for first time
    await fetchSession();
    try {
        // Start interval functions to re-run fetching session periodically
        interval = setInterval(async () => {
            await fetchSession();
        }, ZMQ_FETCH_INTERVAL * 1000);
    } catch (err: unknown) {
        // On error, stop session fetcher
        if (interval) {
            clearInterval(interval);
        }
        Logging.error(`ZMQ-Listener broke down. Error: ${(err as Error).toString()}`);
    }

    // Schedule unlocking function every minute
    schedule.scheduleJob('*/1 * * * *', async function () {
        await unlockSessions();
    });
}

// Start main function
zmqListen();

export { zmqListen }