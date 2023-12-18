import { sequelize } from "../database/db";
import { Logging } from "./logging";
import { Subject, SubjectStatus, SubjectType } from "../database/models/subject";
import { CrawlingStatus, Url } from "../database/models/url";
import { Session, SessionStatus } from "../database/models/session";
import { Worker, WorkerStatus, WorkerType } from "../database/models/worker";
import { Op, Transaction } from "sequelize";
import moment from "moment";
import config from "../config";
import { Domain } from "../database/models/domain";

type DeregistrationOptions = {
    workerId: number;
    numberOfFinishedSubjects: number;
    message?: string;
}

export enum LOCK {
    UPDATE = 'UPDATE',
    SHARE = 'SHARE',
    /**
     * Postgres 9.3+ only
     */
    KEY_SHARE = 'KEY SHARE',
    /**
     * Postgres 9.3+ only
     */
    NO_KEY_UPDATE = 'NO KEY UPDATE',
}

export interface ResponseSubject {
    id: number;
    url: string;
    url_id: number;
    domain_id: number;
    session?: Session;
    type: SubjectType;
    timestamp?: Date;
    depth?: number;
    exploitType?: string;
    exploitData?: PersistentExploitData;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    additional_information: any;
}

export interface PersistentExploitData {
    storage_type: string;
    storage_key: string;
    storage_value: string;
    replace_value: string;
    replace_with: string;
    finding_source_id: number;
}

class DatabaseHelper {

    /**
     * Setup database connection
     */
    static async setup() {
        // Initialize database tables based on provided models
        await sequelize.sync({ force: true })
    }

    /**
     * Register crawler in database by creating entry in worker table and setting attributes (started_at to time of call) and
     * status as ACTIVE.
     * @returns worker id if crawler was successfully registeredm otherwise nothing
     */
    static async registerCrawler() {
        try {
            const worker = await Worker.create({
                type: WorkerType.BROWSER,
                started_at: new Date(),
                status: WorkerStatus.ACTIVE
            })
            // Return id of worker that was created
            Logging.info(`Successfully registered crawler worker with id="${worker.id}"`)
            return worker.id;
        } catch (err: unknown) {
            // On error, return nothing and log error
            Logging.error(`(registerCrawler) Crawler registration failed. Error: ${(err as Error).toString()}`)
        }
    }

    /**
     * Deregister crawler from database and set all all subjects which were PROCESSING to UNVISITED.
     * @param param0 WorkerId, number of finished subjects and termination message to attach in database deregistration
     */
    static async deregisterCrawler({ workerId, numberOfFinishedSubjects, message }: DeregistrationOptions) {
        try {
            // Set all subjects which were PROCESSING by that worker to UNVISITED
            await Subject.update({
                status: SubjectStatus.UNVISITED,
            }, {
                where: {
                    status: SubjectStatus.PROCESSING,
                    worker: workerId
                }
            })

            // Update table entry to reflect end date of crawl
            await Worker.update({
                status: WorkerStatus.FINISHED,
                finished_at: new Date(),
                subject_count: numberOfFinishedSubjects,
                message
            }, {
                where: { id: workerId },
            });
            Logging.info(`Successfully deregistered crawler worker with id="${workerId}"`)
        } catch (err: unknown) {
            Logging.error(`(deregisterCrawler) Crawler deregistration failed. Error: ${(err as Error).toString()}`)
        }
    }

    /**
     * Mark subject in database as status SKIP to ignore the subject, also attaches passed message if exists and after marking 
     * the subject as SKIP, check if url subject belonged to is finished
     * @param subjectId 
     * @param urlId 
     * @param message 
     */
    static async skipSubject(subjectId: number, urlId: number, message?: string) {
        try {
            const subject = await Subject.findOne({
                where: {
                    id: subjectId
                }
            })
            // Check if subject with passed id does exist in database
            if (subject) {
                const currentAdditionalInformation = subject.additional_information;
                // Update subject status in DB
                await Subject.update({
                    status: SubjectStatus.SKIP,
                    additional_information: {
                        message,
                        ...currentAdditionalInformation
                    }
                }, {
                    where: {
                        id: subjectId
                    }
                })
                await DatabaseHelper.onUrlFinish(urlId, subjectId);
            } else {
                // If subject to be skipped does not exist in database, throw error
                throw Error(`(skipSubject) Subject to be skipped does not exist ${subjectId}`)
            }

        } catch (err: unknown) {
            // If error happened during marking subject to be skipped, log it
            Logging.error(`(skipSubject) Failed query to skip subject due to error: ${(err as Error).toString()}`)
        }
    }

    /**
     * Create a new subject in the database with given properties from arguments
     * 
     * @param type Type of Subject
     * @param start_url Start url of the subject
     * @param final_url Final url of the subject
     * @param status Status of the subject
     * @param additional_information Additional information for the subject, such as exploit information in cxss verification tasks
     * @param url_id Id of url the subject is attached to
     * @param worker Worker of subject
     * @param session_id Id of session subject might belong to
     * @returns Created subject on success, otherwise undefined
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    static async addSubject(type: SubjectType, start_url: string, final_url: string, status: SubjectStatus, additional_information: any, url_id: number, worker: number, session_id?: number) {
        try {
            // Create subject in database
            const subject = await Subject.create({
                type,
                start_url,
                final_url,
                status,
                additional_information,
                url_id,
                worker,
                session_id
            })
            return subject;
        } catch (err: unknown) {
            // On error during entry creation, log error
            Logging.error(`(addSubject) Failed to add new subject due to error: ${(err as Error).toString()}`)
            return undefined;
        }
    }

    /**
     * Mark subject as finished in the database. Set final_url to the subject and its state to VISITED.
     * Afterwards, perform onUrlFinish callback to check whether assigned URL is also finished
     * 
     * @param subjectId Subject to mark as finished
     * @param urlId Url the subject belongs to
     * @param final_url Final url of the subject
     */
    static async finishSubject(subjectId: number, urlId: number, final_url: string) {
        try {
            // Update subject status to VISITED and assign final_url
            await Subject.update(
                {
                    status: SubjectStatus.VISITED,
                    final_url: final_url
                }, {
                where: {
                    id: subjectId
                },
            })
            // Run url finish callback
            await DatabaseHelper.onUrlFinish(urlId, subjectId);
        } catch (err: unknown) {
            // On error, output error that happened
            Logging.error(`(finishSubject) Performing finishSubject failed. Error: ${(err as Error).toString()}`)
            console.log(err)
        }
    }

    /**
     * Callback function to run after passed url is potentially done: To schedule tasks after an url was finished, e.g. screenshotting 
     * of the URL after the crawl was finished.
     * 
     * @param urlId To be run after the url with urlId is potentially finished
     * @param subjectId Attached subjectId that caused the execution of the callback function
     * @param transaction Transaction all changed into the db might be attached to
     */
    static async onUrlFinish(urlId: number, subjectId?: number, transaction?: Transaction) {
        const finishTime = new Date();

        // Check if subjectId is set
        if (subjectId) {
            // If subject id was passed, set visitation_end time. Also happens for subjects that were skipped
            await Subject.update({
                visitation_end: finishTime
            }, {
                where: {
                    id: subjectId
                },
                transaction: transaction
            })
        }

        // Check if all subjects of URL are done (no PROCESSING/UNVISITED subjects anymore)
        const unfinishedSubjectsOfUrl = await Subject.count({
            where: {
                url_id: urlId,
                [Op.or]: [
                    {
                        status: SubjectStatus.PROCESSING
                    },
                    {
                        status: SubjectStatus.UNVISITED
                    }
                ]
            },
            transaction: transaction
        });

        // If there are no more processing, unvisited subjects, execute finish code
        if (unfinishedSubjectsOfUrl === 0) {
            // Check if there are any child urls of that URL still being worked on
            const incompleteChildUrls = await Url.count({
                where: {
                    parent_id: urlId,
                    [Op.or]: [
                        {
                            crawling_status: CrawlingStatus.INACTIVE
                        },
                        {
                            crawling_status: CrawlingStatus.PROCESSING
                        }
                    ],
                },
                transaction: transaction
            })
            // If there are no child urls being worked on anymore, update visitation_end and set crawling_status to COMPLETE
            if (incompleteChildUrls === 0) {
                await Url.update({
                    crawling_status: CrawlingStatus.COMPLETE,
                    visitation_end: finishTime
                }, {
                    where: {
                        id: urlId
                    },
                    transaction: transaction
                })

                /**
                 * Schedule screenshot after url belonging to id urlId is finished. Checks first, whether crawl configuration has screenshotting afterwards enabled
                 * and whether current subject depth is in range from configuration
                 * 
                 * @param urlId Url id to schedule screenshot afterwards for
                 */
                const scheduleScreenshotAfterwards = async (urlId: number) => {
                    // Check if screenshotting afterwards is enabled
                    if (config.sessions.screenshotAfterwards) {
                        // Fetch RECONNAISSANCE subject the urlId belongs to, attach session/url
                        const reconSubject = await Subject.findOne({
                            where: {
                                url_id: urlId,
                                type: SubjectType.RECONNAISSANCE
                            },
                            include: [Session, Url],
                            transaction: transaction
                        })

                        // Check whether url depth if less than configuration screenshot maximum depth
                        if (reconSubject?.url.depth! <= config.sessions.screenshotMaxDepth) {
                            // If yes, check whether there was already a subject created to perform screenshotting afterwards
                            const screenshotAfter = await Subject.findOne({
                                where: {
                                    url_id: urlId,
                                    type: SubjectType.SCREENSHOT,
                                    additional_information: {
                                        type: {
                                            [Op.eq]: "screenshotAfterwards"
                                        },
                                        page_type: {
                                            [Op.eq]: "landing_page"
                                        },
                                        related_subject: {
                                            [Op.eq]: reconSubject!.id
                                        }
                                    },
                                    ...(reconSubject?.session && reconSubject?.session.id && { session_id: reconSubject?.session.id })
                                },
                                transaction: transaction
                            })

                            // If no screenshotAfterwards subject exists, create a new one
                            if (!screenshotAfter) {
                                await Subject.create({
                                    type: SubjectType.SCREENSHOT,
                                    start_url: reconSubject!.start_url,
                                    status: SubjectStatus.UNVISITED,
                                    additional_information: {
                                        type: "screenshotAfterwards",
                                        page_type: "landing_page",
                                        related_subject: reconSubject!.id
                                    },
                                    url_id: reconSubject!.url_id!,
                                    domain_id: reconSubject!.domain_id,
                                    worker: reconSubject!.worker,
                                    session_id: reconSubject!.session?.id
                                }), {
                                    transaction: transaction
                                };
                                return;
                            }

                            // Check if login pages of session should also be screenshotted
                            if (config.sessions.includeLoginpages) {
                                // If yes, check whether formurl is set in session information
                                if (reconSubject!.session && reconSubject!.additional_information.formurl) {
                                    // Check whether screenshotting subject for loginform afterwards already exists
                                    const screenshotFormAfter = await Subject.findOne({
                                        where: {
                                            start_url: reconSubject!.additional_information.formurl,
                                            type: SubjectType.SCREENSHOT,
                                            additional_information: {
                                                type: {
                                                    [Op.eq]: "screenshotAfterwards"
                                                },
                                                page_type: {
                                                    [Op.eq]: "loginform"
                                                },
                                                related_subject: {
                                                    [Op.eq]: reconSubject!.id
                                                }
                                            },
                                            ...(reconSubject?.session && reconSubject?.session.id && { session_id: reconSubject?.session.id })
                                        },
                                        transaction: transaction
                                    })

                                    // If no subject for screenshotting afterwards exists, create a new one
                                    if (!screenshotFormAfter) {
                                        await Subject.create({
                                            type: SubjectType.SCREENSHOT,
                                            start_url: reconSubject!.additional_information.formurl,
                                            status: SubjectStatus.UNVISITED,
                                            additional_information: {
                                                type: "screenshotAfterwards",
                                                page_type: "loginform",
                                                related_subject: reconSubject!.id
                                            },
                                            url_id: reconSubject!.url_id!,
                                            domain_id: reconSubject!.domain_id,
                                            worker: reconSubject!.worker,
                                            session_id: reconSubject!.session?.id
                                        }, {
                                            transaction: transaction
                                        });
                                        return;
                                    }
                                }
                            }
                        }
                    }

                }

                // Schedule screenshots after finisheing that url, if configuration forces it
                await scheduleScreenshotAfterwards(urlId)
                // Check whether parent URL is done, meaning all children of parent url are done
                let url = await Url.findOne({ where: { id: urlId }, transaction: transaction })

                // Traverse each url in url tree and check whether their parent_id is set
                while (url?.parent_id) {
                    // Check whether there are INACTIVE or PROCESSING child urls
                    const incompleteChildUrls = await Url.count({
                        where: {
                            parent_id: url?.parent_id,
                            [Op.or]: [
                                {
                                    crawling_status: CrawlingStatus.INACTIVE
                                },
                                {
                                    crawling_status: CrawlingStatus.PROCESSING
                                }
                            ],
                        },
                        transaction: transaction
                    })
                    // If there are none, schedule screenshot afterwards if depth check allows for it, otherwise mark as COMPLETE
                    if (incompleteChildUrls === 0) {
                        if (url.depth! - 1 <= config.sessions.screenshotMaxDepth) {
                            // Potentially schedule a screenshotting tasks of parent id after checking depth
                            await scheduleScreenshotAfterwards(url?.parent_id);
                        } else {
                            // Mark url as complete as no screenshotting will happen
                            await Url.update({
                                crawling_status: CrawlingStatus.COMPLETE,
                                visitation_end: finishTime
                            }, {
                                where: {
                                    id: url?.parent_id
                                },
                                transaction: transaction
                            })
                        }
                    }
                    // Set url to parent url
                    url = await Url.findOne({ where: { id: url?.parent_id }, include: [Domain], transaction: transaction })
                }

            }

            // Fetch original url again and attach domain that url belongs to
            const url = await Url.findOne({
                where: {
                    id: urlId
                },
                transaction: transaction,
                include: [Domain]
            })

            // Check if all subjects of the attached domain are done
            const unfinishedSubjectsOfDomain = await Subject.count({
                where: {
                    domain_id: url?.domain.id,
                    [Op.or]: [
                        {
                            status: SubjectStatus.PROCESSING
                        },
                        {
                            status: SubjectStatus.UNVISITED
                        }
                    ]
                },
                transaction: transaction
            })

            // If there are no open subjects for that domain, set visitation_end of domain
            if (unfinishedSubjectsOfDomain === 0) {
                await Domain.update({
                    visitation_end: finishTime
                }, {
                    where: {
                        id: url?.domain.id
                    },
                    transaction: transaction
                })
            }
        }
    }

    /**
     * Get next entry for crawler to work on from database. Respect already set url id, domain id, session id, to ideally stay on same url/same domain work and by default always stay in same session.
     * If there are no subjects for an url left, go to work on subjects for the belonging domain and if there are no more for domain move on to new domain and different session. The invocation code
     * is at main.ts / passing through the respective arguments to the taskqeue.ts to here.
     * 
     * Skips locked rows and locks the fetched rows so other crawlers do not work in parallel on the same subjects. 
     * Invariant: 
     * - Searches in ascending creation date and start url to always work on oldest subjects first.
     * - Tries to always look for work which was attached to its crawler id, so crawler continue doing their scheduled tasks
     * 
     * After retrieving entries from database, it repacks them for the crawler and updates all entries so they belong to the crawler. Additionally, it is checked
     * whether the timeout limits are hit (e.g. per session, all subjects have to be worked on during session expiration limit from the account framework, so 24 hours). 
     * This interval is configured in the config.ts. Also applies to session-less subjects and then on domain entry creation time.
     * 
     * @param workerId Worker id to fetch work for
     * @param urlId UrlId the worker might already be working on
     * @param domainId DomainId the worker might be already working on 
     * @param sessionId 
     * @returns 
     */
    static async next(workerId: number, urlId?: number, domainId?: number, sessionId?: number): Promise<ResponseSubject[]> {
        Logging.info(`(next) Fetching new work from database for worker with id="${workerId}"`)
        const nextSubjects: ResponseSubject[] = []
        // Always just fetch the next subject to ensure distribution of context/context less tasks
        const limit = 1;
        const t = await sequelize.transaction();
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const order: any = [
                ["start_url", "ASC"],
                ["created_at", "ASC"]
            ]
            // Find all recon subjects for the set parameters and order by ascending creation date
            let reconSubjects = await Subject.findAll({
                where: {
                    status: SubjectStatus.UNVISITED,
                    ...(urlId && { url_id: urlId }),
                    ...(sessionId && { session_id: sessionId }),
                    ...(!sessionId && { session_id: null }),
                    worker: workerId
                },
                limit: limit,
                ...(urlId && {
                    order: [
                        ["created_at", "ASC"]
                    ],
                }),
                ...(!urlId && {
                    order: order,
                }),
                lock: true,
                transaction: t,
                skipLocked: true,
            });
            // Check, if there were no recon subjects found, but urlId and domainId set
            if (reconSubjects.length === 0 && urlId && domainId) {
                // Fetch attached url database entry to current urlId
                const url = await Url.findOne({
                    where: { id: urlId },
                    transaction: t
                })
                // Now fetch again, but not limited to url but to its parent (stay on same depth, but different url)
                reconSubjects = await Subject.findAll({
                    where: {
                        status: SubjectStatus.UNVISITED,
                        domain_id: domainId,
                        ...(sessionId && { session_id: sessionId }),
                        ...(!sessionId && { session_id: null }),
                        worker: workerId,
                        '$url.depth$': { [Op.eq]: url?.depth }
                    },
                    limit: limit,
                    ...(urlId && {
                        order: [
                            ["created_at", "ASC"]
                        ],
                    }),
                    ...(!urlId && {
                        order: order,
                    }),
                    lock: true,
                    transaction: t,
                    skipLocked: true,
                    include: [Url]
                });
                if (reconSubjects.length === 0) {
                    // Fetch again, but not limited to url but to its domain and greater depth
                    reconSubjects = await Subject.findAll({
                        where: {
                            status: SubjectStatus.UNVISITED,
                            domain_id: domainId,
                            ...(sessionId && { session_id: sessionId }),
                            ...(!sessionId && { session_id: null }),
                            worker: workerId,
                            '$url.depth$': { [Op.gt]: url?.depth },
                        },
                        limit: limit,
                        ...(urlId && {
                            order: [
                                ["created_at", "ASC"]
                            ],
                        }),
                        ...(!urlId && {
                            order: order,
                        }),
                        lock: true,
                        transaction: t,
                        skipLocked: true,
                        include: [Url]
                    });
                    // If still no subjects were found, but url and domain were set, now continue with any different url of given domainId
                    if (reconSubjects.length === 0) {
                        // Fetch again, but not limited to url but to its domain and not limited depth
                        reconSubjects = await Subject.findAll({
                            where: {
                                status: SubjectStatus.UNVISITED,
                                domain_id: domainId,
                                ...(sessionId && { session_id: sessionId }),
                                ...(!sessionId && { session_id: null }),
                                worker: workerId,
                            },
                            limit: limit,
                            ...(urlId && {
                                order: [
                                    ["created_at", "ASC"]
                                ],
                            }),
                            ...(!urlId && {
                                order: order,
                            }),
                            lock: true,
                            transaction: t,
                            skipLocked: true,
                        });
                    }
                }
            }
            // Check, if there were no recon subjects found and urlId is not set but domainId is
            if (reconSubjects.length === 0 && !urlId && domainId) {
                // Fetch again, but not limited to url but to its domain and not limited depth (any same domain subjects)
                reconSubjects = await Subject.findAll({
                    where: {
                        status: SubjectStatus.UNVISITED,
                        ...(sessionId && { session_id: sessionId }),
                        ...(!sessionId && { session_id: null }),
                        worker: workerId,
                        domain_id: domainId
                    },
                    limit: limit,
                    ...(urlId && {
                        order: [
                            ["created_at", "ASC"]
                        ],
                    }),
                    ...(!urlId && {
                        order: order,
                    }),
                    lock: true,
                    transaction: t,
                    skipLocked: true,
                });
            }

            // Check if there were still no found subjects
            if (reconSubjects.length === 0) {
                // Fetch again, but not limited to single worker and without limitation to url/domain
                reconSubjects = await Subject.findAll({
                    where: {
                        status: SubjectStatus.UNVISITED,
                        worker: null
                    },
                    limit: limit,
                    ...(urlId && {
                        order: [
                            ["created_at", "ASC"]
                        ],
                    }),
                    ...(!urlId && {
                        order: order,
                    }),
                    lock: true,
                    transaction: t,
                    skipLocked: true,
                });
            }
            const skippedSubjects: number[] = [];
            // For each subject that will be listed as crawl, repack and set to PROCESSING
            for (let j = 0; j < reconSubjects.length; j++) {
                const reconSubject = reconSubjects[j]
                // Hotfix: Check if screenshotting is enabled before and next subject is a recon subject without urlId, domainId set in the crawler (first visitation), then skip that
                if (config.sessions.screenshotBefore && !urlId && !domainId && reconSubject.type === SubjectType.RECONNAISSANCE) {
                    Logging.error(`Skipped recon subject as first one before enabled screenshotting. id=${reconSubject.id}`)
                    continue;
                }
                // Check if number of nextSubjects is below limit
                if (nextSubjects.length < limit) {
                    // If yes, fetch url 
                    const url = await Url.findOne({
                        where: {
                            id: reconSubject.url_id
                        },
                        lock: true,
                        transaction: t,
                        skipLocked: true
                    })
                    // Check if url is not existing/rather not found due to being locked
                    if (!url) {
                        Logging.info("Skipped subject due to URL being locked by other crawler.")
                        continue;
                    }

                    // Check if url is not existing/rather not found due to being locked
                    const domain = await Domain.findOne({
                        where: {
                            id: reconSubject.domain_id
                        },
                    })

                    if (!domain) {
                        Logging.info("Skipped subject due to no domain being fetched as well.");
                        continue;
                    }
                    // Repack crawl subject
                    const nextToVisit: ResponseSubject = {
                        id: reconSubject.id,
                        url: reconSubject.start_url,
                        url_id: reconSubject.url_id,
                        domain_id: domain.id,
                        type: reconSubject.type,
                        timestamp: reconSubject.createdAt,
                        additional_information: reconSubject.additional_information,
                        depth: url!.depth,
                    }

                    // Get the current time
                    const currentTime = new Date();

                    if (reconSubject.session_id) {
                        const session = await Session.findOne({
                            where: {
                                id: reconSubject.session_id
                            },
                            lock: true,
                            transaction: t,
                            skipLocked: true
                        })
                        nextToVisit.session = session!

                        if (session) {
                            // Check if session was already unlocked, if so unlock all subjects belonging to the the session which were not already worked on/finished
                            if (session.session_status === SessionStatus.UNLOCKED) {
                                const changedSubjects = await Subject.update({
                                    status: SubjectStatus.SKIP,
                                    additional_information: {
                                        message: "Skipping subject with unlocked session.",
                                        time: currentTime
                                    }
                                }, {
                                    where: {
                                        status: SubjectStatus.UNVISITED,
                                        worker: workerId,
                                        session_id: session.id
                                    },
                                    returning: true,
                                    transaction: t
                                })
                                // Push url of the subject to list of skipped ones
                                skippedSubjects.push(reconSubject.url_id)
                                // For all subjects which were changed during update, traverse them and also push url id into array of skipped list
                                for (let index = 0; index < changedSubjects[1].length; index++) {
                                    const element = changedSubjects[1][index];
                                    if (!skippedSubjects.includes(element.url_id)) {
                                        skippedSubjects.push(element.url_id)
                                    }
                                }
                                continue;
                            }
                            // If session is older than a day minus the screenshot treshhold at the end (too old to be worked on), mark the subject as SKIP and do not process
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            if (moment(currentTime).diff((session as any).created_at, 'seconds') >= ((config.maxTime.session - (config.sessions.screenshotAfterwards ? config.screenshotEndTreshold : 0)) / 1000)) {
                                if (reconSubject.type !== SubjectType.SCREENSHOT && reconSubject.additional_information.type !== "screeenshotAfterwards") {
                                    // Mark all other unvisited subjects belonging to session as SKIP as well
                                    const changedSubjects = await Subject.update({
                                        status: SubjectStatus.SKIP,
                                        additional_information: {
                                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                            message: `Skipping subject (non-screenshotting with screenshotting afterwards enabled) with session older than maximum session visitation time. (${moment(currentTime).diff((session as any).created_at, 'seconds')}s  >= ${((config.maxTime.session - (config.sessions.screenshotAfterwards ? config.screenshotEndTreshold : 0)) / 1000)})s`,
                                            time: currentTime
                                        }
                                    }, {
                                        where: {
                                            status: SubjectStatus.UNVISITED,
                                            worker: workerId,
                                            session_id: session.id,
                                            type: {
                                                [Op.ne]: SubjectType.SCREENSHOT
                                            }
                                        },
                                        returning: true,
                                        transaction: t
                                    })
                                    // For all subjects which were changed during update, traverse them and also push each url id into array of skipped list
                                    for (let index = 0; index < changedSubjects[1].length; index++) {
                                        const element = changedSubjects[1][index];
                                        if (!skippedSubjects.includes(element.url_id)) {
                                            skippedSubjects.push(element.url_id)
                                        }
                                    }
                                    continue;
                                }
                            }
                            // If session is older than a day, mark the subject as SKIP and do not process (e.g. this is the case if no screenshot is enabled for afterwards, so only session expiration time)
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            if (moment(currentTime).diff((session as any).created_at, 'seconds') >= ((config.maxTime.session) / 1000)) {
                                // Mark all other unvisited subjects belonging to session as SKIP as well
                                const changedSubjects = await Subject.update({
                                    status: SubjectStatus.SKIP,
                                    additional_information: {
                                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                        message: `Skipping subject with session older than overall session visitation time. (${moment(currentTime).diff((session as any).created_at, 'seconds')}s >= ${((config.maxTime.session) / 1000)}s)`,
                                        time: currentTime
                                    }
                                }, {
                                    where: {
                                        status: SubjectStatus.UNVISITED,
                                        worker: workerId,
                                        session_id: session.id
                                    },
                                    returning: true,
                                    transaction: t
                                })
                                // For all subjects which were changed during update, traverse them and also push each url id into array of skipped list
                                for (let index = 0; index < changedSubjects[1].length; index++) {
                                    const element = changedSubjects[1][index];
                                    if (!skippedSubjects.includes(element.url_id)) {
                                        skippedSubjects.push(element.url_id)
                                    }
                                }
                                continue;
                            }

                        }
                    }
                    if (domain) {
                        // Similarly to sessions, if maxTime per domain (configuration) is exceeded, also remaining subjects are marked as to be skipped

                        // Check if visitation_begin is set, if not set to current time
                        if (!domain.visitation_begin) {
                            await Domain.update(
                                {
                                    visitation_begin: currentTime
                                },
                                {
                                    where: {
                                        id: domain.id,
                                    },
                                    transaction: t
                                },
                            );
                        } else {
                            // Otherwise, site was already visited and then check whether maxTime per domain minus the screenshot treshhold at the end (with screenshotting afterwards enabled) was exceeded, if so skip
                            if (moment(currentTime).diff(domain.visitation_begin, 'seconds') >= ((config.maxTime.domain - (config.sessions.screenshotAfterwards ? config.screenshotEndTreshold : 0)) / 1000)) {
                                if (reconSubject.type !== SubjectType.SCREENSHOT && reconSubject.additional_information.type !== "screeenshotAfterwards") {
                                    // Mark all other unvisited subjects belonging to session as SKIP as well
                                    const changedSubjects = await Subject.update({
                                        status: SubjectStatus.SKIP,
                                        additional_information: {
                                            message: `Skipping subject (non-screenshotting with screenshotting afterwards enabled) with session older than maximum domain visitation time. (${moment(currentTime).diff(domain.visitation_begin, 'seconds')}s  >= ${((config.maxTime.domain - (config.sessions.screenshotAfterwards ? config.screenshotEndTreshold : 0)) / 1000)})s`,
                                            time: currentTime
                                        }
                                    }, {
                                        where: {
                                            worker: workerId,
                                            status: SubjectStatus.UNVISITED,
                                            domain_id: domain.id,
                                            type: {
                                                [Op.ne]: SubjectType.SCREENSHOT
                                            }
                                        },
                                        returning: true,
                                        transaction: t
                                    })
                                    // For all subjects which were changed during update, traverse them and also push each url id into array of skipped list
                                    for (let index = 0; index < changedSubjects[1].length; index++) {
                                        const element = changedSubjects[1][index];
                                        if (!skippedSubjects.includes(element.url_id)) {
                                            skippedSubjects.push(element.url_id)
                                        }
                                    }
                                    continue;
                                }
                            }
                            // If screenshotting afterwards is not enabled, just check the maxTime per domain and if that is exceeded, mark subjects to be skipped
                            if (moment(currentTime).diff(domain.visitation_begin, 'seconds') >= ((config.maxTime.domain) / 1000)) {
                                // Mark all other unvisited subjects belonging to session as SKIP as well
                                const changedSubjects = await Subject.update({
                                    status: SubjectStatus.SKIP,
                                    additional_information: {
                                        message: `Skipping subject with session older than overall session visitation time. (${moment(currentTime).diff(domain.visitation_begin, 'seconds')}s >= ${((config.maxTime.domain) / 1000)}s)`,
                                        time: currentTime
                                    }
                                }, {
                                    where: {
                                        worker: workerId,
                                        status: SubjectStatus.UNVISITED,
                                        domain_id: domain.id
                                    },
                                    returning: true,
                                    transaction: t
                                })
                                // For all subjects which were changed during update, traverse them and also push each url id into array of skipped list
                                for (let index = 0; index < changedSubjects[1].length; index++) {
                                    const element = changedSubjects[1][index];
                                    if (!skippedSubjects.includes(element.url_id)) {
                                        skippedSubjects.push(element.url_id)
                                    }
                                }
                                continue;
                            }
                        }
                    }

                    // Update subject status to processing for next subject
                    await Subject.update(
                        {
                            status: SubjectStatus.PROCESSING,
                            worker: workerId
                        },
                        {
                            where: {
                                id: reconSubject.id,
                            },
                            transaction: t
                        },
                    );
                    // Assign workerId to all urls of subject which will be visited by that worker
                    await Subject.update({
                        worker: workerId,
                    }, {
                        where: {
                            url_id: nextToVisit.url_id
                        },
                        transaction: t
                    })
                    // Assign workerId to all subject entries for the current domain
                    await Subject.update({
                        worker: workerId,
                    }, {
                        where: {
                            domain_id: nextToVisit.domain_id
                        },
                        transaction: t
                    })
                    // Set URL status to PROCESSING
                    await Url.update({
                        crawling_status: CrawlingStatus.PROCESSING,
                        visitation_begin: new Date()
                    }, {
                        where: {
                            id: reconSubject.url_id,
                            crawling_status: CrawlingStatus.INACTIVE,
                            visitation_begin: null
                        },
                        transaction: t
                    })
                    // Enqueue crawl subject
                    nextSubjects.push(nextToVisit)
                }
            }

            // Commit transaction to the database
            await t.commit();

            // For all urls[discrepancy skippedSubjects vs. skippedUrls in naming, here urls are meant] which were skipped (e.g. due to session expiration) call url finish callback
            for (let index = 0; index < skippedSubjects.length; index++) {
                const element = skippedSubjects[index];
                await DatabaseHelper.onUrlFinish(element, undefined);
            }

            // If there was no more work fetched, show warning
            if (nextSubjects.length == 0) {
                Logging.warn(`Worker ${workerId} is requesting subjects via /next but none exist. Terminating worker.`)
            }

            return nextSubjects;
        } catch (err: unknown) {
            // If any error happened during execution, rollback transaction and show notice
            Logging.error(`(next) Failed to query next subjects. Error: ${(err as Error).toString()}`)
            await t.rollback();
        }

        // By default, return empty array (no work was fetched)
        return [];
    }
}

export default DatabaseHelper;