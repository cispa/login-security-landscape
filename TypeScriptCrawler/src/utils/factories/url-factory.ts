import config from "../../config";
import { Domain } from "../../database/models/domain";
import { Session } from "../../database/models/session";
import { CrawlingStatus, Url } from "../../database/models/url"
import { DomainFactory } from "./domain-factory";
import normalizeUrl, { Options } from "normalize-url";
import { Logging } from "../logging";
import { Op, Transaction } from "sequelize";
import crypto from "crypto";

// Normalization configuration for URLs to store
const normalizationOptions: Options = {
    normalizeProtocol: true,
    removeQueryParameters: true,
    stripHash: true
}

/**
 * Prepare given URL with normalization options for storing in the database
 * @param href href to prepare
 * @returns 
 */
const prepareUrl = (href: string) => {
    return normalizeUrl(href, normalizationOptions);
}

/**
 * Compute md5 value for input.
 * 
 * @param input String to compute md5 value for
 * @returns 
 */
const md5 = (input: string) => {
    return crypto.createHash('md5').update(input).digest("hex")
}

class URLFactory {
    /**
     * Create an URL entry in the database: Before, check if URL is already stored in the database and whether the domain maximum 
     * from the configuration does not prevent adding the newly found URL in the database.  If domain maximum is exceeded, simply mark
     * those URLs with crawling status IGNORE. By default, each newly created URL is marked with crawling status INACTIVE. 
     * @param url Url to create DB entry for
     * @param domain Domain that URL belongs to
     * @param depth Depth of URL to be created
     * @param session Session, optional, present if crawler is logged in
     * @param transaction Transaction to add all modifications of the db to
     * @returns Url created from database or existing db entry for that url
     */
    static async createUrl(url: string, domain: Domain, depth: number, session?: Session, transaction?: Transaction) {
        // Calculate a URL hash to quickly check whether relevant url is also present (with normalized value, so stuff 
        // like query parameters are ignored in hash).
        const url_hash: string = md5(prepareUrl(url))
        let urlInDb = await Url.findOne({
            where: {
                url_hash: url_hash,
                ...(session && { session_id: session.id }),
                ...(!session && {
                    session_id: {
                        [Op.eq]: null
                    }
                })
            },
            include: [Domain],
            transaction: transaction
        })
        if (!urlInDb) {
            // Check if domain link maximum is configured
            if (config.links.maximum.domain) {
                // If yes, check if url count of domain is not exceeded
                if (domain.url_count < config.links.maximum.domain) {
                    // If not, create new INACTIVE url
                    urlInDb = await Url.create({
                        url: url,
                        domain_id: domain.id,
                        url_hash: url_hash,
                        depth: depth,
                        crawling_status: CrawlingStatus.INACTIVE,
                        session_id: session?.id
                    }, { transaction: transaction, include: [Domain] })

                    await Domain.update({
                        url_count: domain.url_count + 1
                    }, {
                        where: {
                            id: domain.id
                        }, transaction: transaction
                    })
                } else {
                    // If yes, create new IGNORE url
                    urlInDb = await Url.create({
                        url: url,
                        domain_id: domain.id,
                        url_hash: url_hash,
                        depth: 0,
                        crawling_status: CrawlingStatus.IGNORE,
                        session_id: session?.id
                    }, { transaction: transaction, include: [Domain] })
                }
            } else {
                // If no url limit is set, create INACTIVE url entry
                urlInDb = await Url.create({
                    url: url,
                    domain_id: domain.id,
                    url_hash: url_hash,
                    depth: 0,
                    crawling_status: CrawlingStatus.INACTIVE,
                    session_id: session?.id
                }, { transaction: transaction, include: [Domain] })
            }
        }

        return urlInDb;
    }

    /**
     * Create a new url entry 
     * @param url Url to create entry for
     * @param depth Depth of newly created url
     * @param parent Parent reference of the newly created url
     * @param session Session if crawler is logged in and found the url
     * @param transaction Transaction to append modifications to
     * @returns 
     */
    static async createUrlFromString(url: string, depth: number, parent?: number, session?: Session, transaction?: Transaction): Promise<Url | undefined> {
        // Calculate a URL hash to quickly check whether relevant url is also present (with normalized value, so stuff 
        // like query parameters are ignored in hash).
        const url_hash: string = md5(prepareUrl(url))
        try {
            let urlInDb = await Url.findOne({
                where: {
                    url_hash: url_hash,
                    ...(session && { session_id: session.id }),
                    ...(!session && {
                        session_id: {
                            [Op.eq]: null
                        }
                    })
                },
                include: [Domain],
                transaction: transaction
            })
            if (!urlInDb) {
                // Create domain if not exists, return it if exists (should not happen due to url parent being already in db and doing hostname checks)
                let domain: Domain;
                if (parent) {
                    const parentUrl = await Url.findOne({
                        where: { id: parent }
                    })
                    domain = await Domain.findOne({ where: { id: parentUrl?.domain_id } }) as Domain
                } else {
                    domain = await DomainFactory.createDomainFromUrl(url, 0, -1, session?.id, transaction);
                }

                // Check if room is there by comparing config.links.maximu.domain if set
                if (config.links.maximum.domain) {
                    if (domain.url_count < config.links.maximum.domain) {
                        urlInDb = await Url.create({
                            url: url,
                            domain_id: domain.id,
                            url_hash: url_hash,
                            depth: depth,
                            crawling_status: CrawlingStatus.INACTIVE,
                            session_id: session?.id,
                            parent_id: parent
                        }, { transaction: transaction, include: [Domain] })

                        await Domain.update({
                            url_count: domain.url_count + 1
                        }, {
                            where: {
                                id: domain.id
                            }, transaction: transaction
                        })

                        return urlInDb;
                    } else {
                        urlInDb = await Url.create({
                            url: url,
                            domain_id: domain.id,
                            url_hash: url_hash,
                            depth: depth,
                            crawling_status: CrawlingStatus.IGNORE,
                            session_id: session?.id,
                            parent_id: parent
                        }, { transaction: transaction, include: [Domain] })
                        return urlInDb;
                    }
                } else {
                    urlInDb = await Url.create({
                        url: url,
                        domain_id: domain.id,
                        url_hash: url_hash,
                        depth: depth,
                        crawling_status: CrawlingStatus.INACTIVE,
                        session_id: session?.id,
                        parent_id: parent
                    }, { transaction: transaction, include: [Domain] })

                    return urlInDb;
                }
            } else {
                Logging.debug(`Discarding url=${url} due to it being already in database with hash=${url_hash}`)
                // Since it is already in database, return undefined to not create new subjects since there are already present
                return urlInDb;
            }
        } catch (err: unknown) {
            console.log(err);
        }
    }
}

export { URLFactory }