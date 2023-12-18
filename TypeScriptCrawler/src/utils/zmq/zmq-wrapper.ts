import path from "path";
import { sequelize } from "../../database/db";
import { Session, SessionStatus } from "../../database/models/session";
import { readCsv } from "../csv";
import { Logging } from "../logging";
import * as zmq from "zeromq";

const ZMQ_HOST = process.env.ZMQ_HOST ? process.env.ZMQ_HOST : "tcp://127.0.0.1:5555";
const ZMQ_EXPERIMENT = process.env.ZMQ_EXPERIMENT ? process.env.ZMQ_EXPERIMENT : "cxss";

class ZMQWrapper {
    sock?: zmq.Request;
    sessionCount: number = 0;

    state: "session_request" | "session_unlock" | "none" = "none";
    unlockedSessionId: number = -1;

    /**
     * Initialize new ZMQ connection to ZMQ_HOST
     */
    async init() {
        this.sock = new zmq.Request();
        this.sock.connect(ZMQ_HOST)
        Logging.info("Initialized ZMQ Session")
    }

    /**
     * Request a session from the account network, sends the session_request or get_specific_session via ZMQ to the 
     * configured account framework endpoint.
     * 
     * @param site Optional site to request session for (if set, request type changes to get_specific_session)
     * @returns 
     */
    async getSession(site?: string) {
        if (!this.sock) {
            Logging.error(`ZMQ-Socket not initialized during call to get a new session.`)
            process.exit(-1);
        }
        const request = {
            "type": site ? "get_specific_session" : "get_session",
            "experiment": ZMQ_EXPERIMENT,
            ...(site && { site })
        }
        this.state = "session_request";
        Logging.info("Requesting ZMQ session")
        // Request the session via ZMQ
        await this.sock.send(JSON.stringify(request))
        // Parse the result
        const [result] = await this.sock.receive()
        const parsedResult = JSON.parse(result.toString());
        // Inspect success flag of response
        if (parsedResult.success) {
            // If success flag is set, it means we got a session and then we store it in the database
            const t = await sequelize.transaction();
            try {
                // Create session in databse if it does not exist
                const { session, session_data } = parsedResult;
                const { id } = session;

                // Check if session already exists
                let sessionInDb = await Session.findOne({
                    where: {
                        id: id
                    }, transaction: t
                })
                if (sessionInDb) {
                    // If it does exist, unlock? the existing session again
                    await Session.update({
                        session_status: SessionStatus.ACTIVE
                    }, {
                        where: {
                            id: id
                        },
                        transaction: t
                    })
                    Logging.warn("Setting an existing session to ACTIVE again due to okay from zmq connection.")
                } else {
                    // Create if it does not exist
                    sessionInDb = await Session.create({
                        id: id,
                        session_information: session,
                        session_data: session_data,
                        session_status: SessionStatus.ACTIVE
                    }, { transaction: t })
                }

                await t.commit();
                return sessionInDb;

            } catch (err: unknown) {
                Logging.error(`Failed to enter new session due to error. Error: ${(err as Error).toString()}`)
                await t.rollback();
            }
        } else {
            // If success was false, return/do nothing and output log message
            Logging.error(`Session request did not yield new session. success=false`)
        }
    }

    /**
     * Perform an unlock request on the ZMQ connection given the argument id, so it is marked as unused
     * by the current running experiment and can be redistributed. Also, the crawler does now ignore the 
     * session for in the future.
     * 
     * @param id session_id of Session to unlock
     */
    async unlockSession(id: number) {
        if (!this.sock) {
            Logging.error(`ZMQ-Socket not initialized during call to unlock`)
            process.exit(-1);
        }
        const request = {
            "type": "unlock_session",
            "experiment": ZMQ_EXPERIMENT,
            "session_id": id
        }

        this.state = "session_unlock";
        this.unlockedSessionId = id;

        await this.sock.send(JSON.stringify(request));
        const [result] = await this.sock.receive();
        const parsedResult = JSON.parse(result.toString());

        if (parsedResult.success) {
            Logging.info(`Unlocking session successful.`)
            if (this.unlockedSessionId !== -1) {
                await Session.update({
                    session_status: SessionStatus.UNLOCKED,
                    additional_information: {
                        message: "Successfully unlocked from zmq connection (success=true)."
                    }
                }, {
                    where: {
                        id: this.unlockedSessionId
                    }
                })
            }
        } else {
            Logging.info(`Unlocking session failed.`)
        }
    }
}

/**
 * Helper class for testing ZMQ without actual ZMQ connection 
 */
class ZMQWrapperTest {
    records: string[] = [];
    sessionCount: number = 0;

    /**
     * Initializing the wrapper: Read list of domains from location on disk (relative to project) 
     * and store in records. No real ZMQ connection is opened
     */
    async init() {
        Logging.info(`Initialized zmq wrapper.`)
        this.records = [
            "https://www.google.com", "https://www.youtube.com", "https://www.facebook.com", "https://twitter.com/", "https://www.wikipedia.org", "https://www.reddit.com/"
        ];
    }
    /**
     * Retrieve session. If site is set, just return the site wrapped in https://, otherwise, request a site 
     * from the stored records array
     * @param site 
     * @returns 
     */
    async getSession(site?: string) {
        const website = site ? site : this.records[this.sessionCount % this.records.length];

        // Create the session in database with empty storage data
        const sessionInDb = await Session.create({
            session_information: {
                account: {
                    website: {
                        landing_page: website,
                        site: "",
                        origin: ""
                    }
                }
            },
            session_data: {
                cookies: [],
                origins: []
            },
            session_status: SessionStatus.ACTIVE
        });

        Logging.info(`Created new session for landing page ${`https://${website}`}.`)
        return sessionInDb
    }

    /**
     * Mark session in database as unlocked locally to ignore it for further crawling.
     * 
     * @param id session_id to unlock
     */
    async unlockSession(id: number) {
        Logging.info(`Unlocking session with id="${id}".`)
        await Session.update({
            session_status: SessionStatus.UNLOCKED,
            additional_information: {
                message: "Successfully unlocked from zmq stub."
            }
        }, {
            where: {
                id: id
            }
        })
    }
}

export { ZMQWrapper, ZMQWrapperTest };