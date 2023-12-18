import config, { Config } from "../config";
import { sleep } from "../utils/sleep";
import * as fs from "fs";
import path from "path";
import { Module } from "../types/module";
import { Logging } from "../utils/logging";
import { Browser, BrowserContext, LaunchOptions, Page, chromium, devices, firefox } from "playwright";
import { collectLinks } from "../utils/collect-links";
import { Task, TaskQueue } from "./taskqueue";
import DatabaseHelper from "../utils/database-helper";
import { Subject, SubjectType } from "../database/models/subject";
import { benchmark } from "../utils/benchmark";

type ImportModuleType = { default: Module };

class Crawler {
    id?: number;

    numberOfFinishedSubjects: number = 0;

    browser?: Browser;
    page?: Page;
    config?: Config;
    context?: BrowserContext;
    modules: Module[] = [];
    queue = new TaskQueue();

    async setup(moduleName?: string) {
        this.modules = [];
        // Setup database structure
        await DatabaseHelper.setup();

        if (moduleName) {
            // Setup modules
            const files = fs.readdirSync(path.join(__dirname, "..", "modules"));
            const imports = await Promise.all(files.map(file => (
                import(path.resolve(__dirname, '..', 'modules', file)).then((module: ImportModuleType) => module.default)))
            )

            for (let index = 0; index < imports.length; index++) {
                const module = imports[index];
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const instantiatedModule = new (module as any)();
                if (instantiatedModule.name === moduleName) {
                    this.modules.push(instantiatedModule)
                }
            }

            for (let index = 0; index < this.modules.length; index++) {
                const module = this.modules[index];
                await module.setup();
            }
        } else {
            Logging.warn(`Started crawling setup with no module selected to setup for`)
        }
    }

    async init(config: Config) {
        this.config = config;

        if (config.mode === "connected") {
            // await this.backend.register();
            this.id = await DatabaseHelper.registerCrawler();
            this.queue.workerId = this.id;
        }
    }

    static pollingCounter = 1;

    /**
     * Perform the passed task by visiting the attached URL and executing the configured module code on the site. Additionally,
     * runs code before for loading the site to attach handlers to the page and afterwards after having loaded the site.
     * @param work 
     */
    async visit(work: Task) {
        // If no ID is attached to the crawler, do nothing and terminate
        if (!this.id) {
            Logging.error(`Crawler not initialized when trying to visit a page. Exiting...`)
            process.exit(-1);
        }
        const subject: Task = work;
        // Set visitation begin time to task
        await Subject.update({
            visitation_begin: new Date()
        }, {
            where: {
                id: subject.id
            }
        })

        const taskBenchmark = benchmark(`Visting ${subject.url} for ${subject.type} task (id="${subject.id}") ${subject.session ? "with Context" : ""}.`)
        Logging.info(`Visting ${subject.url} for ${subject.type} task (id="${subject.id}") ${subject.session ? "with Context" : ""}.`)

        // Check if chromium is configured to be used 
        if (config.dynamic.chromium) {
            if (config.dynamic.user_data_dir) {
                throw new Error("Starting up chrome with persistent context not implemented yet.")
            } else {
                // Start chromium instance and pass user agent
                this.browser = await chromium.launch({
                    headless: !config.headfull,
                    viewport: { width: devices["Desktop Chrome"].viewport.width, height: devices["Desktop Chrome"].viewport.height },
                    userAgent: config.dynamic.user_agent ? config.dynamic.user_agent : devices["Desktop Chrome"].userAgent,
                    bypassCSP: true,
                    args: []
                } as LaunchOptions)
            }
        }

        // Check if firefox is configured to be used
        if (config.dynamic.firefox) {
            if (config.dynamic.user_data_dir) {
                // If directory for user data is specified, pick that 
                this.context = await firefox.launchPersistentContext(config.dynamic.user_data_dir, {
                    headless: !config.headfull,
                    bypassCSP: true,
                    viewport: { width: devices["Desktop Firefox"].viewport.width, height: devices["Desktop Firefox"].viewport.height },

                    ...(config.dynamic.browser_executable_path && {
                        executablePath: config.dynamic.browser_executable_path
                    }),
                    userAgent: config.dynamic.user_agent ? config.dynamic.user_agent : devices["Desktop Firefox"].userAgent
                });
            } else {
                // If no user data directory is specified, start firefox whichout persistent context
                this.browser = await firefox.launch({
                    headless: !config.headfull,
                    bypassCSP: true,
                    viewport: { width: devices["Desktop Firefox"].viewport.width, height: devices["Desktop Firefox"].viewport.height },
                    // Check if custom executable path is set, to use Foxhound in our use case
                    ...(config.dynamic.browser_executable_path && {
                        executablePath: config.dynamic.browser_executable_path
                    }),
                    userAgent: config.dynamic.user_agent ? config.dynamic.user_agent : devices["Desktop Firefox"].userAgent
                });
            }
        }

        Logging.info(`Started up ${this.browser?.browserType().name()} with version ${this.browser?.version()}`)

        // If browser was not initialized and therefore is undefined, exit crawler due to error
        if (!this.browser) {
            Logging.error(`Failure happened during initialization of browser. Exiting...`)
            process.exit(-1);
        }

        // If no user data directory was specified, start a browser context after launching the browser
        if (!config.dynamic.user_data_dir) {
            if (config.dynamic.chromium) {
                this.context = await this.browser.newContext({
                    ...(config.dynamic.user_agent && {
                        userAgent: config.dynamic.user_agent
                    }),
                })
            } else {
                this.context = await this.browser.newContext({
                    ...(config.dynamic.user_agent && {
                        userAgent: config.dynamic.user_agent
                    }),
                })
            }
        }

        // If crawling on the same site during same task, wait for sameSite interval on pages beyond the root
        if (subject.taskData.depth && subject.taskData.depth > 0) {
            await sleep(config.timeouts.sameSite);
        }

        try {
            const element: Task = {
                ...subject
            };

            // Check if task to be started is associated with session
            if (element.session) {
                // If a session is configured, check if temporary datapath for storing sessions is existing
                const sessionPath = path.join(config.dataPath, "sessions")
                if (!fs.existsSync(sessionPath)) {
                    // If it does not exist, create the folder
                    fs.mkdirSync(sessionPath, { recursive: true })
                }

                // Check if for crawler there is already a session json stored on disk
                const filePath = path.join(sessionPath, `state-${this.id}.json`);
                if (fs.existsSync(filePath)) {
                    // If so, delete that session file
                    fs.rmSync(filePath);
                }
                // Write new session file containing session information for task on disk
                fs.writeFileSync(filePath, JSON.stringify(element.session.session_data, null, 2), { encoding: "utf-8" })

                // Check which browser is configured, and start new browser context loading the session data file from disk
                if (config.dynamic.chromium) {
                    this.context = await this.browser.newContext({
                        storageState: filePath,
                        ...(config.dynamic.user_agent && {
                            userAgent: config.dynamic.user_agent
                        }),
                    })
                } else {
                    this.context = await this.browser.newContext({
                        storageState: filePath,
                        ...(config.dynamic.user_agent && {
                            userAgent: config.dynamic.user_agent
                        }),
                    })
                }
                // Open a new page in the browser
                this.page = await this.context?.newPage();
            } else {
                // If no session is configured, only open a new page in the browser
                this.page = await this.context?.newPage();
            }

            // Check if opening the page has failed and if so, terminate the crawler
            if (!this.page) {
                Logging.error(`Error happened during page initialization. Exiting...`)
                process.exit(-1);
            }

            this.modules = [];

            // Load all modules from modules folder into the crawler and store in modules array
            Logging.debug("Fetching specified module")
            const files = fs.readdirSync(path.join(__dirname, "..", "modules"));
            const imports = await Promise.all(files.map(file => (
                import(path.resolve(__dirname, '..', 'modules', file)).then((module: ImportModuleType) => module.default)))
            )
            for (let index = 0; index < imports.length; index++) {
                const module = imports[index];
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const instantiatedModule = new (module as any)();
                if (instantiatedModule.name === config.dynamic.module) {
                    this.modules.push(instantiatedModule)
                }
            }

            // For all loaded modules, run register method prior to performing the task and assign the crawler to the module
            Logging.debug("Registering task in module")
            for (let index = 0; index < this.modules.length; index++) {
                const module = this.modules[index];
                await module.register(element, this);
            }

            // For all loaded modules, run before method prior to performing the task
            Logging.debug("Executing before() method of module")
            const beforeBenchmark = benchmark("Executing before() method of module")
            for (let index = 0; index < this.modules.length; index++) {
                const module = this.modules[index];
                await module.before(this.page);
            }
            beforeBenchmark.stop()

            // Open the URL belonging to the task in the page
            Logging.debug("Opening URL that was specified via page.goto")
            await this.page.goto(element.url, {
                timeout: config.goto.timeout,
                waitUntil: config.goto.waitUntil
            });

            // Check if screenshot folder is existing and screenshotting is enabled
            const screenshotPath = path.join(config.dataPath, "screenshots")
            if (config.sessions.screenshotAfterwards || config.sessions.screenshotBefore) {
                if (!fs.existsSync(screenshotPath)) {
                    // If folder does not exist, create the screenshot folder
                    Logging.debug("Creating screenshot folder since it does not exist")
                    fs.mkdirSync(screenshotPath, { recursive: true })
                }
            }

            // If the task type is screenshotting, perform the screenshot and save the screenshot in the image folder
            if (subject.type === SubjectType.SCREENSHOT) {
                Logging.debug(`Creating the screenshot of the page`)
                await this.page.screenshot({ path: path.join(screenshotPath, `${subject.id}.png`), fullPage: true });
            }

            // Letting the module execute the code that was registered in before
            Logging.debug("Waiting for page to finish executing")
            await this.page.waitForTimeout(config.timeouts.moduleExec)

            // Run through all modules and perform the execute method after the pages execution was waited for
            const executeBenchmark = benchmark("Execution of execute() of module")
            Logging.debug("Finalizing module execution by calling execute() of module")
            for (let index = 0; index < this.modules.length; index++) {
                const module = this.modules[index];
                await module.execute(this.page);
            }
            executeBenchmark.stop()

            // If link collection is enabled for the crawler and subject is of type RECONNAISSANCE, perform link collection
            if (config.links.collect && subject.type === SubjectType.RECONNAISSANCE) {
                Logging.debug("Retrieving all on page links from document.links")
                // Fetch all links from the loaded page
                const hrefs = await this.page.evaluate(() => {
                    return Array.from(document.links).map(item => item.href);
                });
                // Collct the fetched urls (depth increases by one and each new URL has the current page as its parent)
                await collectLinks(hrefs, this.page.url(), subject.taskData.depth + 1, this.id, subject.url_id!, element.session);
            }

            // Afterwards, execute finish method on all loaded modules
            const finishBenchmark = benchmark("Executing the finish() method of the registered module.")
            Logging.debug("Executing the finish() method of the registered module.")
            for (let index = 0; index < this.modules.length; index++) {
                const module = this.modules[index];
                await module.finish(this.page);
            }
            finishBenchmark.stop()

            Logging.info(`Finished visiting ${subject.url} for ${subject.type} task (id="${subject.id}").`)
        } catch (err: unknown) {
            // If any error happened during execution, check if crawler was connected to the database
            if (config.mode === "connected") {
                // Store a message that the subject was skipped in the database
                Logging.debug(`Skipping subject due to error. Error: ${(err as Error).toString()}`)
                await DatabaseHelper.skipSubject(subject.id, subject.url_id as number, (err as Error).toString())

                // Close the open page
                Logging.debug("Closing down page...")
                await this.page?.close()
                // Close the opened context
                Logging.debug("Closing down context...")
                await this.context?.close()
                // Close the running browser
                Logging.debug("Closing down browser...")
                await this.browser.close()


                this.numberOfFinishedSubjects++;
                taskBenchmark.stop();
                return;
            }
        }

        // After crawler finished work successfully, close down page/context/browser
        Logging.debug("Closing down page...")
        await this.page?.close()
        Logging.debug("Closing down context...")
        await this.context?.close()
        Logging.debug("Closing down browser...")
        await this.browser.close()

        // Check if browser was connected to the database
        if (config.mode === "connected") {
            // Store finished message to subject in the database
            Logging.debug("Marking subject as done via DatabaseHelper.")
            await DatabaseHelper.finishSubject(subject.id!, subject.url_id!, this.page!.url());
        }

        this.numberOfFinishedSubjects++;
        taskBenchmark.stop();
    }


    /**
     * Helper method for closing the open context/browser after crawl and deregistering the crawler from the database
     */
    async finish() {
        if (config.dynamic.user_data_dir) {
            this.context?.close();
        }
        if (this.browser) {
            this.browser.close();
        }
        if (config.mode === "connected") {
            await DatabaseHelper.deregisterCrawler({
                workerId: this.id!,
                numberOfFinishedSubjects: this.numberOfFinishedSubjects,
                message: "Normal worker termination"
            })
            process.exit(0)
        }
    }
}

export default Crawler;