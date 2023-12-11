import { sequelize } from "../database/db";
import * as fs from "fs";
import path from "path";
import { Module } from "../types/module";
import { Logging } from "../utils/logging";
import config from "../config";
import { QueryTypes } from "sequelize";

const exec = require('child_process').exec;
const md5 = require('md5');
const domlog_names = ['__crawly__', '___domlog___', '__domlog__'];

const TEST_TIMEOUT = 1000 * 60 * 2;
const SAT_TIMEOUT = 1000 * 30;
const MAX_HANDLERS = 1000;
let CUR_HANDLER = 0;

class PMSecurity extends Module {
    name: string = "pmsecurity";
    CDPsession?: any;

    handlerIdToResolve = new Map();
    handlerPromises: any[] = [];
    confirmedExploits = new Map();
    exploitCandidates = new Map();
    funs: string[] = [];
    reports: any[] = [];

    /**
     * Setup database tables for pmsecurity / indexes for performance
     */
    setup = async () => {
        let client = sequelize;
        await client.query('CREATE TABLE handler (handler_id SERIAL PRIMARY KEY, host VARCHAR(100), site VARCHAR(80), url TEXT, handler_hash CHAR(64), subject_id INTEGER REFERENCES subjects(id))');
        await client.query('CREATE UNIQUE INDEX handler_host ON handler(host, handler_hash)');
        await client.query('CREATE INDEX handler_site ON handler(site)');
        await client.query('CREATE INDEX handler_hash ON handler(handler_hash)');

        await client.query('CREATE TABLE external_func (handler_id INTEGER REFERENCES handler(handler_id), func_hash CHAR(64))');
        await client.query('CREATE UNIQUE INDEX external_func_uniq ON external_func(handler_id, func_hash)');

        await client.query('CREATE TABLE base_constraints (constraint_id SERIAL PRIMARY KEY, handler_id INTEGER REFERENCES handler(handler_id), constraints JSONB)');
        await client.query('CREATE INDEX constraint_handler_id ON base_constraints(handler_id)');

        await client.query('CREATE TABLE exploit_candidates (exploit_id SERIAL PRIMARY KEY, constraint_id INTEGER REFERENCES base_constraints(constraint_id), exploit_constraints JSONB, types JSONB, success SMALLINT, sink VARCHAR(20), addInfo TEXT)');
        await client.query('CREATE INDEX exploit_candidates_constraint ON exploit_candidates(constraint_id)');
        await client.query('CREATE INDEX exploit_candidates_sink ON exploit_candidates(sink)');
        await client.query('CREATE INDEX exploit_candidates_success ON exploit_candidates(success)');

        await client.query('CREATE TABLE flow_flagged_for_manual (manual_flow_id SERIAL PRIMARY KEY, constraint_id INTEGER REFERENCES base_constraints(constraint_id), exploit_constraints JSONB, sink VARCHAR(20))');
        await client.query('CREATE INDEX manual_flow_constraint ON flow_flagged_for_manual(constraint_id)');
        await client.query('CREATE INDEX manual_flow_sinks ON flow_flagged_for_manual(sink)');

        await client.query('CREATE TABLE report (report_id SERIAL PRIMARY KEY, exploit_id INTEGER REFERENCES exploit_candidates(exploit_id), message JSONB, addInfo JSONB);');
        await client.query('CREATE INDEX report_exploit ON report(exploit_id)');
    }

    /**
     * Clean database tables (drop them)
     */
    clean = async () => {
        let client = sequelize;

        await client.query('DROP TABLE handler CASCADE');
        await client.query('DROP TABLE external_func CASCADE');
        await client.query('DROP TABLE base_constraints CASCADE');
        await client.query('DROP TABLE exploit_candidates CASCADE');
        await client.query('DROP TABLE report CASCADE');
        await client.query('DROP TABLE flow_flagged_for_manual CASCADE');
    }

    /**
     * Report constraint information in database / log to output
     * 
     * @param constraints Constraints to report
     * @param handlerId Id of handler constraints belong to
     * @returns Id of constraint entry in db / random id if no database connection
     */
    reportBaseConstraint = async (constraints: any, handlerId: any) => {
        if (config.mode === "connected") {
            // In connected mode, write to database
            try {
                Logging.debug(`Inserting new base_constraint with constraints: "${JSON.stringify(constraints)}" and handlerId: "${handlerId}"`)
                let res = await sequelize.query('INSERT INTO base_constraints (constraints, handler_id) VALUES (:constraints,:handlerId) RETURNING constraint_id', {
                    replacements: {
                        constraints: JSON.stringify(constraints),
                        handlerId: handlerId
                    },
                    type: QueryTypes.INSERT
                })
                if (res.length) {
                    return ((res[0] as any)[0] as any).constraint_id
                } else {
                    Logging.info("constraints: " + JSON.stringify(constraints) + " handlerId: " + handlerId)
                }
            } catch (err: any) {
                Logging.error(`Writing to database in reportBaseConstraint failed. Error: ${err.toString()}`);
            }
        }
        // Otherwise, generate stub id and output to console
        return 'constraint_' + randomString();
    }

    /**
     * Report constraint satisfiability information to database (run on results from exploit generator)
     * 
     * @param constraintId Constraint satisfiability data was generated
     * @param constraints Constraints
     * @param expConstraints Exploit constraints
     * @param types Types
     * @param success Whether exploit generator finished successfully  
     * @param addInfo Additional information of exploit candidate
     * @param sink Sink of exploit candidate
     * @returns Id of constraint satisfiability data
     */
    reportConstraintSatisfiability = async (constraintId: any, constraints: any, expConstraints: any, types: any, success: any, addInfo = "", sink: any) => {
        if (config.mode === "connected") {
            // In connected mode, write to database
            try {
                // Additional debug information output
                Logging.debug(`(reportConstraintSatisfiability) Inserting new exploit_candidates with constraints: ${JSON.stringify(constraints)}`)
                Logging.debug(`(reportConstraintSatisfiability) Inserting new exploit_candidates with constraints: ${JSON.stringify(expConstraints)}`)
                Logging.debug(`(reportConstraintSatisfiability) Inserting new exploit_candidates with types: ${JSON.stringify(types)}`)
                Logging.debug(`(reportConstraintSatisfiability) Inserting new exploit_candidates with success: ${success}`)
                Logging.debug(`(reportConstraintSatisfiability) Inserting new exploit_candidates with addInfo: ${JSON.stringify(addInfo)}`)
                Logging.debug(`(reportConstraintSatisfiability) Inserting new exploit_candidates with sink: ${sink}`)

                // Store exploit_candidates in database
                let res = await sequelize.query('INSERT INTO exploit_candidates (exploit_constraints, success, addInfo,constraint_id, sink, types) VALUES (:expConstraints,:success,:addInfo,:constraintId, :sink,:types) RETURNING exploit_id', {
                    replacements: {
                        constraintId: constraintId,
                        expConstraints: JSON.stringify(expConstraints),
                        types: JSON.stringify(types),
                        success: success,
                        sink: sink,
                        addInfo: JSON.stringify(addInfo),
                    },
                    type: QueryTypes.INSERT
                });
                return ((res[0] as any)[0] as any).exploit_id;
            } catch (err: any) {
                Logging.error(`Writing to database in reportConstraintSatisfiability failed. Error: ${err.toString()}`);
            }
        } else {
            Logging.info('reportConstraintSatisfiability (): ' + JSON.stringify(constraints));
            Logging.info('reportConstraintSatisfiability (): ' + JSON.stringify(expConstraints));
        }
        // Otherwise, generate stub id and output to console
        return 'exploit_' + randomString();
    }

    /**
     * Report collected external function in database
     * 
     * @param funString Function string (code of function)
     * @param handlerId Id of handler function belongs to
     * @returns undefined
     */
    reportExternalFun = async (funString: string, handlerId: any) => {
        if (config.mode === "connected") {
            try {
                Logging.debug(`Inserting new external_func with funHash="${md5(funString)}"`)
                await sequelize.query('INSERT INTO external_func (handler_id,func_hash) VALUES (:handlerId,:funHash)', {
                    replacements: {
                        handlerId: handlerId,
                        funHash: md5(funString)
                    },
                    type: QueryTypes.INSERT
                });
                this.funs.push(funString);
            } catch (err: any) {
                Logging.error(`Writing to database in reportExternalFun failed. Error: ${err.toString()}`);
            }
        }
        return undefined;
    }

    /**
     * Manual exploitation data to check on from pmforce
     * 
     * @param report Report from pmforce
     * @param handlerId Id of handler report belongs to
     * @returns undefined
     */
    reportForManualExploitation = async (report: any, handlerId: any) => {
        if (config.mode === "connected") {
            try {
                Logging.debug(`Inserting new base_constraints with constraints="${JSON.stringify(report['constraints'])}" and handlerId="${handlerId}"`)
                let res = await sequelize.query('INSERT INTO base_constraints (constraints, handler_id) VALUES (:constraints,:handlerId) RETURNING constraint_id',
                    {
                        replacements: {
                            constraints: JSON.stringify(report['constraints']),
                            handlerId: handlerId
                        },
                        type: QueryTypes.INSERT
                    });
                let b_id = ((res[0] as any)[0] as any).constraint_id;

                Logging.debug(`Inserting into flow_flagged_for_manual with b_id="${b_id}", sinkObject="${JSON.stringify(report['sinkObject'])}" and sink="${report['sink']}"`)
                await sequelize.query('INSERT INTO flow_flagged_for_manual (constraint_id, exploit_constraints,sink) VALUES (:b_id, :sinkObject, :sink)',
                    {
                        replacements: {
                            b_id: b_id,
                            sinkObject: JSON.stringify(report['sinkObject']),
                            sink: report['sink']
                        },
                        type: QueryTypes.INSERT
                    })
            } catch (err: any) {
                Logging.error(`Writing to database in reportForManualExploitation failed. Error: ${err.toString()}`);
            }
        }
        return undefined;
    }

    /**
     * Query properties of object via CDP
     * @param objId Object ot request properties from
     * @returns Runtime properties
     */
    requestPropertiesFromObjId = async (objId: any) => {
        Logging.info('Requesting ' + objId);
        return await this.CDPsession?.send('Runtime.getProperties', {
            objectId: objId,
        });
    }

    /**
     * Store exploits in exploitCandidates map
     * 
     * @param exploits Exploits
     * @param handlerId Id exploits belong to
     */
    reportExploits = (exploits: any, handlerId: any) => {
        this.exploitCandidates.set(handlerId, exploits);
        Logging.info('Calling fun for' + handlerId + exploits);
        this.handlerIdToResolve.get(handlerId)();
    }

    /**
     * Start constraint solver on found constraints/types
     * 
     * @param constraints 
     * @param types 
     * @param constraintId 
     * @param exp_constraints 
     * @param sink 
     * @returns 
     */
    trySolveForSat = async (constraints: any, types: any, constraintId: any, exp_constraints: any, sink: any) => {
        let p: any;
        let that = this;
        try {
            Logging.debug("Starting exploit generator up")
            p = await new Promise((resolve, reject) => {

                // Start the constraint solver with timeout to kill after SAT_TIMEOUT seconds
                let proc = exec('python3 ./snippets/pmxss/pmforce/src/external/pm/python/ConstraintSolver.py', {
                    timeout: SAT_TIMEOUT,
                }, (err: any, stdout: any, stderr: any) => {
                    resolve({ stdout: stdout, stderr: stderr, err: err })
                });
                proc.stdin.write(JSON.stringify({ constraints: constraints, types: types }));
                proc.stdin.end()

                process.on('SIGINT', () => {
                    proc.kill('SIGINT');
                    process.exit();
                })
            })
        } catch (e) {
            console.log('here is my exception', e);
            // If Sat solver failed, report with success as false, 0
            await that.reportConstraintSatisfiability(constraintId, constraints, exp_constraints, types, 0, (e as any), sink);
            return undefined
        }
        Logging.debug("Exploit generator finished execution")
        if (p.err) {
            Logging.info(`Exploit generator exited with error. Error: ${JSON.stringify(p)}`)
            if (p.err.killed) {
                // this captures kills by the exec function due to timeouts
                await that.reportConstraintSatisfiability(constraintId, constraints, exp_constraints, types, 0, 'Timeout', sink);
            } else {
                // Other reasons for the solver to fail are captured here, stderr saved to db
                await that.reportConstraintSatisfiability(constraintId, constraints, exp_constraints, types, 0, p.stderr, sink);
            }
            return undefined
        } else if (p.stderr.length > 0) {
            // Other reasons for the solver to fail are captured here, stderr saved to db
            await that.reportConstraintSatisfiability(constraintId, constraints, exp_constraints, types, 0, p.stderr, sink);
            return undefined;
        } else {
            // If no error happened, parse the process output and report constraint satisfiability info 
            let assignments = JSON.parse(p.stdout);
            let eId = await that.reportConstraintSatisfiability(constraintId, constraints, exp_constraints, types, 1, assignments, sink);
            return [assignments, eId];
        }
    }

    /**
     * Determine whether handler should be analyzed and if so insert 
     * into database and create promise to resolve in hander to resolve list.
     * 
     * @param frameUrl Frame of handler
     * @param handler Reference to PM handler
     * @returns 
     */
    shouldAnalyzeHandler = async (frameUrl: any, handler: any) => {
        let that = this;
        try {
            if (CUR_HANDLER++ > MAX_HANDLERS) {
                // Only capture up to MAX_HANDLERS amount of handlers
                return undefined
            }
            let handlerId: any = undefined;

            // Compute md5 value of handler
            let handlerHash = md5(handler);


            if (config.mode === "connected") {
                // If connected to DB, insert handler and store handler id from DB
                Logging.debug(`Inserting new handler with host="${new URL(frameUrl).hostname}", site="", frameUrl="${frameUrl}", subjectId="${this.task?.id}"`)
                let res = await sequelize.query('INSERT INTO handler (host,site, handler_hash, url, subject_id) VALUES (:host,:site,:handlerHash,:frameUrl,:subjectId) ON CONFLICT DO NOTHING RETURNING handler_id', {
                    replacements: {
                        host: new URL(frameUrl).hostname,
                        site: "",
                        handlerHash: handlerHash,
                        frameUrl: frameUrl,
                        subjectId: this.task?.id
                    },
                    type: QueryTypes.INSERT
                });

                if (res.length) {
                    if (((res[0] as any)[0] as any) && ((res[0] as any)[0] as any).handler_id) {
                        handlerId = ((res[0] as any)[0] as any).handler_id
                    } else {
                        Logging.warn('not analyzing due to duplicate in DB ' + handlerHash + " " + handlerId);
                        return undefined
                    }
                } else {
                    Logging.warn('not analyzing due to duplicate in DB ' + handlerHash + " " + handlerId);
                    return undefined
                }
                // Store handler in funs list for storing later
                this.funs.push(handler)
            } else {
                // Not connected to db,  Check if handler id is already in list to resolve, if so return
                if (that.handlerIdToResolve.has(handlerId)) {
                    return undefined
                }
                // Generate stub id for handler 
                handlerId = 'handler_' + randomString();
            }

            // Store handlerId in promise list
            this.handlerPromises.push(new Promise((resolve => {
                let x = setTimeout(resolve, TEST_TIMEOUT);
                that.handlerIdToResolve.set(handlerId, function () {
                    clearTimeout(x);
                    resolve(undefined);
                });
            })));
            // handlerId is undefined when we have seen the handler already
            return handlerId
        } catch (e: any) {
            Logging.error("(shouldAnalyzeHandler) Inserting handler failed with error:" + e.toString())
        }
        return undefined
    }

    /**
     * Add hooks prior to visiting page
     */
    before = async (page: any) => {
        // Check crawler browser (only works with chromium -> cdp)
        if (!config.dynamic.chromium) {
            Logging.error("Wrong browser type for PMXSS module.")
            return;
        }
        if (this.task?.type !== "RECONNAISSANCE") {
            return;
        }
        // Open CDP session to browser and enable flags
        this.CDPsession = await page.context().newCDPSession(page);
        await this.CDPsession.send('Runtime.enable').catch((err: any) => Logging.error(err));
        await this.CDPsession.send('Debugger.enable').catch((err: any) => Logging.error(err));

        // Expose functions from this module to the page for analyzer to execute
        await page.exposeFunction('__trySolveForSat', this.trySolveForSat);
        await page.exposeFunction('__reportBaseConstraint', this.reportBaseConstraint);
        await page.exposeFunction('__report_manual_exploit', this.reportForManualExploitation);
        await page.exposeFunction('__shouldAnalyzeHandler', this.shouldAnalyzeHandler);
        await page.exposeFunction('__reportExternalFun', this.reportExternalFun);
        await page.exposeFunction('__report_exploits', this.reportExploits);

        // Add packed analyzer taken from PMforce github repository
        let packedAnalyzer = fs.readFileSync(path.join(__dirname, "..", "snippets", "pmxss", "pmforce", "src", "external", "pm", "dist", "bundle.js"), { encoding: "utf-8" })
        let iroh = fs.readFileSync(path.join(__dirname, "..", "snippets", "pmxss", "pmforce", "src", "external", "pm", "iroh.js"), { encoding: "utf-8" })
        let beforeScript = fs.readFileSync(path.join(__dirname, "..", "snippets", "pmxss", "BeforeScript.js"), { encoding: "utf-8" })

        await page.exposeFunction('__investigateObj', async function (obj: any) {
            console.log(obj)
        });
        await page.exposeFunction('__reportPrivacyLeak', async function () {
            console.log(arguments)
        });

        let handlerIdToResolve = this.handlerIdToResolve;
        await page.exposeFunction('__report_failed_handler', function (handlerId: any, reason: any) {
            Logging.error('Iroh could not handle this thing here: ' + handlerId + " " + reason);
            handlerIdToResolve.get(handlerId)();
        });

        await page.exposeFunction('__clean_for_exploit', async function () {
            let pages = page.context().pages();
            for (let p of pages.slice(2)) {
                await p.close();
            }
        });

        await page.addInitScript(beforeScript.toString());

        // Insert dom_log functions (called on successful payload execution, from pmforce it is __crawly__)
        for (let domlog_name of domlog_names) {
            await page.addInitScript('(function (){window.__our_log = console.log;let ourLog = console.log;window.' + domlog_name + '= function(id){let cur_loc = window.__getContextUrl(window);ourLog("[domlog]"+ JSON.stringify({url:cur_loc, id:id}))}})()').catch((err: any) => console.log(err));
        }

        // Insert iroh, analyzer as init script when crawled page opens
        await page.addInitScript('(function(){' + iroh.toString() + '})()');
        await page.addInitScript('(function(){' + packedAnalyzer.toString() + '})()');

        // Hook console API via CDP to listen for domlog functions and store confirmed exploits if invoked
        await this.CDPsession.on('Runtime.consoleAPICalled', async (logEntry: any) => {
            if (logEntry.type === 'log') {
                let message = logEntry.args[0].value;
                if (message && message.startsWith && message.startsWith('[domlog]')) {
                    let stack = logEntry.stackTrace;
                    let parsed = JSON.parse(message.slice(8));
                    this.reports.push(parsed);
                    this.confirmedExploits.set(parsed['id'], { url: parsed['url'], stack: stack });
                }
            }
        });

        let that = this;
        // PMForce CDP instrumentalization
        await that.CDPsession.on('Debugger.paused', async (debugInfos: any) => {
            // When the debugger is paused, we need to verify that this is indeed a call
            // where we want to fetch values from other scopes
            let cfs = debugInfos.callFrames;
            if (cfs.length > 0 && cfs[0].functionName === 'run') {
                let fun_obj = await that.CDPsession.send('Debugger.evaluateOnCallFrame', {
                    callFrameId: cfs[0].callFrameId,
                    //  expression: '[__id_to_set, __fun_obj]
                    expression: '__fun_obj'
                });
                let identifer_obj = await that.CDPsession.send('Debugger.evaluateOnCallFrame', {
                    callFrameId: cfs[0].callFrameId,
                    expression: '__id_to_set'
                });
                Logging.debug('Working to get some object:' + JSON.stringify(identifer_obj))
                let props = await that.requestPropertiesFromObjId(fun_obj.result.objectId);
                // If these properties are defined in the most recent scope then we have triggered the debugger to fill values
                if (props.internalProperties) {
                    breakout_here:
                    for (let int_props of props.internalProperties) {
                        if (int_props.name === '[[Scopes]]') {
                            let scope_props = await that.requestPropertiesFromObjId(int_props.value.objectId);
                            for (let scope_obj of scope_props.result) {
                                let scope_obj_props = await that.requestPropertiesFromObjId(scope_obj.value.objectId);
                                for (let elem of scope_obj_props.result) {
                                    if (elem.name === identifer_obj.result.value) {
                                        await that.CDPsession.send('Debugger.evaluateOnCallFrame', {
                                            callFrameId: cfs[0].callFrameId,
                                            expression: '__fun_code = ' + elem.value.description
                                        });
                                        if (elem.value.objectId) {
                                            await that.CDPsession.send('Runtime.callFunctionOn', {
                                                functionDeclaration: 'function(){window.__passing_obj=this}',
                                                objectId: elem.value.objectId
                                            });
                                            // FIXME: while setting things on the window is suboptimal, setting them for the local scope
                                            //  of our functions induces weird side-effects which appears to be a bug in the devtools protocol
                                            await that.CDPsession.send('Debugger.evaluateOnCallFrame', {
                                                callFrameId: cfs[0].callFrameId,
                                                expression: '__fun_code = true'
                                            });
                                            await that.CDPsession.send('Debugger.evaluateOnCallFrame', {
                                                callFrameId: cfs[0].callFrameId,
                                                expression: 'window.' + elem.name + ' = window.__passing_obj;'
                                            });
                                            Logging.debug('Setting ' + JSON.stringify(elem.name) + ' to ' + JSON.stringify(elem.value))
                                        } else {
                                            let val;
                                            if (elem.value.type !== 'string') {
                                                val = elem.value.value
                                            } else {
                                                val = '"' + elem.value.value + '"'
                                            }
                                            await that.CDPsession.send('Debugger.evaluateOnCallFrame', {
                                                callFrameId: cfs[0].callFrameId,
                                                expression: '__fun_code = true'
                                            });
                                            // FIXME: while setting things on the window is suboptimal, setting them for the local scope
                                            //  of our functions induces weird side-effects which appears to be a bug in the devtools protocol
                                            await that.CDPsession.send('Debugger.evaluateOnCallFrame', {
                                                callFrameId: cfs[0].callFrameId,
                                                expression: 'window.' + elem.name + ' =' + val + ';'
                                            });
                                            Logging.info('Setting' + JSON.stringify(elem.name) + ' to ' + JSON.stringify(val))
                                        }
                                        break breakout_here;
                                    }
                                }
                            }
                        }
                    }
                }
                await that.CDPsession.send('Debugger.resume');
            }

        });
        // Navigation lock for Chromium via Page & Fetch API
        await that.CDPsession.send('Page.enable');
        // Intercept document type requests (e.g. navigations)
        await that.CDPsession.send('Fetch.enable', {
            patterns: [{ interceptionStage: 'Request', resourceType: 'Document' }],
            handleAuthRequests: false
        });

        let frameTree = (await this.CDPsession.send("Page.getFrameTree"))["frameTree"];
        let mainFrameId = frameTree.frame.id;

        // Inspect intercepted request and determine if it is in main frame, if so stop navigation (lock)
        await that.CDPsession.on('Fetch.requestPaused', async (pausedRequest: any) => {
            const { requestId, request, frameId, resourceType, responseErrorReason, responseStatusCode, responseStatusText, responseHeaders, networkId, redirectedRequestId } = pausedRequest;

            const isNavigationRequest = resourceType === 'Document';
            const belongsToMainFrame = frameId === mainFrameId;
            const mainFrameAlreadyOnSite = page.mainFrame().url().startsWith('http')

            if (isNavigationRequest && belongsToMainFrame && mainFrameAlreadyOnSite) {
                // Lock to visited page (first page when start url was entered)
                Logging.debug(`Prevented navigation request to outside of current page from ${page.mainFrame().url()} to ${request.url}`)
                that.CDPsession.send('Fetch.failRequest', {
                    requestId: pausedRequest.requestId,
                    errorReason: 'Aborted'
                });
            } else {
                // If it is not mainframe navigation, allow request to continue
                that.CDPsession.send('Fetch.continueRequest', {
                    requestId: pausedRequest.requestId,
                });
            }
        });

    };

    /**
     * Finish module execution by storing all confirmed exploits in the database and handler functions on disk
     * 
     * @param page Page to finish
     * @returns Nothing
     */
    finish = async (page: any) => {
        if (this.task?.type !== "RECONNAISSANCE") {
            return;
        }
        if (!config.dynamic.chromium) {
            Logging.error("Wrong browser type for PMXSS module.")
            return;
        }
        Logging.info('Waiting for results from all handlers writes. Overall handlerPromises.length: ' + this.handlerPromises.length);
        await Promise.all(this.handlerPromises);
        Logging.info(`We have ${this.exploitCandidates.size} exploit candidates (handlers), out of which ${this.confirmedExploits.size} were confirmed.`)

        // Save confirmed exploits in database in report table
        if (config.mode === "connected") {
            Logging.info('Waiting for results to be entered in DB');
            for (let handler_id of this.exploitCandidates.keys()) {
                for (let entry of this.exploitCandidates.get(handler_id)) {
                    for (let cand of entry['candidates']) {
                        if (this.confirmedExploits.has(cand['exploitId'])) {
                            let addInfo = this.confirmedExploits.get(cand['exploitId']);
                            sequelize.query('INSERT INTO report (exploit_id,message,addInfo) VALUES (:exploitCandidateId,:message, :addInfo)',
                                {
                                    replacements: {
                                        exploitCandidateId: cand['exploitCandidateId'],
                                        message: JSON.stringify(escapeObj(cand['message'])),
                                        addInfo: JSON.stringify(addInfo)
                                    },
                                    type: QueryTypes.INSERT
                                })
                        }
                    }
                }
                // Store handler code in database
                Logging.info('Waiting for filedisk writes');
                for (let index = 0; index < this.funs.length; index++) {
                    const fun = this.funs[index];
                    let fun_hash = md5(fun);
                    // Determine target path by first two values of md5 hash of function (parent folder in dataPath)
                    let targetDirectory = path.join(config.dataPath, fun_hash.substr(0, 2));
                    Logging.debug(`Writing handler with id="${fun_hash}" to disk.`);
                    if (!fs.existsSync(targetDirectory)) {
                        fs.mkdirSync(targetDirectory)
                    }
                    fs.writeFileSync(path.join(targetDirectory, fun_hash), fun, { encoding: "utf-8" })
                }
            }
        }
    };

    execute = async (page: any) => {

    };
}
/**
 * Generate random string of specified length
 * 
 * @param length Length of random string to be generated
 * @returns Random string
 */
function randomString(length = 20) {
    let result = '';
    let characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let charactersLength = characters.length;
    for (let i = 0; i < length; i++)
        result += characters.charAt(Math.floor(Math.random() * charactersLength));
    return result;
}

/**
 * Run escape method on all properties of passed object (recursively).
 * 
 * @param obj Object to escape
 * @returns Escaped object
 */
function escapeObj(obj: any) {
    if (typeof obj === 'object') {
        for (let key of Object.keys(obj)) {
            obj[key] = escapeObj(obj[key]);
        }
    } else if (typeof obj === 'string') {
        obj = escape(obj);
    }
    return obj
}


export default PMSecurity;