import { ArgumentParser } from "argparse";

const parser = new ArgumentParser({ description: 'Configuration options for our typescript crawler & support files.' })

// Crawler configuration options
parser.add_argument('--datapath', { help: 'Specify the data path all crawl artifacts should be stored to.' })
parser.add_argument('--module', { help: 'Select the name of module to use while crawling.' })
parser.add_argument('--user_data_dir', { help: 'Set the directory of user data.' })
parser.add_argument('--chromium', { help: 'Use Chromium for crawl.', action: "store_true" })
parser.add_argument('--firefox', { help: 'Use Firefox for crawl.', action: "store_true" })
parser.add_argument('--browser_executable_path', { help: 'Specify executable path of browser to  use.' })
parser.add_argument('--user_agent', { help: 'Set user agent of browser.' })
parser.add_argument('--headfull', { help: 'Determine whether to run crawler in headfull mode.', action: "store_true" })
parser.add_argument('--forever', { help: 'Keep crawler processes alive and use polling to attempt to fetch new work again.', action: "store_true" })
parser.add_argument('--polling', { help: 'Use polling mechanism for work fetching instead of killing the crawler when no work is returned anymore (in seconds).' })

// Specific visit process options
parser.add_argument('--crawler', { help: 'Spawned crawler id.' })
parser.add_argument('--subject', { help: 'Next subject id for the crawler.' })

// Setup configuration options
parser.add_argument('--fill', { help: 'Fill database with default data for testing.', action: "store_true" })
parser.add_argument('--csv', { help: 'Path to csv containing domain list to be crawled.' })

// ZMQ listener configuration
parser.add_argument('--crawlers', { help: 'Number of crawlers that should work in parallel.', type: "int" })
parser.add_argument('--fetchinterval', { help: 'Interval between which sessions are fetched (in seconds).', type: "int" })
parser.add_argument('--zmqlist', { help: 'Path to list of sites to request from zmq.' })
parser.add_argument('--demo', { help: 'Start crawler in demo mode.', action: "store_true" })

export default parser;