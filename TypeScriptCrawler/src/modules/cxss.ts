import path from "path";
import { QueryTypes } from "sequelize";
import config from "../config";
import { sequelize } from "../database/db";
import { prepareFinding, sinkToId } from "../snippets/cxss/prepare-finding";
import { Module } from "../types/module";
import { flowcollect } from "../snippets/cxss/flowcollect";
import { Logging } from "../utils/logging";
import { Subject, SubjectType } from "../database/models/subject";
import { run_script } from "../utils/run-script";
import { getRandomInt } from "../utils/random-numbers";
import * as fs from "fs";
import { storeGzipped } from "../utils/store-file";
import { benchmark } from "../utils/benchmark";
const crypto = require("crypto");

// Time after which the exploit generator is killed for a finding
const RUN_SCRIPT_DELAY = 5000;

enum ExploitType {
    PCXSS = "PCXSS",
    RCXSS = "RCXSS"
}

/**
 * Convert exploitability of finding to integer value to store in database
 */
const exploitabilityToId = (exploitable: boolean) => {
    if (exploitable) {
        return 1;
    }
    return 2;
}

class CXSS extends Module {
    name: string = "cxss";
    reportId: number = -1;
    requests: any[] = [];
    frames: any[] = [];
    findings: any = [];

    exploitLog: string[] = [];

    /**
     * Clean database tables (drop them)
     */
    clean = async () => {
        await sequelize.query("DROP TABLE cxss_report CASCADE");
        await sequelize.query("DROP TABLE cxss_frame CASCADE");
        await sequelize.query("DROP TABLE cxss_finding CASCADE");
        await sequelize.query("DROP TABLE cxss_exploit CASCADE");
    }

    /**
     * Create necessary database tables and setup indexes on certain fields for querying/analysis performance
     */
    setup = async () => {
        if (config.mode === "connected") {
            await sequelize.query("CREATE TABLE cxss_report (report_id SERIAL PRIMARY KEY, subject_id INTEGER REFERENCES subjects(id), created_at TIMESTAMP, updated_at TIMESTAMP, session_id INTEGER REFERENCES sessions(id))")

            // Frame information
            await sequelize.query("CREATE TABLE cxss_frame (frame_id SERIAL PRIMARY KEY, report_id INTEGER REFERENCES cxss_report(report_id), frame_src TEXT, end_url TEXT, client_frame_id TEXT, title TEXT, is_main_frame BOOLEAN, created_at TIMESTAMP, updated_at TIMESTAMP)")

            // Taint flows
            await sequelize.query("CREATE TABLE cxss_finding (finding_id SERIAL PRIMARY KEY, frame_id INTEGER REFERENCES cxss_frame(frame_id), url TEXT, sink TEXT, value TEXT, sources JSON, d1 TEXT, d2 TEXT, d3 TEXT, storage JSON, trace TEXT, exploitability INTEGER, created_at TIMESTAMP, updated_at TIMESTAMP)")
            await sequelize.query("CREATE INDEX cxss_finding_exploitability ON cxss_finding(exploitability)")
            await sequelize.query("CREATE INDEX cxss_finding_sink ON cxss_finding(sink)")

            // Exploits
            await sequelize.query("CREATE TABLE cxss_exploit (exploit_id SERIAL PRIMARY KEY, finding_id INTEGER REFERENCES cxss_finding(finding_id), type TEXT, status INTEGER, exploit_data JSON, session_id INTEGER REFERENCES sessions(id), created_at TIMESTAMP, updated_at TIMESTAMP)");
            await sequelize.query("CREATE INDEX cxss_exploit_status ON cxss_exploit(status)")
            await sequelize.query("CREATE INDEX cxss_exploit_type ON cxss_exploit(type)")

            // Requests
            await sequelize.query("CREATE TABLE cxss_request (request_id SERIAL PRIMARY KEY, report_id INTEGER REFERENCES cxss_report(report_id), client_frame_id TEXT, method TEXT, url TEXT, is_navigation_request BOOLEAN, resource_type TEXT, is_from_main_frame BOOLEAN, created_at TIMESTAMP, updated_at TIMESTAMP)");
            await sequelize.query("CREATE INDEX cxss_request_method ON cxss_request(method)")

            await sequelize.query("CREATE INDEX cxss_request_is_navigation_request ON cxss_request(is_navigation_request)")

            await sequelize.query("CREATE TABLE cxss_request_headers (header_id SERIAL PRIMARY KEY, request_id INTEGER REFERENCES cxss_request(request_id), name TEXT, value TEXT, created_at TIMESTAMP, updated_at TIMESTAMP)")
            await sequelize.query("CREATE INDEX cxss_request_headers_name ON cxss_request_headers(name)")


            // Responses
            await sequelize.query("CREATE TABLE cxss_response (response_id SERIAL PRIMARY KEY, report_id INTEGER REFERENCES cxss_report(report_id), client_frame_id TEXT, start_url TEXT, end_url TEXT, status_code INTEGER, status_line TEXT, sizes JSON, timing JSON, hash TEXT, resource_type TEXT, is_from_main_frame BOOLEAN, created_at TIMESTAMP, updated_at TIMESTAMP)");
            await sequelize.query("CREATE TABLE cxss_response_headers (header_id SERIAL PRIMARY KEY, response_id INTEGER REFERENCES cxss_response(response_id), name TEXT, value TEXT, created_at TIMESTAMP, updated_at TIMESTAMP)")
            await sequelize.query("CREATE INDEX cxss_response_headers_name ON cxss_response_headers(name)")
        }
    }

    /**
     * Report a collected request to the database / log output otherwise
     * 
     * @param reportId Report to attach requests to
     * @param clientFrameId Client side frame id from playwright (guid)
     * @param method Method of request
     * @param url Url of request
     * @param isNavigationRequest Whether request was a navigation request
     * @param resourceType Type of requested resource
     * @param isFromMainFrame Flag, whether frame originated from main frame
     * @returns Id of request entry (random if not stored)
     */
    reportRequest = async (reportId: number, clientFrameId: string, method: string, url: string, isNavigationRequest: boolean, resourceType: string, isFromMainFrame: boolean) => {
        if (config.mode === "connected") {
            // In connected mode, write to database
            let res = await sequelize.query('INSERT INTO cxss_request (report_id, client_frame_id, method, url, is_navigation_request, resource_type, is_from_main_frame, created_at, updated_at) VALUES (:reportId, :clientFrameId, :method, :url, :isNavigationRequest, :resourceType, :isFromMainFrame, :createdAt, :updatedAt) RETURNING request_id', {
                replacements: {
                    reportId,
                    clientFrameId,
                    method,
                    url,
                    isNavigationRequest,
                    resourceType,
                    isFromMainFrame,
                    createdAt: new Date(),
                    updatedAt: new Date()
                },
                type: QueryTypes.INSERT
            });
            if (res.length) {
                return ((res[0] as any)[0] as any).request_id
            }
        } else {
            // Otherwise, generate stub id and output to console
            let request_id = getRandomInt(Number.MAX_SAFE_INTEGER)
            Logging.debug(`[cxss] Request report id="${request_id}" clientFrameId="${clientFrameId}" url="${url}" method="${method}" isNavigationRequest="${isNavigationRequest ? "true" : "false"}"`)
            return request_id;
        }
    }

    /**
     * Store a header belonging to a request in database / log output otherwise
     * 
     * @param requestId Id header belongs to
     * @param name Name of the header
     * @param value Value of the header
     * @returns Id of header entry (random if not stored)
     */
    reportRequestHeader = async (requestId: number, name: string, value: string) => {
        if (config.mode === "connected") {
            // In connected mode, write to database
            let res = await sequelize.query('INSERT INTO cxss_request_headers (request_id, name, value, created_at, updated_at) VALUES (:requestId, :name, :value, :createdAt, :updatedAt) RETURNING header_id', {
                replacements: {
                    requestId,
                    name,
                    value,
                    createdAt: new Date(),
                    updatedAt: new Date()
                },
                type: QueryTypes.INSERT
            });
            if (res.length) {
                return ((res[0] as any)[0] as any).header_id
            }
        } else {
            // Otherwise, generate stub id and output to console
            Logging.debug(`[cxss] Request header for request with id="${requestId}" report name="${name}" value="${value}"`)
            return getRandomInt(Number.MAX_SAFE_INTEGER);
        }
    }

    /**
     * Report a collected response and store in database / log to output
     * 
     * @param reportId Id of cxss report
     * @param clientFrameId Client side frame id (guid)
     * @param startUrl Start url of request that lead to response
     * @param endUrl Final url where response was gotten from
     * @param statusCode Status code of response
     * @param statusLine Status line of response
     * @param sizes Response sizes attributes (performance data)
     * @param timing Timing information about response/request
     * @param hash Hash of response content
     * @param resourceType Type of resource that was returned
     * @param isFromMainFrame Flag, whether response originated from main frame
     * @returns Id of stored response (random if not stored)
     */
    reportResponse = async (reportId: number, clientFrameId: string, startUrl: string, endUrl: string, statusCode: number, statusLine: string, sizes: any, timing: any, hash: string, resourceType: string, isFromMainFrame: boolean) => {
        if (config.mode === "connected") {
            // In connected mode, write to database
            let res = await sequelize.query('INSERT INTO cxss_response (report_id, client_frame_id, start_url, end_url, status_code, status_line, sizes, timing, hash, resource_type, is_from_main_frame, created_at, updated_at) VALUES (:reportId, :clientFrameId, :startUrl, :endUrl, :statusCode, :statusLine, :sizes, :timing, :hash, :resourceType, :isFromMainFrame, :createdAt, :updatedAt) RETURNING response_id', {
                replacements: {
                    reportId,
                    clientFrameId,
                    startUrl,
                    endUrl,
                    statusCode,
                    statusLine,
                    sizes: JSON.stringify(sizes),
                    timing: JSON.stringify(timing),
                    hash,
                    resourceType,
                    isFromMainFrame,
                    createdAt: new Date(),
                    updatedAt: new Date()
                },
                type: QueryTypes.INSERT
            });
            if (res.length) {
                return ((res[0] as any)[0] as any).response_id
            }
        } else {
            // Otherwise, generate stub id and output to console
            return getRandomInt(Number.MAX_SAFE_INTEGER);
        }
    }

    /**
     * Report header belonging to a collected response to database / log to output
     * 
     * @param responseId Id of response header belongs to
     * @param name Name of header
     * @param value Value of header
     * @returns Id of header entry (in database / random if not stored)
     */
    reportResponseHeader = async (responseId: number, name: string, value: string) => {
        if (config.mode === "connected") {
            // In connected mode, write to database
            let res = await sequelize.query('INSERT INTO cxss_response_headers (response_id, name, value, created_at, updated_at) VALUES (:responseId, :name, :value, :createdAt, :updatedAt) RETURNING header_id', {
                replacements: {
                    responseId,
                    name,
                    value,
                    createdAt: new Date(),
                    updatedAt: new Date()
                },
                type: QueryTypes.INSERT
            });
            if (res.length) {
                return ((res[0] as any)[0] as any).header_id
            }
        } else {
            // Otherwise, generate stub id and output to console
            Logging.debug(`[cxss] request header for request with id="${responseId}" report name="${name}" value="${value}"`)
            return getRandomInt(Number.MAX_SAFE_INTEGER);
        }
    }

    /**
     * 
     * @param reportId Id of report frame belongs to
     * @param frameSrc Source URL of frame
     * @param endUrl Final URL of frame
     * @param clientFrameId Client-side id of frame (guid from playwright)
     * @param title Title of frame
     * @param isMainFrame Flag, whether it is a main frame
     * @param transaction Transaction to append writes to
     * @returns 
     */
    reportFrame = async (reportId: number, frameSrc: string, endUrl: string, clientFrameId: string, title: string, isMainFrame: boolean, transaction: any) => {
        if (config.mode === "connected") {
            // In connected mode, write to database
            try {
                let res = await sequelize.query('INSERT INTO cxss_frame (report_id, frame_src, end_url, client_frame_id, title, is_main_frame, created_at, updated_at) VALUES (:reportId, :frameSrc, :endUrl, :clientFrameId, :title, :isMainFrame, :createdAt, :updatedAt) RETURNING frame_id', {
                    replacements: {
                        reportId,
                        frameSrc,
                        endUrl,
                        clientFrameId,
                        title,
                        isMainFrame,
                        createdAt: new Date(),
                        updatedAt: new Date()
                    },
                    transaction: transaction,
                    type: QueryTypes.INSERT
                });
                if (res.length) {
                    return ((res[0] as any)[0] as any).frame_id
                }
            } catch (err: any) {
                Logging.error(`Writing to database in (reportFrame) failed. Error: ${err.toString()}`);
            }
        } else {
            // Otherwise, generate stub id and output to console
            Logging.debug(`[cxss] frame report frameSrc="${frameSrc}" endUrl="${endUrl}" clientFrameId="${clientFrameId}" title="${title}"`)
            return getRandomInt(Number.MAX_SAFE_INTEGER);
        }
    }

    /**
     * Report found taint flow in database / log to output
     * 
     * @param frameId Id of frame flow belongs to
     * @param url Url of flow
     * @param sink Sink of flow
     * @param value Value that results from flow
     * @param sources Sources of the flow
     * @param d1 Ignored in analysis
     * @param d2 Ignored in analysis
     * @param d3 Location of script leading to slow
     * @param storage Storage content on registration of flow
     * @param trace Trace of invocation that lead to flow
     * @param taintReport Report from taintflow containing all taint information
     * @param exploitability Exploitability of the flow
     * @param transaction Transaction to attach writes to
     * @returns Id of finding in database (random id if not written to db)
     */
    reportFinding = async (frameId: number, url: string, sink: string, value: string, sources: any, d1: string, d2: string, d3: string, storage: any, trace: string, taintReport: any, exploitability: number, transaction: any) => {
        if (config.mode === "connected") {
            // In connected mode, write to database
            try {
                let res = await sequelize.query('INSERT INTO cxss_finding (frame_id, url, sink, value, sources, d1, d2, d3, storage, trace, exploitability, created_at, updated_at) VALUES (:frameId, :url, :sink, :value, :sources, :d1, :d2, :d3, :storage, :trace, :exploitability, :createdAt, :updatedAt) RETURNING finding_id', {
                    replacements: {
                        frameId,
                        url,
                        sink,
                        value,
                        sources: JSON.stringify(sources),
                        d1,
                        d2,
                        d3,
                        storage: JSON.stringify(storage),
                        trace: JSON.stringify(trace),
                        exploitability,
                        createdAt: new Date(),
                        updatedAt: new Date()
                    },
                    transaction: transaction,
                    type: QueryTypes.INSERT
                });

                if (res.length) {
                    const findingId = ((res[0] as any)[0] as any).finding_id
                    return findingId;
                }
            } catch (err: any) {
                Logging.error(`Writing to database in (reportFinding) failed. Error: ${err.toString()}, frameId=${frameId}`);
            }
        } else {
            // Otherwise, generate stub id and output to console
            Logging.debug(`[cxss] finding in frameId="${frameId} url="${url} sink="${sink}"`)
            return getRandomInt(Number.MAX_SAFE_INTEGER);
        }
    }

    /**
     * Report generated exploit in database / log to output
     * 
     * @param findingId Id of finding exploit belongs to
     * @param status Exploitability status of exploit (to be updated on verification)
     * @param type Type of exploit (reflected, RCXSS versus persistent (PCXSS))
     * @param exploitData Exploit information from generator
     * @param createdAt Created at date
     * @param transaction Transaction to attach writes to
     * @param sessionId Id of session if any exists (if found exploit during crawl with session)
     * @returns 
     */
    reportExploit = async (findingId: number, status: number, type: string, exploitData: any, createdAt: Date, transaction: any, sessionId?: number) => {
        if (config.mode === "connected") {
            // In connected mode, write to database
            try {
                if (sessionId) {
                    let res = await sequelize.query('INSERT INTO cxss_exploit (finding_id, status, type, exploit_data, session_id, created_at, updated_at) VALUES (:findingId, :status, :type, :exploitData, :sessionId, :createdAt, :updatedAt) RETURNING exploit_id', {
                        replacements: {
                            findingId,
                            status,
                            type,
                            exploitData: JSON.stringify(exploitData),
                            sessionId,
                            createdAt: createdAt,
                            updatedAt: createdAt
                        },
                        transaction: transaction,
                        type: QueryTypes.INSERT
                    });
                    if (res.length) {
                        return ((res[0] as any)[0] as any).exploit_id
                    }
                } else {
                    let res = await sequelize.query('INSERT INTO cxss_exploit (finding_id, status, type, exploit_data, created_at, updated_at) VALUES (:findingId, :status, :type, :exploitData, :createdAt, :updatedAt) RETURNING exploit_id', {
                        replacements: {
                            findingId,
                            status,
                            type,
                            exploitData: JSON.stringify(exploitData),
                            createdAt: createdAt,
                            updatedAt: createdAt
                        },
                        transaction: transaction,
                        type: QueryTypes.INSERT
                    });
                    if (res.length) {
                        return ((res[0] as any)[0] as any).exploit_id
                    }

                }
            } catch (err: any) {
                Logging.error(`Writing to database in (reportExploit) failed. Error: ${err.toString()}`);
            }
        } else {
            // Otherwise, generate stub id and output to console
            let exploit_id = getRandomInt(Number.MAX_SAFE_INTEGER);
            Logging.debug(`[cxss] exploit_id="${exploit_id}" findingId="${findingId} status="${status} type="${type}" exploitData="${JSON.stringify(exploitData)}"`)
            return exploit_id;
        }
    }

    /**
     * Creates empty report object all other db entries are attached to 
     * 
     * @param subjectId Id of subject reports to
     * @param sessionId Id of session if crawl happened with session
     * @returns Id of report
     */
    createReport = async (subjectId: any, sessionId?: number) => {
        if (config.mode === "connected") {
            // In connected mode, write to database
            try {
                if (sessionId) {
                    let res = await sequelize.query('INSERT INTO cxss_report (subject_id, session_id, created_at, updated_at) VALUES (:subjectId, :sessionId, :createdAt, :updatedAt) RETURNING report_id', {
                        replacements: {
                            subjectId: subjectId,
                            sessionId: sessionId,
                            createdAt: new Date(),
                            updatedAt: new Date()
                        },
                        type: QueryTypes.INSERT
                    })
                    if (res.length) {
                        return ((res[0] as any)[0] as any).report_id
                    }
                } else {
                    let res = await sequelize.query('INSERT INTO cxss_report (subject_id, created_at, updated_at) VALUES (:subjectId, :createdAt, :updatedAt) RETURNING report_id', {
                        replacements: {
                            subjectId: subjectId,
                            createdAt: new Date(),
                            updatedAt: new Date()
                        },
                        type: QueryTypes.INSERT
                    })
                    if (res.length) {
                        return ((res[0] as any)[0] as any).report_id
                    }
                }
            } catch (err: any) {
                Logging.error(`Writing to database in (createReport) failed. Error: ${err.toString()}`);
            }
        } else {
            // Otherwise, generate stub id and output to console
            return getRandomInt(Number.MAX_SAFE_INTEGER)
        }
    }

    /**
     * Add necessary hooks for cxss collection from current task
     * 
     * @param page Page object from playwright which will be visited
     */
    before = async (page: any) => {
        // Check if RECONNAISSANCE task (collection of flows)
        if (this.task?.type === "RECONNAISSANCE") {
            // Create empty report for current task
            this.reportId = await this.createReport(this.task.id, this.task.session?.id);
            // Add init script (for hooking taint report event in foxhound)
            await page.addInitScript({ path: path.join(".", "snippets", "cxss", "init.js") });
            // Empty result object for task
            this.task!.result = {
                subjectId: "",
                frames: this.frames,
                url: this.task.url,
                html: "",
            }
            // Leave empty for main frame.
            this.frames[0] = {}

            // Hook console output to listen to output of registered taintflows (prefixed with CXSS)
            page.on('console', (msg: any) => {
                var text = msg.text();
                if (text.startsWith("[CXSS]")) {
                    var output = text.replace("[CXSS]", "");
                    // Attempt to parse json flow data
                    try {
                        Logging.debug(`[cxss] Parsing report from init script containing json representation of taint flow`)
                        var flow = JSON.parse(output);

                        var finding = flowcollect(flow);
                        // If flow could successfully be transformed in flow object (flowcollect), store in findings array
                        if (finding) {
                            finding.taintReportJson = JSON.parse(output);
                            this.findings.push(finding);
                        }
                    } catch (err: any) {
                        Logging.error(`[cxss] Failed to parse flow taint json in report id="${this.reportId}". Flow: ${output}`)
                    }
                }
            });

            // Listen to frame navigations and update end url of frames accordingly
            page.on('framenavigated', async (framedata: any) => {
                // Update frame navigation data
                var id = framedata._guid;
                for (let index = 0; index < this.frames.length; index++) {
                    let element = this.frames[index];
                    if (element.frameId === id) {
                        element.endUrl = framedata.url();
                    }
                }
            });

            // Listen to frame attach events and collect frame information on attach
            page.on('frameattached', async (framedata: any) => {
                let title: string = "";
                try {
                    title = await framedata.title();
                } catch (err: any) {
                    title = "";
                }
                var frame: any = {
                    frameSrc: framedata.url(),
                    endUrl: framedata.url(),
                    frameId: framedata._guid,
                    parentFrameId: framedata.parentFrame() ? framedata.parentFrame()._guid : "",
                    title: title,
                    requests: [],
                    findings: [],
                    main: false,
                    storage: []
                }
                this.frames.push(frame);
            });

            // Console error on failed request
            page.on('requestfailed', (request: any) => {
                Logging.debug(`[cxss] Request to ${request.url()} has failed. Got requestfailed event.`)
            });

            let mainFrame = page.mainFrame()

            // Listen to requests
            page.on('request', async (requestdata: any) => {
                let resourceType = await requestdata.resourceType();
                // Only collect document/script requests
                if (resourceType !== "document" && resourceType !== "script") {
                    return;
                }
                // Report request to database with client side frame id (guid)
                try {
                    let frame = requestdata.frame();

                    let requestId = await this.reportRequest(
                        this.reportId,
                        frame._guid,
                        requestdata.method(),
                        requestdata.url(),
                        requestdata.isNavigationRequest(),
                        resourceType,
                        frame === mainFrame
                    )

                    // For all headers of request, log each to database as well
                    let requestHeaders = await requestdata.headersArray();
                    for (let index = 0; index < requestHeaders.length; index++) {
                        const element = requestHeaders[index];

                        await this.reportRequestHeader(
                            requestId,
                            element.name,
                            element.value
                        )
                    }
                } catch (err: any) {
                    Logging.error(`[cxss] Error occured during request collection of url ${requestdata.url()} of report id="${this.reportId}". Error: ${err.toString()}`)
                }
            })

            // Listen to all responses
            page.on('response', async (responsedata: any) => {
                let resourceType = await responsedata.request().resourceType();
                // Only collect document/script responses
                if (resourceType !== "document" && resourceType !== "script") {
                    return;
                }
                // Report response to database with client side frame id (guid)
                try {
                    let frame = responsedata.frame();
                    let status_code = await responsedata.status();

                    // Attempt to collect response body if if was not a 3xx response code
                    let body;
                    try {
                        if (status_code >= 300 && status_code <= 399) {
                            Logging.debug(`[cxss] Ignoring request body from response that was from redirect (empty) of frame id="${frame._guid}" and url="${responsedata.url()}"`)
                            body = "";
                        } else {
                            body = await responsedata.body();
                        }
                    } catch (err: any) {
                        body = "";
                    }

                    // Hash the request body
                    let responseBodyHash = crypto.createHash('md5').update(body).digest('hex');

                    let responseId = await this.reportResponse(
                        this.reportId,
                        frame._guid,
                        responsedata.request().url(),
                        responsedata.url(),
                        responsedata.status(),
                        responsedata.statusText(),
                        await responsedata.request().sizes(),
                        responsedata.request().timing(),
                        responseBodyHash,
                        resourceType,
                        frame === mainFrame
                    )

                    // Collect all headers belonging to response in database
                    let responseHeaders = await responsedata.headersArray();
                    for (let index = 0; index < responseHeaders.length; index++) {
                        const element = responseHeaders[index];

                        await this.reportResponseHeader(
                            responseId,
                            element.name,
                            element.value
                        )
                    }

                    // If crawling with database connection, also store gzipped response body content on disk (in dataPath/responses)
                    if (config.mode === "connected") {
                        const bodyPath = path.join(config.dataPath, "responses", responseBodyHash[0], responseBodyHash[1]);

                        // Check if parent directory for hashed response exists
                        if (!fs.existsSync(bodyPath)) {
                            fs.mkdirSync(bodyPath, { recursive: true })
                        }

                        // Check if hashed response was already stored
                        if (!fs.existsSync(path.join(bodyPath, `${responseBodyHash}`))) {
                            // If it doesn't exist, store the response gzipped at hash location
                            await storeGzipped(body.toString(), path.join(bodyPath, `${responseBodyHash}`))
                        }

                    }
                } catch (err: any) {
                    Logging.error(`[cxss] Error occured during request collection of url ${responsedata.url()} of report id="${this.reportId}". Error: ${err.toString()}`)
                }
            })

            // Check if VERIFICATION task (exploit verification)
        } else if (this.task?.type === SubjectType.CXSS_VERFICATION) {
            // Add verification script (payload script that should be executed)
            await page.addInitScript({ path: path.join(".", "snippets", "cxss", "verify.js") }); // NOTE: If you change the invoked payload function, change the called function in verify.js as well

            let { finding_id, exploit_id, type } = this.task.taskData;

            // Get exploit data for relevant exploit
            let exploit_data = await sequelize.query("SELECT exploit_data FROM cxss_exploit WHERE exploit_id = :exploitId", {
                replacements: {
                    exploitId: exploit_id
                }
            })
            // Store exploit data in current task
            this.task.taskData = {
                ...this.task.taskData,
                ...((exploit_data[0] as any)[0] as any).exploit_data
            }

            // Set success flag in task element to false
            this.task!.result = {
                success: false
            }

            // Listen to console outputs (prefix [CXSSVerify] output on successful payload invocation)
            page.on('console', (msg: any) => {
                var text = msg.text();
                if (text.startsWith("[CXSSVerify]")) {
                    this.task!.result = {
                        success: true
                    }
                }
                if (this.task?.type === SubjectType.CXSS_VERFICATION) {
                    this.exploitLog.push(text);
                }
            });
        }
    };

    /**
     * Runs after page was visited and loading timed out
     * @param page Page to run execute on
     */
    execute = async (page: any) => {
        // Check whether it is a RECONNAISSANCE task
        if (this.task?.type === SubjectType.RECONNAISSANCE) {
            const t = await sequelize.transaction();

            // Collect main frame information
            try {
                let mainFrame = page.mainFrame();

                let title = "";

                try {
                    title = await mainFrame.title()
                } catch (err: any) {
                    Logging.error(`[cxss] Failed to retrieve frame title for frame clientframeId="${mainFrame._guid}" on url="${mainFrame.url()}"`)
                }

                this.frames[0] = {
                    frameSrc: mainFrame.url(),
                    endUrl: mainFrame.url(),
                    frameId: mainFrame._guid,
                    parentFrameId: mainFrame.parentFrame() ? mainFrame.parentFrame()._guid : "",
                    title: title,
                    findings: [],
                    requests: [],
                    main: true,
                    storage: []
                }

                var frameMap: any = {};

                // Iterate through all found flows
                for (let index = 0; index < this.findings.length; index++) {
                    const element = this.findings[index];
                    let url = element.url; // URL where flow was found

                    // Iterate over all frames
                    for (let j = 0; j < this.frames.length; j++) {
                        const frame = this.frames[j];
                        // If frame is not collected in frameMap(client side ID to database ID), collect in database and store its ID mapping
                        if (!Object.keys(frameMap).includes(frame.frameId)) {
                            let frameDatabaseId = await this.reportFrame(this.reportId, frame.frameSrc, frame.endUrl, frame.frameId, frame.title, frame.main, t);
                            frameMap[frame.frameId] = frameDatabaseId;
                        }
                        // Check whether frame url matches url of flow & only for main frames
                        if (url == frame.endUrl && frame.main) {
                            // If so, report flow to database and prepare for consumption by exploit generator
                            let findingId = await this.reportFinding(frameMap[frame.frameId], element.url, element.sink, element.value, element.sources, element.d1, element.d2, element.d3, element.storage, element.trace, element.taintReportJson, 0, t);
                            const preparedFinding = prepareFinding(findingId, sinkToId(element.sink), element.sources, url, element.storage, element.value, element.d1, element.d2, element.d3);

                            if (preparedFinding.sink_id === -1) {
                                // Unsupported sink functions are skipped, determined in sinkToId
                                continue;
                            }

                            // Configure path for exploit generator output (create if not exists, relative to crawler dataPath)
                            const generatorOutPath = path.join(config.dataPath, "exploit-generator", String(this.reportId), String(frameMap[frame.frameId]), String(findingId));
                            if (!fs.existsSync(generatorOutPath)) {
                                fs.mkdirSync(generatorOutPath, { recursive: true });
                            }
                            // Configure path for input file for exploit generator (store on disk to not have issues during passing arguments via CLI)
                            const inputFileLocation = path.join(generatorOutPath, "input.json");
                            fs.writeFileSync(inputFileLocation, JSON.stringify(preparedFinding), { encoding: "utf-8" })


                            // Start exploit generator & enqueue work
                            const command = 'python2.7';
                            const args = [
                                path.join(".", "snippets", "cxss", "persistent-clientside-xss", "src", 'main_filearg.py'),
                                `--finding`, inputFileLocation,
                                `--payload`, `DOMXSSVerify()`, // NOTE: If you change the invoked payload function, change this
                            ];

                            let task = this.task;

                            // Benchmark exploit generator execution
                            Logging.debug(`[cxss] Starting the exploit generator for finding id="${findingId}"`)
                            const b = benchmark(`[cxss] Starting the exploit generator for finding id="${findingId}"`)
                            await run_script(command, args, async (stdout: any, stderr: any, code: any) => {
                                b.stop()
                                // After running the generator successfully, iterate through output (stdout)
                                const out = String(stdout).split("\n");
                                Logging.debug(`[cxss] Exploit generator for id="${findingId}" terminated successfully. Continuing to parse result and process.`)
                                for (let index = 0; index < out.length; index++) {
                                    const element = out[index];
                                    // Check if line of output prefixed with [result], e.g. exploit data output
                                    if (element.startsWith("[result]")) {
                                        let result = element.replace("[result]", "");
                                        try {
                                            const exploits: any[] = JSON.parse(result)
                                            // Store up to 100 generated exploits at most per finding
                                            const exploitMaxCount = Math.min(100, exploits.length);

                                            if (exploits.length > 100) {
                                                Logging.info(`[cxss] Reducing maximum amount of generated exploits to 100 for finding ${findingId}`)
                                            }

                                            let cxssCounter = 0;
                                            // Store results in database (iterate thorugh generated exploits)
                                            for (let i = 0; i < exploitMaxCount; i++) {
                                                const exploit = exploits[i]
                                                const type = exploit.type;
                                                // Check if its a reflected exploit
                                                if (type === ExploitType.RCXSS) {
                                                    const { exploit_url, finding_source_id } = exploit;

                                                    for (let j = 0; j < Math.min(100, exploit_url.length); j++) {
                                                        if (cxssCounter === 100) {
                                                            // Stop exploit collection if more than 100 generated
                                                            return;
                                                        }
                                                        const url = exploit_url[j]

                                                        const exploitData = {
                                                            exploit_url: url,
                                                            finding_source_id,
                                                        };

                                                        // Report exploit in database
                                                        Logging.debug(`[cxss] Reporting new exploit of finding id="${findingId}" of type="${ExploitType.RCXSS}" with exploitData="${JSON.stringify(exploitData)}"`)
                                                        let exploitId = await this.reportExploit(findingId, 0, ExploitType.RCXSS, exploitData, new Date(), t, task.session?.id);

                                                        // Create verification subject for found exploit
                                                        await Subject.create({
                                                            type: SubjectType.CXSS_VERFICATION,
                                                            url_id: task.url_id,
                                                            domain_id: task.domain_id,
                                                            start_url: url,
                                                            additional_information: {
                                                                taskData: {
                                                                    type: ExploitType.RCXSS,
                                                                    exploit_id: exploitId,
                                                                    finding_id: findingId,
                                                                },
                                                            },
                                                            worker: this.crawler?.id,
                                                            ...(task.session && { session_id: task.session.id })
                                                        }, {
                                                            transaction: t
                                                        })
                                                    }
                                                }
                                                // Check if it is a persistent exploit
                                                if (type === ExploitType.PCXSS) {
                                                    if (cxssCounter === 100) {
                                                        // Stop exploit collection if more than 100 generated
                                                        return;
                                                    }
                                                    const { finding_source_id, replace_with, storage_key, storage_type, replace_value, storage_value } = exploit;

                                                    const exploitData = {
                                                        replace_with,
                                                        storage_key,
                                                        storage_type,
                                                        replace_value,
                                                        storage_value,
                                                        finding_source_id
                                                    };

                                                    // Report exploit in database
                                                    Logging.debug(`[cxss] Reporting new exploit of finding id="${findingId}" of type="${ExploitType.PCXSS}" with exploitData="${JSON.stringify(exploitData)}"`)
                                                    let exploitId = await this.reportExploit(findingId, 0, ExploitType.PCXSS, exploitData, new Date(), t, task.session?.id);

                                                    // Create verification subject for found exploit
                                                    await Subject.create({
                                                        type: SubjectType.CXSS_VERFICATION,
                                                        url_id: task.url_id,
                                                        domain_id: task.domain_id,
                                                        start_url: url,
                                                        additional_information: {
                                                            taskData: {
                                                                type: ExploitType.PCXSS,
                                                                exploit_id: exploitId,
                                                                finding_id: findingId,
                                                            },
                                                        },
                                                        worker: this.crawler?.id,
                                                        ...(task.session && { session_id: task.session.id })
                                                    }, {
                                                        transaction: t
                                                    })
                                                }
                                            }
                                            // Enqueue work in job queue
                                        } catch (err: any) {
                                            Logging.error(`[cxss] Parsing result from exploit generator failed for finding ${findingId}. Error: ${err.toString()}. Program output: ${stdout ? String(stdout).substring(0, 1000) : ""}`)
                                        }
                                    }
                                }

                                if (config.mode === "connected") {
                                    // Store exploit generator output in datapath
                                    fs.writeFileSync(path.join(generatorOutPath, `output.txt`), stdout, { encoding: "utf-8" })
                                }
                                // Remove input file for generator afterwards
                                fs.rmSync(inputFileLocation);
                            },
                                RUN_SCRIPT_DELAY,
                                (code: any) => {
                                    // If exploit generator timed out, it is killed and output is stored in error.txt
                                    Logging.error(`[cxss] Killed exploit generation process with code=${code} due to time for finding ${findingId}.`);
                                    const errorOutputFileLocation = path.join(generatorOutPath, "error.txt");
                                    fs.writeFileSync(errorOutputFileLocation, JSON.stringify(code), { encoding: "utf-8" })
                                    // Remove input file for generator afterwards
                                    fs.rmSync(inputFileLocation);
                                },
                                (err: any) => {
                                    // On any other error, output to log
                                    Logging.error(`[cxss] Exploit generator failed for finding id="${findingId}. Error: ${err.toString()}`);
                                    // Remove input file for generator afterwards
                                    fs.rmSync(inputFileLocation);
                                }
                            )
                            frame.findings.push(element);
                        }
                    }
                }

                await t.commit();
            } catch (err: any) {
                Logging.error(`[cxss] Error occured during reconnaissance phase of subject. Rolling back transaction. Error: ${err.toString()}`)
                await t.rollback();
            }
        } else {
            // Check if task is of verification
            if (this.task?.type === SubjectType.CXSS_VERFICATION) {
                // Time out value to wait after storage modification
                const CXSS_PAGELOAD_VERIFICATION_WAIT_TIMEOUT = 3000;
                // Check if exploit is persistent (storage is involved)
                if (this.task?.taskData.type === "PCXSS") {
                    var exploitData = this.task!.taskData;

                    var storage_type = exploitData.storage_type;
                    var storage_key = exploitData.storage_key;
                    var replace_value = exploitData.replace_value;
                    var replace_with = exploitData.replace_with;

                    // Check if storage is localStorage
                    if (storage_type == "localStorage.getItem") {
                        Logging.debug(`[cxss] Setting exploit id="${this.task.id}" verification data from "localStorage.getItem" exploit.`)
                        const pageLocalStorage = await page.evaluate(() => Object.assign({}, window.localStorage));
                        const preservedLocalStorageValue = pageLocalStorage[storage_key];

                        // Modify relevant localStorage entry to replace_with value from generator
                        await page.evaluate(`window.localStorage.setItem('${storage_key}', atob('${btoa(replace_with)}'))`)

                        // Reload site
                        await page.evaluate(() => window.location.reload())

                        // Wait for loading to finish
                        await page.waitForLoadState();
                        await page.waitForTimeout(CXSS_PAGELOAD_VERIFICATION_WAIT_TIMEOUT);

                        // Restore previous localstorage state
                        await page.evaluate(`window.localStorage.setItem('${storage_key}', atob('${btoa(preservedLocalStorageValue)}'))`)
                    }


                    // Check if storage is sessionStorage
                    if (storage_type == "sessionStorage.getItem") {
                        Logging.debug(`[cxss] Setting exploit id="${this.task.id}" verification data from "sessionStorage.getItem" exploit.`)
                        const pageSessionStorage = await page.evaluate(() => Object.assign({}, window.sessionStorage));
                        const preservedSessionStorageValue = pageSessionStorage[storage_key];

                        // Modify relevant sessionStorage entry to replace_with value from generator
                        await page.evaluate(`window.sessionStorage.setItem('${storage_key}', atob('${btoa(replace_with)}'))`)

                        // Reload site
                        await page.evaluate(() => window.location.reload())

                        // Wait for loading to finish
                        await page.waitForLoadState();
                        await page.waitForTimeout(CXSS_PAGELOAD_VERIFICATION_WAIT_TIMEOUT);

                        // Restore previous sessionstorage state
                        await page.evaluate(`window.sessionStorage.setItem('${storage_key}', atob('${btoa(preservedSessionStorageValue)}'))`)
                    }


                    // Check if storage is cookie
                    if (storage_type === "document.cookie") {
                        Logging.debug(`[cxss] Setting exploit id="${this.task.id}" verification data from "document.cookie" exploit.`)
                        let context = await page.context();
                        // Retrieve cookies from page
                        let allCookies = await context.cookies();
                        // Empty current cookie value
                        await context.clearCookies();

                        // Create copy of cookies
                        let modifiedCookies = structuredClone(allCookies);
                        // Modify cookie copy according to exploit generator info (replace relevant storage key/value)
                        for (let index = 0; index < modifiedCookies.length; index++) {
                            const element = modifiedCookies[index];
                            if (element.name === storage_key) {
                                element.value = replace_with;
                            }
                        }
                        // Add cookies to page
                        context.addCookies(modifiedCookies);

                        // Reload site
                        await page.evaluate(() => window.location.reload())

                        // Wait for loading to finish
                        await page.waitForLoadState();
                        await page.waitForTimeout(CXSS_PAGELOAD_VERIFICATION_WAIT_TIMEOUT);

                        // Restore previous cookies again afterwards
                        await context.clearCookies();
                        context.addCookies(allCookies);
                    }
                }
            }


        }
    };

    /**
     * After finishing page, run finish method to report when cxss_report was finished (updatedAt date) or 
     * exploit verification results
     * @param page Page to run finish in
     */
    finish = async (page: any) => {
        if (this.task?.type === SubjectType.RECONNAISSANCE) {
            // On RECONNAISSANCE task, report finish of recon
            this.reportReconFinish(this.task?.id)
        } else if (this.task?.type === SubjectType.CXSS_VERFICATION) {
            // On CXSS_VERFICATION task, report exploit verification data
            this.reportExploitVerification(this.task?.taskData.exploit_id, this.task!.result.success, this.exploitLog)
        }
    };

    /**
     * Report that recon of subject was finished
     * @param subjectId Current subject
     */
    async reportReconFinish(subjectId: number) {
        if (config.mode === "connected") {
            // Write to database the update query
            Logging.debug(`[cxss] Finishing cxss report for subject id="${subjectId}". Updating row updated_at value`)
            await sequelize.query('UPDATE cxss_report SET updated_at = :updatedAt WHERE report_id = :reportId', {
                replacements: {
                    reportId: this.reportId,
                    updatedAt: new Date()
                },
                type: QueryTypes.UPDATE
            })
        } else {
            // If not connected to database, only write to log
            Logging.debug(`[cxss] Finished report ${this.reportId} for subject ${subjectId}.`)
        }
    }

    /**
     * Report exploit verification results to database / log to output
     * @param exploitId Exploit id which was verified
     * @param success Whether exploit was successfully executed
     * @param console Console output during verification of browser
     */
    async reportExploitVerification(exploitId: number, success: boolean, console: string[]) {
        if (config.mode === "connected") {
            Logging.debug(`[cxss] Verification of exploit ${exploitId} finished status="${success ? "executed" : "failed"}. Updating cxss_exploit entry."`)
            await sequelize.query('UPDATE cxss_exploit SET status = :status, updated_at = :updatedAt WHERE exploit_id = :exploitId', {
                replacements: {
                    exploitId,
                    status: exploitabilityToId(success),
                    updatedAt: new Date()
                },
                type: QueryTypes.UPDATE
            })

            // Store console output for exploit on disk
            const generatorOutPath = path.join(config.dataPath, "exploit-console", String(exploitId));
            if (!fs.existsSync(generatorOutPath)) {
                fs.mkdirSync(generatorOutPath, { recursive: true });
            }
            fs.writeFileSync(path.join(generatorOutPath, `console.txt`), console.join("\n"), { encoding: "utf-8" })

            // If finding has not been found vulnerable yet, update related finding accordingly
            Logging.debug(`[cxss] Updating finding (id="${this.task!.taskData.finding_id}") status vulnerability if it has not been found vulnerable yet to ${exploitabilityToId(true)}`)
            await sequelize.query(`UPDATE cxss_finding SET exploitability = :exploitability WHERE cxss_finding.finding_id = :findingId AND exploitability <> ${exploitabilityToId(true)}`, {
                replacements: {
                    exploitability: exploitabilityToId(success),
                    findingId: this.task!.taskData.finding_id
                },
                type: QueryTypes.UPDATE
            })
        } else {
            Logging.debug(`[cxss] Verification of exploit ${exploitId} finished status="${success ? "executed" : "failed"}"`)
        }
    }
}

export default CXSS;