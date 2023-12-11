import config from "../config";
import { sequelize } from "../database/db";
import { Domain } from "../database/models/domain";
import { SubjectType } from "../database/models/subject";
import { CrawlingStatus } from "../database/models/url";
import { DomainFactory } from "../utils/factories/domain-factory";
import { SubjectFactory } from "../utils/factories/subject-factory";
import { URLFactory } from "../utils/factories/url-factory";
import { Logging } from "../utils/logging";

/**
 * Fill database with hard coded sample pages
 */
const fill = async () => {
    const t = await sequelize.transaction();

    try {
        // Create empty domain for DB hierarchy (ignore url value)
        let domain = await DomainFactory.createDomainFromUrl("http://example.com", 0, 0, undefined, t)

        let urls: string[] = [];

        // Define urls list for module (access module name at config.dynamic.module)
        if (config.dynamic.module === "cxss") {
            urls = [
                "http://localhost:3000/cxss/index.html",
                "http://localhost:3000/cxss/cookie.html",
                "http://localhost:3000/cxss/localstorage.html",
                "http://localhost:3000/cxss/script-src.html",
                "http://localhost:3000/cxss/sessionstorage.html"
            ];
        } else if (config.dynamic.module === "pmsecurity") {
            urls = [
                "http://localhost:3000/pm/conditionalOr.html",
                "http://localhost:3000/pm/cookie.html",
                "http://localhost:3000/pm/doubleInjection.html",
                "http://localhost:3000/pm/externalFun.html",
                "http://localhost:3000/pm/forLoopArray.html",
                "http://localhost:3000/pm/ifPropertyExists.html",
                "http://localhost:3000/pm/indexOfOriginCheck.html",
                "http://localhost:3000/pm/lazyExpression.html",
                "http://localhost:3000/pm/localStorageAssign.html",
                "http://localhost:3000/pm/localStorageSetItem.html",
                "http://localhost:3000/pm/multiReplace.html",
                "http://localhost:3000/pm/popupWrite.html",
                "http://localhost:3000/pm/regexMatch.html",
                "http://localhost:3000/pm/regexObj.html",
                "http://localhost:3000/pm/sliceAndSearch.html",
                "http://localhost:3000/pm/ternary.html",
            ]
        }

        // Create DB entries for all urls in question in transaction (if one fails, all fail)
        for (let index = 0; index < urls.length; index++) {
            const element = urls[index];
            const url = await URLFactory.createUrl(element, domain, 0, undefined, t);

            domain = await Domain.findOne({ where: { id: url.domain_id }, transaction: t }) as Domain;
            for (let index = 0; index < 1; index++) {
                if (url.crawling_status !== CrawlingStatus.IGNORE) {
                    await SubjectFactory.createSubjectFromUrl(url, SubjectType.RECONNAISSANCE, {}, undefined, undefined, t)
                }
            }
        }

        await t.commit();
    } catch (err: unknown) {
        Logging.error(`(fill) Error occured during database setup. Error: ${(err as Error).toString()}`)
        await t.rollback();
    }
}

export { fill };