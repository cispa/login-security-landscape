import config from "../config";
import { Session } from "../database/models/session";
import { Subject } from "../database/models/subject";
import { shuffle } from "./array-shuffle";
import { SubjectFactory } from "./factories/subject-factory";
import { Logging } from "./logging";

const exclusionRegex = /log.?out|sign.?out|log.?off|sign.?off|exit|quit|invalidate|ab.?melden|aus.?loggen|ab.?meldung|verlassen|aus.?treten|annullieren/g;

/**
 * Check whether collected link matches exclusion regex (ignore urls which could be relevant for logging out etc.)
 * 
 * @param href Href to check
 * @returns 
 */
const matchesExclusionPattern = (href: string) => {
    if (!href.match(exclusionRegex)) {
        return false;
    }
    return href.match(exclusionRegex)!.length > 0;
}

/**
 * Check whether given href is internal, e.g. on the same host as the URL wich is compared against.
 * 
 * @param href Href to check
 * @param url Url to compare href against
 * @returns Whether link is same host
 */
const isInternal = (href: string, url: string) => {
    if (href.startsWith("http")) {
        const newUrl = new URL(href);
        const pageUrl = new URL(url);
        return newUrl.host === pageUrl.host;
    } else {
        return href.startsWith("/");
    }
}

/**
 * Shuffle found urls and collect if they are URLs from the same-site and do not exceed collection limits from configuration
 * file.
 * 
 * @param hrefs Found hrefs on the site
 * @param url Current url of the crawler
 * @param depth New depth of collected links
 * @param worker_id Id of the worker
 * @param parent Parent URL eference (primary key)
 * @param session Session if crawl is happening with session
 * @returns 
 */
const collectLinks = async (hrefs: string[], url: string, depth: number, worker_id: number, parent?: number, session?: Session) => {
    if (config.links.maximum.depth && depth > config.links.maximum.depth) {
        // If new crawl depth is higher than configured maximum depth ignore links / do not collect
        return;
    }
    let foundLinks = 0;
    const newSubjects: Subject[] = [];

    // Shuffle the found hrefs
    Logging.debug("Shuffle the found hrefs randomly..")
    const shuffledHrefs: string[] = shuffle(hrefs) as string[];

    Logging.debug("Collecting URLs that qualify for crawling")
    for (let index = 0; index < shuffledHrefs.length; index++) {
        if (config.links.maximum.page && foundLinks >= config.links.maximum.page) {
            // If we exceed maximum link count per page, skip collection of links
            continue;
        }

        const href = shuffledHrefs[index]
        try {
            // Check whether found link matches exclusion pattern and if so, discard the link (do not collect)
            if (matchesExclusionPattern(href)) {
                continue;
            }
            // Check whether the link is internal / same host as current url crawler is on
            if (isInternal(href, url)) {
                // If link starts with http, assume it is HTTP(S) link and collect it
                if (href.startsWith("http")) {
                    // Check if session is set (= crawler working in logged in state) and if so, create subject with session
                    // Otherwise, create subject without session
                    // Increment number of foundLinks (= links collected on the site)
                    if (session) {
                        Logging.debug(`Creating new subject for href="${href}" with context (absolute same site URL)`)
                        const subjectWithSession = await SubjectFactory.createSubjectFromUrlString(href, depth, {}, parent, worker_id, session)
                        if (subjectWithSession) {
                            newSubjects.push(subjectWithSession);
                            foundLinks++;
                        }
                    } else {
                        Logging.debug(`Creating new subject for href="${href}" without context (absolute same site URL)`)
                        const subjectWithoutSession = await SubjectFactory.createSubjectFromUrlString(href, depth, {}, parent, worker_id)
                        if (subjectWithoutSession) {
                            newSubjects.push(subjectWithoutSession);
                            foundLinks++;
                        }
                    }
                } else {
                    // Otherwise, link might be relative, so first attempt to combine it with current url
                    try {
                        const newUrl = new URL(href, url).toString();
                        if (newUrl.startsWith("http")) {
                            // Depending on whether crawler is currently running with session again, newly created subject has also the session linked
                            // Also, increment number of foundLinks (= links collected on the site)
                            if (session) {
                                Logging.debug(`Creating new subject for href="${href}" with context (relative same site URL)`)
                                const subjectWithSession = await SubjectFactory.createSubjectFromUrlString(newUrl, depth, {}, parent, worker_id, session)
                                if (subjectWithSession) {
                                    newSubjects.push(subjectWithSession);
                                    foundLinks++;
                                }
                            } else {
                                Logging.debug(`Creating new subject for href="${href}" without context (relative same site URL)`)
                                const subjectWithoutSession = await SubjectFactory.createSubjectFromUrlString(newUrl, depth, {}, parent, worker_id)
                                if (subjectWithoutSession) {
                                    newSubjects.push(subjectWithoutSession);
                                    foundLinks++;
                                }
                            }

                        } else {
                            // Links like javascript: are also ignored
                            Logging.debug(`Ignoring found URL href="${href}"`)
                        }
                    } catch (err: unknown) {
                        // If error happened during url combination/URL instantiation failed so ignore the link
                        Logging.error(`Failed to store new url=${href} due to error. Error: ${(err as Error).toString()}`)
                    }
                }
            }
        } catch (err: unknown) {
            Logging.error(`Failed to store new url=${href} due to error. Error: ${(err as Error).toString()}`)
        }
    }
}

export { collectLinks };