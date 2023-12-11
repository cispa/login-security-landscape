import { Op, Transaction } from "sequelize";
import { sequelize } from "../../database/db";
import { Session } from "../../database/models/session";
import { Subject, SubjectStatus, SubjectType } from "../../database/models/subject";
import { CrawlingStatus, Url } from "../../database/models/url";
import { Logging } from "../logging";
import { URLFactory } from "./url-factory";
import config from "../../config";
import { Domain } from "../../database/models/domain";

interface IAddInformationWithForm {
    formurl: string;
}
// Helper function to check whether session data has formurl property
const hasFormurl = (obj: unknown): obj is IAddInformationWithForm => {
    return (obj as IAddInformationWithForm)?.formurl !== undefined
        && typeof (obj as IAddInformationWithForm).formurl === "string";
}

class SubjectFactory {
    /**
     * Create new subject from given URL string by first creating a URL and then creating the subject if needed: Depending of whether URL will be crawled (see domain URL count limit), 
     * subjects are created. Furthermore, if configured, also screenshotting subjects are created.
     * 
     * @param url Url to create subject for
     * @param depth Depth of url subject to create for
     * @param add_information Additional information for subject, e.g. exploit data
     * @param parent Parent id of URL
     * @param worker_id Id of crawler to work on this subject
     * @param session Attached session to subject
     * @returns 
     */
    static async createSubjectFromUrlString(url: string, depth: number, add_information: unknown, parent?: number, worker_id?: number, session?: Session): Promise<Subject | null> {
        // Create transaction for creating subject and related database objects (url, domain)
        const t = await sequelize.transaction();
        let subjectInDb: Subject | null = null;
        try {
            // Create url db object from given url string
            const urlInDb = await URLFactory.createUrlFromString(url, depth, parent, session, t);

            if (urlInDb && urlInDb.crawling_status !== CrawlingStatus.IGNORE) {
                Logging.debug(`Discovered new url=${urlInDb.url}, creating subjects...`)
                // If created URL is not deemed to be ignored, create subject for it. First, check if subject already exists (with/without session)
                const subject = await Subject.findOne({
                    where: {
                        url_id: urlInDb.id
                    },
                    transaction: t
                })
                const subjectWithSession = await Subject.findOne({
                    where: {
                        url_id: urlInDb.id,
                        session_id: {
                            [Op.ne]: null
                        }
                    },
                    transaction: t
                })
                // Fetch domain object belonging to url and assign it in url object
                urlInDb.domain = await Domain.findOne({
                    where: {
                        id: urlInDb.domain_id
                    },
                    transaction: t
                }) as Domain;

                // Only create new subject if it does not already exist
                if (!subject || !subjectWithSession) {
                    if (session) {
                        // If session exists, set session_id to its id
                        const data = {
                            type: SubjectType.RECONNAISSANCE,
                            start_url: urlInDb.url,
                            additional_information: add_information,
                            url_id: urlInDb.id,
                            session_id: session.id,
                            domain_id: urlInDb.domain.id
                        }
                        // Check whether subject already exists in the database
                        subjectInDb = await Subject.findOne({
                            where: {
                                ...data
                            },
                            transaction: t
                        })

                        if (!subjectInDb) {
                            // If the subject does not exist in the database, create a new one
                            let screenshotSubject, screenshotFormSubject;
                            // Check whether screenshotting before is enabled and depth requirement is fulfilled (less than max)
                            if (urlInDb.depth! <= config.sessions.screenshotMaxDepth && config.sessions.screenshotBefore) {
                                // If screenshotting before is enabled and depth is okay, findOrCreate new screenshot object with
                                // respective values
                                screenshotSubject = await Subject.findOrCreate({
                                    where: {
                                        type: SubjectType.SCREENSHOT,
                                        status: SubjectStatus.UNVISITED,
                                        start_url: urlInDb.url,
                                        url_id: urlInDb.id,
                                        domain_id: urlInDb.domain.id,
                                        additional_information: {
                                            type: "screenshotBefore",
                                            page_type: "landing_page",
                                        },
                                        session_id: session.id,
                                        ...(worker_id && { worker: worker_id }),
                                    },
                                    include: [
                                        Url, Session
                                    ], transaction: t
                                })
                            }
                            // Check, whether formurl in session information is set
                            if (hasFormurl(add_information)) {
                                // Check, if it is set, and screenshotting of loginpages is requred
                                if (add_information.formurl && config.sessions.includeLoginpages) {
                                    // If yes, findOrCreate new subject for the login form as well
                                    screenshotFormSubject = await Subject.findOrCreate({
                                        where: {
                                            type: SubjectType.SCREENSHOT,
                                            status: SubjectStatus.UNVISITED,
                                            start_url: add_information.formurl,
                                            url_id: urlInDb.id,
                                            domain_id: urlInDb.domain.id,
                                            additional_information: {
                                                type: "screenshotBefore",
                                                page_type: "login_form",
                                            },
                                            session_id: session.id,
                                            ...(worker_id && { worker: worker_id }),
                                        },
                                        include: [
                                            Url, Session, Domain
                                        ], transaction: t
                                    })
                                }
                            }
                            // After potentially creating screenshot entries, create subject entry for recon
                            subjectInDb = await Subject.create({
                                status: SubjectStatus.UNVISITED,
                                ...(worker_id && { worker: worker_id }),
                                ...data
                            }, {
                                include: [
                                    Url, Session, Domain
                                ], transaction: t
                            })
                            // If it was successfully created and screenshots were scheduled before, add recon subject
                            // to screenshot related subject list
                            if (subjectInDb && screenshotSubject) {
                                if (screenshotSubject[1]) {
                                    // If screenshot subject was newly created, set recon subject id  related_subject entry in additional information
                                    await Subject.update({
                                        additional_information: {
                                            related_subject: [subjectInDb.id],
                                            ...screenshotSubject[0].additional_information,
                                        }
                                    }, {
                                        where: {
                                            id: screenshotSubject[0].id
                                        },
                                        transaction: t
                                    })
                                } else {
                                    // If screenshot existed already, push recon subject id into related_subject entry in additional information as well
                                    const additional_information = screenshotSubject[0].additional_information;
                                    additional_information.related_subject.push(subjectInDb.id)
                                    // Update subject with new additional information
                                    await Subject.update({
                                        additional_information: additional_information
                                    }, {
                                        where: {
                                            id: screenshotSubject[0].id
                                        },
                                        transaction: t
                                    })
                                }
                            }

                            // If it was successfully created and screenshots were scheduled before, add recon subject
                            // to screenshot related subject list
                            if (subjectInDb && screenshotFormSubject) {
                                if (screenshotFormSubject[1]) {
                                    // Update subject with new additional information
                                    await Subject.update({
                                        additional_information: {
                                            related_subject: [subjectInDb.id],
                                            ...screenshotFormSubject[0].additional_information,
                                        }
                                    }, {
                                        where: {
                                            id: screenshotFormSubject[0].id
                                        },
                                        transaction: t
                                    })
                                } else {
                                    // Push subject in related subject list
                                    const additional_information = screenshotFormSubject[0].additional_information;
                                    additional_information.related_subject.push(subjectInDb.id)
                                    // Update subject with new additional information
                                    await Subject.update({
                                        additional_information: additional_information
                                    }, {
                                        where: {
                                            id: screenshotFormSubject[0].id
                                        },
                                        transaction: t
                                    })
                                }

                            }
                        }
                    } else {
                        const data = {
                            type: SubjectType.RECONNAISSANCE,
                            start_url: urlInDb.url,
                            additional_information: add_information,
                            url_id: urlInDb.id,
                            domain_id: urlInDb.domain.id
                        }
                        // Fetch subject if already exists with given configuration
                        subjectInDb = await Subject.findOne({
                            where: {
                                ...data
                            },
                            transaction: t
                        })
                        // Check if subject already exists in the database
                        if (!subjectInDb) {
                            // If it does not exist, findOrCreate new subject for the screenshot
                            let screenshotSubject;
                            // Check depth requirements of found url whether to add according to configuration 
                            if (urlInDb.depth! <= config.sessions.screenshotMaxDepth && config.sessions.screenshotBefore) {
                                screenshotSubject = await Subject.findOrCreate({
                                    where: {
                                        type: SubjectType.SCREENSHOT,
                                        status: SubjectStatus.UNVISITED,
                                        start_url: urlInDb.url,
                                        url_id: urlInDb.id,
                                        domain_id: urlInDb.domain.id,
                                        additional_information: {
                                            type: "screenshotBefore",
                                            page_type: "landing_page",
                                        },
                                        ...(worker_id && { worker: worker_id }),
                                    },
                                    include: [
                                        Url, Session, Domain
                                    ], transaction: t
                                })
                            }
                            // After potentially creating screenshot entries, create subject entry for recon
                            subjectInDb = await Subject.create({
                                status: SubjectStatus.UNVISITED,
                                ...(worker_id && { worker: worker_id }),
                                ...data
                            }, {
                                include: [
                                    Url, Session, Domain
                                ], transaction: t
                            })

                            // If it was successfully created and screenshots were scheduled before, add recon subject
                            // to screenshot related subject list
                            if (subjectInDb && screenshotSubject) {
                                if (screenshotSubject[1]) {
                                    // If screenshot subject was newly created, set recon subject id  related_subject entry in additional information
                                    await Subject.update({
                                        additional_information: {
                                            related_subject: [subjectInDb.id],
                                            ...screenshotSubject[0].additional_information,
                                        }
                                    }, {
                                        where: {
                                            id: screenshotSubject[0].id
                                        },
                                        transaction: t
                                    })
                                } else {
                                    // If screenshot existed already, push recon subject id into related_subject entry in additional information as well
                                    const additional_information = screenshotSubject[0].additional_information;
                                    additional_information.related_subject.push(subjectInDb.id)
                                    // Update subject with new additional information
                                    await Subject.update({
                                        additional_information: additional_information
                                    }, {
                                        where: {
                                            id: screenshotSubject[0].id
                                        },
                                        transaction: t
                                    })
                                }
                            }
                        }
                    }
                }
            } else {
                // If url entry was created and crawling status was determined to be ignored, show ignore debug message 
                if (urlInDb && urlInDb.crawling_status === CrawlingStatus.IGNORE) {
                    Logging.debug(`(createSubjectFromUrlString) Did not create new URL subject needed for subject creation. Discarding the subject due to the URL ignored.`)
                } else {
                    // Otherwise, url status is either COMPLETE or PROCESSING and therefore show different output message
                    Logging.debug("Subject discard case else 1")
                }

                if (!urlInDb) {
                    Logging.debug(`(createSubjectFromUrlString) Did not create new URL subject needed for subject creation. Discarding the subject due to the URL being not saved.`)
                } else {
                    Logging.debug("Subject discard case else 2 ")
                }
            }
            await t.commit();

            return subjectInDb;
        } catch (err: unknown) {
            console.log(err);
            Logging.error(`(createSubjectFromUrlString) Failed to create new subject. Error: ${(err as Error).toString()}`)
        }

        return null;
    }

    /**
     * Create subject from url object, e.g. used for initialization purposes
     * 
     * @param url Url to create subject for
     * @param type Type of subject to create
     * @param additional_information Additional subject information used in crawl, e.g. exploit data for cxss
     * @param worker_id Id of crawl worker
     * @param session Attached session of subject if exists
     * @param transaction Transaction to write database changes into if present
     * @returns 
     */
    static async createSubjectFromUrl(url: Url, type: SubjectType, additional_information: unknown, worker_id?: number, session?: Session, transaction?: Transaction) {
        let domain;
        // Check if domain attribute is set for the url 
        if (!url.domain) {
            // If it is not set, fetch domain from database
            domain = await Domain.findOne({
                where: {
                    id: url.domain_id
                },
                transaction: transaction
            })
        } else {
            // Otherwise, if domain property is set, retrieve that
            domain = url.domain;
        }
        // Check if session is set 
        if (session) {
            const data = {
                type,
                start_url: url.url,
                url_id: url.id,
                additional_information,
                session_id: session.id,
                domain_id: domain!.id
            }
            // Check if subject exists in database
            let subjectInDb = await Subject.findOne({
                where: {
                    ...data
                }
            })
            if (!subjectInDb) {
                // If subject does not exist in the database, we create it
                let screenshotSubject, screenshotFormSubject;
                if (url.depth! <= config.sessions.screenshotMaxDepth && config.sessions.screenshotBefore) {
                    screenshotSubject = await Subject.findOrCreate({
                        where: {
                            type: SubjectType.SCREENSHOT,
                            status: SubjectStatus.UNVISITED,
                            start_url: url.url,
                            url_id: url.id,
                            domain_id: domain!.id,
                            additional_information: {
                                type: "screenshotBefore",
                                page_type: "landing_page",
                            },
                            session_id: session.id,
                            ...(worker_id && { worker: worker_id }),
                        },
                        include: [Url], transaction: transaction
                    });
                }
                // Check, whether formurl in session information is set
                if (hasFormurl(additional_information)) {
                    // DEPRECATED: Check if formurl is present
                    if (additional_information.formurl) {
                        // If yes, findOrCreate new screenshot subject for the login form as well
                        screenshotFormSubject = await Subject.findOrCreate({
                            where: {
                                type: SubjectType.SCREENSHOT,
                                status: SubjectStatus.UNVISITED,
                                start_url: additional_information.formurl,
                                url_id: url.id,
                                domain_id: domain!.id,
                                additional_information: {
                                    type: "screenshotBefore",
                                    page_type: "login_form",
                                },
                                session_id: session.id,
                                ...(worker_id && { worker: worker_id }),
                            },
                            include: [Url], transaction: transaction
                        });
                    }
                }

                // After potentially creating screenshot entries, create subject entry for recon
                subjectInDb = await Subject.create({
                    status: SubjectStatus.UNVISITED,
                    ...(worker_id && { worker: worker_id }),
                    ...data
                }, { include: [Url, Domain], transaction: transaction });


                // If it was successfully created and screenshots were scheduled before, add recon subject
                // to screenshot related subject list
                if (subjectInDb && screenshotSubject) {
                    if (screenshotSubject[1]) {
                        // Update subject with new additional information
                        await Subject.update({
                            additional_information: {
                                related_subject: [subjectInDb.id],
                                ...screenshotSubject[0].additional_information,
                            }
                        }, {
                            where: {
                                id: screenshotSubject[0].id
                            },
                            transaction: transaction
                        })
                    } else {
                        // Push subject in related subject list
                        const additional_information = screenshotSubject[0].additional_information;
                        additional_information.related_subject.push(subjectInDb.id)
                        // Update subject with new additional information
                        await Subject.update({
                            additional_information: additional_information
                        }, {
                            where: {
                                id: screenshotSubject[0].id
                            },
                            transaction: transaction
                        })
                    }
                }
                // If it was successfully created and screenshots were scheduled before, add recon subject
                // to screenshot related subject list
                if (subjectInDb && screenshotFormSubject) {
                    if (screenshotFormSubject[1]) {
                        // Update subject with new additional information
                        await Subject.update({
                            additional_information: {
                                related_subject: [subjectInDb.id],
                                ...screenshotFormSubject[0].additional_information,
                            }
                        }, {
                            where: {
                                id: screenshotFormSubject[0].id
                            },
                            transaction: transaction
                        })
                    } else {
                        // Push subject in related subject list
                        const additional_information = screenshotFormSubject[0].additional_information;
                        additional_information.related_subject.push(subjectInDb.id)
                        // Update subject with new additional information
                        await Subject.update({
                            additional_information: additional_information
                        }, {
                            where: {
                                id: screenshotFormSubject[0].id
                            },
                            transaction: transaction
                        })
                    }
                }
            }
            return subjectInDb;
        } else {
            const data = {
                type,
                start_url: url.url,
                additional_information,
                url_id: url.id,
                domain_id: domain!.id
            }
            // Fetch subject if already exists with given configuration
            let subjectInDb = await Subject.findOne({
                where: {
                    ...data
                }
            })
            // Check if subject already exists in the database
            if (!subjectInDb) {
                // If it does not exist, findOrCreate new subject for the screenshot
                let screenshotSubject;
                // Check depth requirements of found url whether to add according to configuration 
                if (url.depth! <= config.sessions.screenshotMaxDepth && config.sessions.screenshotBefore) {
                    screenshotSubject = await Subject.findOrCreate({
                        where: {
                            type: SubjectType.SCREENSHOT,
                            status: SubjectStatus.UNVISITED,
                            start_url: url.url,
                            url_id: url.id,
                            domain_id: domain!.id,
                            additional_information: {
                                type: "screenshotBefore",
                                page_type: "landing_page",
                            },
                            ...(worker_id && { worker: worker_id }),
                        },
                        include: [Url], transaction: transaction
                    });
                }
                // After potentially creating screenshot entries, create subject entry for recon
                subjectInDb = await Subject.create({
                    status: SubjectStatus.UNVISITED,
                    ...(worker_id && { worker: worker_id }),
                    ...data
                }, { include: Url, transaction: transaction });

                // If it was successfully created and screenshots were scheduled before, add recon subject
                // to screenshot related subject list
                if (subjectInDb && screenshotSubject) {
                    if (screenshotSubject[1]) {
                        // If screenshot subject was newly created, set recon subject id  related_subject entry in additional information
                        await Subject.update({
                            additional_information: {
                                related_subject: [subjectInDb.id],
                                ...screenshotSubject[0].additional_information,
                            }
                        }, {
                            where: {
                                id: screenshotSubject[0].id
                            },
                            transaction: transaction
                        })
                    } else {
                        // If screenshot existed already, push recon subject id into related_subject entry in additional information as well
                        const additional_information = screenshotSubject[0].additional_information;
                        additional_information.related_subject.push(subjectInDb.id)
                        // Update subject with new additional information
                        await Subject.update({
                            additional_information: additional_information
                        }, {
                            where: {
                                id: screenshotSubject[0].id
                            },
                            transaction: transaction
                        })
                    }
                }
            }
            return subjectInDb;
        }
    }
}

export { SubjectFactory }