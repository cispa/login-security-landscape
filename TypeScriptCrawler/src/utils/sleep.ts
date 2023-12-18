/**
 * Synchronous sleep method in Javascript as promise
 * As found at: https://stackoverflow.com/a/39914235
 * 
 * @param msec Milliseonds to sleep
 * @returns Promise
 */
const sleep = (msec: number) => {
    return new Promise(resolve => setTimeout(resolve, msec));
}

export { sleep };