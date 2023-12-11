import { Op, Transaction } from "sequelize";
import { Domain } from "../../database/models/domain";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const parser = require('tld-extract')


class DomainFactory {
    /**
     * Create a domain object from given URL string if it does not exist. If it exists, returns domain object from database belonging to
     * extracted domain.
     * 
     * @param url Url to extract domain from
     * @param url_count Initialization value for existing URLs for that domain
     * @param rank Rank of the domain (unused)
     * @param session_id Session Id if crawling with session
     * @param transaction Transaction to append changes to
     * @returns Domain object
     */
    static async createDomainFromUrl(url: string, url_count: number, rank: number, session_id?: number, transaction?: Transaction) {
        const parseUrlData = parser(url, { allowUnknownTLD: true });
        const domain = parseUrlData.domain;

        // Check if domain object exists in db
        let domainInDb = await Domain.findOne({
            where: {
                name: domain,
                ...(session_id && {
                    session_id: session_id
                }),
                ...(!session_id && {
                    session_id: {
                        [Op.eq]: null
                    }
                })
            },
            transaction: transaction
        })

        if (!domainInDb) {
            // If entry does not exist, create entry in database
            domainInDb = await Domain.create({
                name: domain,
                url_count: url_count,
                rank: rank,
                ...(session_id && { session_id: session_id })
            }, { transaction: transaction })
            return domainInDb;
        } else {
            return domainInDb;
        }
    }
}

export { DomainFactory }