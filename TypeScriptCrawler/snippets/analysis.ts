import { config as dotEnvConfig } from "dotenv";
// Load environment variables
dotEnvConfig()

import config from "../config";
import { sequelize } from "../database/db";
import { Logging } from "../utils/logging";

/**
 * Analysis code for cxss experiment
 */
const cxssAnalysis = async () => {
    let visitedSubjects = await sequelize.query("SELECT COUNT(*) as count FROM subjects WHERE status = 'VISITED';")
    let totalSubjects = await sequelize.query("SELECT COUNT(*) as count FROM subjects;")
    Logging.info(`Visited ${visitedSubjects[0][0].count} / ${totalSubjects[0][0].count} successfully.`)

    // Access the table structure from the method setup in module/cxss.ts
    let confirmedExploits = await sequelize.query("SELECT COUNT(*) as count FROM cxss_exploit WHERE exploitability = 1;")
    Logging.info(`Found ${confirmedExploits[0][0].count} confirmed exploits in the crawl.`)

    // TODO: More meaningful analysis...
}

/**
 * Analysis code for pmsecurity experiment
 */
const pmsecurityAnalysis = async () => {
    let visitedSubjects = await sequelize.query("SELECT COUNT(*) as count FROM subjects WHERE status = 'VISITED';")
    let totalSubjects = await sequelize.query("SELECT COUNT(*) as count FROM subjects;")
    Logging.info(`Visited ${visitedSubjects[0][0].count} / ${totalSubjects[0][0].count} successfully.`)

    // Access the table structure from the method setup in module/pmsecurity.ts
    let numberOfHandlers = await sequelize.query("SELECT COUNT(*) as count FROM handler;")
    Logging.info(`Found ${numberOfHandlers[0][0].count} handlers in total.`)

    // TODO: More meaningful analysis...
}

(async () => {
    if (config.dynamic.module === "cxss") {
        await cxssAnalysis();
    } else if (config.dynamic.module === "pmsecurity") {
        await pmsecurityAnalysis();
    } else {
        Logging.error("Unsupported/missing module name specified for analysis")
    }
})()