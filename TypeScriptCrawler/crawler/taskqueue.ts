import config from "../config";
import { SubjectStatus, SubjectType } from "../database/models/subject";
import { Task } from "../types/task";
import DatabaseHelper from "../utils/database-helper";
import { Logging } from "../utils/logging";

class TaskQueue {
    queue: Task[] = [];
    workerId?: number;

    /**
     * Queue task on the beginning of the task queue
     * @param task 
     */
    enqueue(task: Task) {
        this.queue.unshift(task)
    }

    /**
     * Fetch a task from the task queue. If no task exists, try to load a task from the database and work on that. 
     * - If urlId, domainId, sessionId is set, try to fetch a task for that key
     * - If no task is available, return undefined
     * @param urlId UrlId of task to fetch which it should belong to
     * @param domainId Id of domain to fetch tasks for
     * @param sessionId Id of session to fetch tasks for
     * @returns 
     */
    async dequeue(urlId?: number, domainId?: number, sessionId?: number): Promise<Task | undefined> {
        // Check, whether workerId is specified and if not, return undefined and show warning
        if (!this.workerId) {
            Logging.warn("Tried to fetch new subject without having a registered crawler.")
            return undefined;
        }
        // Check if queue of tasks is empty
        if (this.queue.length === 0) {
            // If queue is empty and crawler is not connected to database, return undefined
            if (config.mode !== "connected") {
                return undefined;
            }
            // If crawler is connected to database, fetch subject from the database
            const subjects = await DatabaseHelper.next(this.workerId, urlId, domainId, sessionId);

            // Check if fetching subjects from database yielded any results
            if (subjects) {
                for (let i = 0; i < subjects.length; i++) {
                    const subject = subjects[i]
                    // Check if task is a CXSS verification
                    if (subject.type == SubjectType.CXSS_VERFICATION) {
                        // Queue subject as task
                        this.enqueue({
                            id: subject.id,
                            url: subject.url,
                            url_id: subject.url_id,
                            domain_id: subject.domain_id,
                            type: subject.type,
                            taskData: {
                                ...subject.additional_information
                            },
                            session: subject.session
                        })
                        // Check if task is of RECONNAISSANCE type
                    } else if (subject.type == SubjectType.RECONNAISSANCE) {
                        // Schedule the main task in queue
                        this.enqueue({
                            id: subject.id,
                            url: subject.url,
                            url_id: subject.url_id,
                            domain_id: subject.domain_id,
                            type: subject.type,
                            taskData: {
                                depth: subject.depth,
                                ...subject.additional_information
                            },
                            session: subject.session
                        })
                        // Chec if task is of SCREENSHOT type
                    } else if (subject.type == SubjectType.SCREENSHOT) {
                        // Schedule screenshot task
                        this.enqueue({
                            id: subject.id,
                            url: subject.url,
                            url_id: subject.url_id,
                            domain_id: subject.domain_id,
                            type: subject.type,
                            taskData: {
                                ...subject.additional_information
                            },
                            session: subject.session
                        })
                    } else {
                        Logging.error("Next subjects have incorrect type!?")
                    }
                }
            }
        }
        // Retrieve first item from queue and return it
        return this.queue.shift();
    }

    // Check if queue has entries (tasks)
    hasWork() {
        return this.queue.length > 0;
    }

    /**
     * Queue screenshot task after task (unused)
     * @param task 
     */
    async queueScreenshotAfterwards(task: Task) {
        // Check, whether workerId is specified and if not, return undefined and show warning
        if (!this.workerId) {
            Logging.warn("Tried to fetch new subject without having a registered crawler.")
            return undefined;
        }
        // Check, if task type is RECONNAISSANCE and if not return
        if (task.type !== SubjectType.RECONNAISSANCE) {
            return;
        }
        // Check, whether depth of the task is in range of screenshotting configuration and screenshotting afterwards is enabled
        if (task.taskData.depth! <= config.sessions.screenshotMaxDepth && config.sessions.screenshotAfterwards) {
            if (!task.session?.id) {
                // Add screenshot of url before to visiting with login state (additionally landing_page in session case)
                await DatabaseHelper.addSubject(
                    SubjectType.SCREENSHOT,
                    task.url,
                    "",
                    SubjectStatus.UNVISITED,
                    {
                        type: "screenshotAfterwards",
                        page_type: "landing_page",
                        related_subject: task.id
                    },
                    task.url_id!,
                    this.workerId,
                    task.session?.id
                );

                // Check if formurl is configured in session data and schedule screenshot of loginform afterwards
                if (task.taskData && task.taskData.formurl) {
                    await DatabaseHelper.addSubject(
                        SubjectType.SCREENSHOT,
                        task.taskData.formurl,
                        "",
                        SubjectStatus.UNVISITED,
                        {
                            type: "screenshotAfterwards",
                            page_type: "loginform",
                            related_subject: task.id
                        },
                        task.url_id!,
                        this.workerId,
                        task.session?.id
                    );
                }
            } else {
                // Add screenshot of url before to visiting without login state (additionally landing_page in session case)
                await DatabaseHelper.addSubject(
                    SubjectType.SCREENSHOT,
                    task.url,
                    "",
                    SubjectStatus.UNVISITED,
                    {
                        type: "screenshotAfterwards",
                        page_type: "landing_page",
                        related_subject: task.id
                    },
                    task.url_id!,
                    this.workerId,
                    task.session?.id
                );

                // Check if formurl is configured in session data and schedule screenshot of loginform afterwards
                if (task.taskData && task.taskData.formurl) {
                    await DatabaseHelper.addSubject(
                        SubjectType.SCREENSHOT,
                        task.taskData.formurl,
                        "",
                        SubjectStatus.UNVISITED,
                        {
                            type: "screenshotAfterwards",
                            page_type: "loginform",
                            related_subject: task.id
                        },
                        task.url_id!,
                        this.workerId,
                        task.session?.id
                    );
                }
            }
        }
    }
}

export { Task, TaskQueue }