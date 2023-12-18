import { parse } from 'csv-parse';
import { Logging } from '../utils/logging';
import * as fs from 'fs';

/**
 * Read the CSV file at passed file location and return the records stored as objects.
 * 
 * @param csvPath Path of CSV file
 * @param delimiter Delimiter of columns of the csv file to be used
 * @returns 
 */
const readCsv = async (csvPath: string, delimiter?: ',') => {
    return await new Promise<string[]>((resolve, reject) => {
        const records: string[] = [];
        // Initialize the parser
        const parser = parse({
            delimiter
        });
        // Use the readable stream api to consume records
        parser.on('readable', function () {
            let record;
            while ((record = parser.read()) !== null) {
                records.push(record);
            }
        });
        // Catch any error
        parser.on('error', function (err) {
            reject(err);
        });
        // Resolve promise when reading is finished
        parser.on('end', async function () {
            Logging.info("Finished csv parsing")
            resolve(records);
        });

        fs.createReadStream(csvPath).pipe(parser);
    })
}

export { readCsv } 