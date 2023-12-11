import { Logging } from "./logging";

/**
 * Output of benchmark result to debug log
 * @param args 
 */
const benchmark_log = function (...args: unknown[]) {
    const adjusted = ['[typescript-crawler]', '[Benchmark]'];
    Logging.debug([...adjusted, ...args].join(" "))
};

/**
 * Benchmark function to measure execution of methods between its construction and call to stop.
 * Measures time in milli seconds.
 * 
 * @param name Name of the benchmark for outputting
 * @returns Object with stop method to end time measurement
 */
const benchmark = function (name: string) {
    const start = new Date();
    return {
        stop: function () {
            const end = new Date();
            const time = end.getTime() - start.getTime();
            benchmark_log(name, 'finished in', time, 'ms');
        }
    }
};

export { benchmark }