import { parse } from 'csv-parse';
import { CrawlingStatus } from '../database/models/url';
import { SubjectType } from '../database/models/subject';
import { Logging } from '../utils/logging';
import { DomainFactory } from '../utils/factories/domain-factory';
import { sequelize } from '../database/db';
import { URLFactory } from '../utils/factories/url-factory';
import { SubjectFactory } from '../utils/factories/subject-factory';
import * as fs from "fs";

/**
 * Fill database using CSV values with inlined parsing of CSV
 * @param csvPath 
 */
const fillCsv = async (csvPath: string) => {
    const records: string[] = [];
    // Initialize the csv parser with delimiter
    const parser = parse({
        delimiter: ','
    });
    // Consume all records from readable and store in array
    parser.on('readable', function () {
        let record;
        while ((record = parser.read()) !== null) {
            records.push(record);
        }
    });
    // Catch errors during parsing of the CSV
    parser.on('error', function (err) {
        console.error(err.message);
    });
    // On end, write all found URL records to database using factory functions
    parser.on('end', async function () {
        const t = await sequelize.transaction();

        try {
            for (let index = 0; index < records.length; index++) {
                const element = records[index];
                const domain = await DomainFactory.createDomainFromUrl(`https://${element[1]}`, 0, parseInt(element[0]), undefined, t);
                const url = await URLFactory.createUrl(`https://${element[1]}`, domain, 0, undefined, t);

                if (url.crawling_status !== CrawlingStatus.IGNORE) {
                    await SubjectFactory.createSubjectFromUrl(url, SubjectType.RECONNAISSANCE, {}, undefined, undefined, t)
                }
            }

            await t.commit();
        } catch (err: unknown) {
            Logging.error(`(fillCsv) Error occured during database setup. Error: ${(err as Error).toString()}`)
            console.log(err)
            await t.rollback();
        }


        Logging.info("Finished csv parsing")
    });

    await fs.createReadStream(csvPath).pipe(parser);
}

export { fillCsv } 