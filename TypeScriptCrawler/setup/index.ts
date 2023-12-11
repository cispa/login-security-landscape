import { config as dotEnvConfig } from "dotenv";
// Load environment variables
dotEnvConfig()

import path from "path";
import fs from "fs";
import config from "../config";

import Crawler from "../crawler";
import { fill } from "./database-fill";
import { fillCsv } from "./database-fill-csv";
import { Logging } from "../utils/logging";
import { exit } from "process";

const setupCrawler = async () => {
    Logging.info(`Started setting up the crawler`)
    try {
        const crawler = new Crawler();
        // Call setup code for crawler that uses setup code from module as well
        await crawler.setup(config.dynamic.module);

        Logging.info(`Finished crawler module setup successfully.`)
    } catch (err: unknown) {
        Logging.error(`Crawler module setup failed. Error: ${(err as Error).toString()}`)
        process.exit(1)
    }

    try {
        // If using fill command, perform database fill with provided csv/const data
        if (config.dynamic.fill) {
            if (config.dynamic.csv) {
                Logging.info(`Filling database with csv from arguments`)
                await fillCsv(path.join(config.dynamic.csv))
            } else {
                Logging.warn(`Filling database with stub data pointing to localhost`)
                await fill();
            }
        }
    } catch (err: unknown) {
        Logging.error(`Crawler fill failed. Error: ${(err as Error).toString()}`)
        process.exit(1)
    }
}

// Checking whether dataPath is empty
Logging.info(`Checking whether dataPath="${config.dataPath}" for crawler exists and is empty...`);

if (!fs.existsSync(config.dataPath)) {
    Logging.error("Specified dataPath does not exist on disk. Should it be recursively created? (yY/nN)");
    process.stdin.on("data", function (data) {
        if (data.toString().toLowerCase().trim() === "y") {
            fs.mkdirSync(config.dataPath, { recursive: true })
            setupCrawler();
        } else {
            exit(1);
        }
    })
} else {
    // Check if dataPath is empty, if not, exist the crawler process
    if (fs.readdirSync(config.dataPath).length !== 0) {
        Logging.error("Provided dataPath is not empty. Abort")
        exit(1);
    } else {
        // If folder is empty, execute setup code
        Logging.warn("Directory exists, but is empty. Using the empty directory.")
        setupCrawler();
    }
}



