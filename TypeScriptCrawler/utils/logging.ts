// eslint-disable-next-line @typescript-eslint/no-var-requires
const pinoms = require('pino-multi-stream');


// Create write stream to console (colorized)
const prettyStream = pinoms.prettyStream({
    prettyPrint: {
        colorize: false,
        translateTime: "dd-mm-yyyy, HH:MM:ss",
    },
})

const streams = [
    {
        stream: prettyStream,
    }
]
// Start pino multi stream logger
const logger = pinoms(pinoms.multistream(streams))

class Logging {

    /**
     * Output log message at level INFO to logger
     *
     * @static
     * @param {string} message
     * @memberof Logging
     */
    static log(message: string) {
        logger.info(message)
    }

    /**
     * Output log message at level INFO to logger and to socketIO subscriber
     *
     * @static
     * @param {string} message
     * @memberof Logging
     */
    static info(message: string) {
        logger.info(message)
    }

    /**
     * Output log message at level ERROR to logger
     *
     * @static
     * @param {string} message
     * @memberof Logging
     */
    static error(message: string) {
        logger.error(message)
    }

    /**
     * Output log message at level WARNING to logger
     *
     * @static
     * @param {string} message
     * @memberof Logging
     */
    static warn(message: string) {
        logger.warn(message)
    }

    /**
     * Output log message at level DEBUG to logger
     *
     * @static
     * @param {string} message
     * @memberof Logging
     */
    static debug(message: string) {
        logger.debug(message)
    }
}

export { Logging }