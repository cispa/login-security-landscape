# typescript-crawler

This repository contains the typescript crawler used in the client-side XSS and PostMessage security experiments in our IEEE S&P 2024 paper "To Auth or Not To Auth?  
A Comparative Analysis of the Pre- and Post-Login Security Landscape". You can find the final version of the paper [here](#TODO). The crawler uses sessions from the framework for visiting sites in logged-in and logged-out state. Additionally, the crawler supports a demo mode, that allows to run the experiments without having to to setup a ZMQ server for demonstration purposes.

## Docker Setup

In order to run our crawler easily via docker using the sample configuration in demo mode, execute the following command:

```bash
docker-compose up -d --build
```

This command creates a Postgres database and starts a docker container containing the crawlers, with the image being specially prepared for use with playwright version 1.33.0. Then, it runs the crawlers in the default configuration starting the **pmsecurity** experiment. It exposes the following ports:

- `55434`: the Postgres database
- `55903`: the VNC session for headfull access

To change the the VNC password, head into the environment variables and adjust the `VNC_PASSWORD` environment property.

### Running experiments outside of Docker

If you wish to run the experiment outside of the docker container, make sure to adjust all relevant paths in `experiment.sh` - mainly the data path `DATA_PATH` for the artifacts produced by the crawler as well as the path to the foxhound binary in case you wish to run the client-side XSS experiment. Additionally, make sure to fetch the required submodules and install all dependencies as in the `Dockerfile`.

## Performing an experiment

For our work, we distinguish between the modules:

- **cxss**: Containing the code for the client-side XSS experiment
- **pmsecurity**: Containing the code for the PMForce experiment

### 1. Preparing an experiment

In order to run experiments, open the shell script `experiment.sh` and configure all options in there for your needs. Additionally, it might be necessary to adjust further properties in the `config/index.ts` file. In that file, you can specify options of the crawler concerning how to perform the crawl such as crawling timeouts.

#### Choosing the experiment to run
- To perform the **cxss** experiment, head into the `docker-compose.yml` file and set the experiment environment variable `EXPERIMENT` to `cxss`.
- To perform the **pmsecurity** experiment, set the environment variable `EXPERIMENT` to `pmsecurity`. It is enabled by default in the docker configuration.

#### Preparing the database and environment

You should not change the provided database configuration if you plan on using the docker setup, since it relies on internal networking between the docker containers. However, if you wish to run the experiments outside of docker, copy the `.env.example` to `.env` and adjust the variables accordingly to reflect your setup. Make sure all environment variables are available in the shell script as well. Note, that our experiment script creates a new database for the experiment, therefore the `POSTGRES_DB` environment variable should not be set in the `.env` file. The environment variable is set by our script, which extends the `.env` file with the database name.

[!WARNING] In case of `SequelizeConnectionAcquireTimeoutError` errors, head to `database/db.ts` and configure the connection pool for the database connection. We hardcoded the values we used for our setup in the pool definition, specifying min, max numbers of connections and acquire timeout. The location to adjust is marked with a `// NOTE` comment.

[!WARNING]
Lastly, if you are performing a headfull crawl (using the `--headfull` option in the `spawn.sh` script, on by default), also make sure to set the `$DISPLAY` variable in your environment accordingly.

##### Fetching the required submodules

We use additional submodules for both experiments. This is automatically performed in our provided `Dockerfile`. Before starting the experiments, we first fetch the git submodules by running:

```bash
git submodule update --init --recursive
```

Afterwards, depending on your experiment you need to further install dependencies. Head into the `Dockerfile` to see the respective list of dependencies you need to fetch for the respective experiment.

##### Configuring the ZMQ listener

To configure the ZMQ listener interval at which new sessions are attempted to be fetched from the account framework, head into the `experiment.sh` file and specify the `ZMQ_FETCH_INTERVAL` variable. This value is specified in seconds and should be adjusted to your processing needs, keeping session expiration and the expected time a new session will be available, in mind. After these intervals, the listener tries to fetch new sessions, **but only** if there are workers able to work on new sessions.

##### Starting the demo mode
To start the experiment in demo mode, set the `DEMO_MODE` environment variable to `true` prior to running `experiment.sh`. This is enabled by default in our Docker setup.

##### Using a sample `.csv` file or hardcoded examples without sessions

To test out functionality locally without ZMQ, head over to the `experiment.sh` file and give the call to `./prepare.sh` the option `--fill` and `--csv [file]`. A sample command is specified in the provided script. Since there is no ZMQ connection necessary, set the environment variable `ZMQ_ENABLE` to `false`.
###### Hard-coded sample pages

If you do not want to produce a CSV for sample files, you can head to `setup/database-fill.ts` and enter sample pages manually. For testing during development, we have already some sample test cases from previous work hard coded there. To use these constants, only specify the `--fill` option for the prepare script. 

**Note:** you will need to setup the insecure web server for using the provided hardcoded example sites. For that, head to `snippets/insecure-webpages` and first perform `npm install` to fetch dependencies (`express`). 
- If you use the `experiment.sh` script, simply set the `START_INSECURE_WEBSERVER` environment variable to `true` (after making sure that the dependencies have been fetched). 
- To manually start the webserver run `node snippets/insecure-webpages/server.js` from the project root.

##### Tear-down/killing an experiment

If you add your own module code, you can add further commands in the `experiment-stop.sh` to setup cleanup commands for killing running processes. For this, extend the kill script with a clause for handling terminating your module by its name name and in there kill any sub processes as necessary.

##### Adjusting `--max-old-space-size` for crawlers

If you need to change the memory limit of the node process for crawlers, you need to first modify the value in the `experiment.sh` script **and** then additionally change it in the `experiment-stop.sh` script, since it is used for finding the processes to kill when stopping the experiment. Lastly, if you want to adjust this option for the spawned crawlers from the main script started in the `experiment.sh`, you need to head to the `main.ts` file and update the value in line 25, where the subprocess for crawlers is spawned.

[!IMPORTANT]
If you do not update all occurrences of `--max-old-space-size` in the code, the `pgrep` command might not find the right process to kill. This might cause unwanted effects/not kill the expected proceess(es) when terminating the crawl.

#### Configuring the `cxss` experiment

To run the `cxss` experiment, head to your environment variables and change the value of the variable `EXPERIMENT` to `cxss`. To run the experiment, it is necessary to supply the firefox browser engine option `--firefox` to the spawned crawlers and link to the Foxhound browser using `--browser_executable_path`. The sample experiment script contains an example of how to start the `cxss` script, making it only necessary to change the experiment name in the Docker setup.

[!IMPORTANT]
To receive taint information, it is required to start the crawlers with the firefox browser engine option `--firefox` and specify `--browser_executable_path` to set the path to your foxhound binary. We used Foxhound/Firefox version 109.0, the source code can be found at [project-foxhound](https://github.com/SAP/project-foxhound). These options are added in the call to `spawn.sh`, where the crawler code is started.

##### Obtaining the foxhound browser engine

- If you compile the engine yourself, you have to make sure to perform the appropriate modifications written in the Github Wiki to prepare the engine for use with Playwright.
- When using the Docker setup and performing the `cxss` experiment, the browser engine is compiled during the build of the container. As we have to clone the foxhound repository and install necessary dependencies, expect this process to take longer (around 1 hour).

##### The exploit generator

The client-side XSS experiment leverages the exploit generator from "Don’t Trust The Locals: Investigating the Prevalence of Persistent Client-Side Cross-Site Scripting in the Wild" by Steffens et al., which is hosted at [persistent-clientside-xss](https://github.com/cispa/persistent-clientside-xss). To use in our experiments, we had to modify the generator in according to our needs. The fork of the original project is located at [persistent-clientside-xss-for-login-security](https://github.com/thelbrecht/persistent-clientside-xss-for-login-security) with our changes being stated in the repositories `README.md` file. 

[!IMPORTANT]
The generator uses an externally hosted script in case of exploits with the `script.src` sink. You might need to change it to point to your own location (change `SCRIPT_SOURCE_HOSTNAME` in `config.py`), serving the payload script that invokes the `DOMXSSVerify()` function. If you decide to rename this payload in our experiment, you have to change it in the exploit generator as well as in the script that invokes the generator in the `modules/cxss.ts` script (see `// NOTE` comments).

#### Configuring the `pmsecurity` experiment

For `pmsecurity`, head to your environment variables and change the value of the variable `EXPERIMENT` to `pmsecurity`. Since we use Playwrights's built-in Chromium browser, we next only need to extend the call to `spawn.sh` with `--chromium`. The sample experiment script contains an example of how to start the `pmsecurity` script, you just need to modify the module name.

#### PMForce

We use the in-browser pipeline developed by Steffens et al. in their paper "PMForce: Systematically Analyzing postMessage Handlers at Scale" hosted currently at https://github.com/mariussteffens/pmforce/tree/master. It is included as a git submodule, which is fetched during preparation of the crawl.

### 2. Starting an experiment

To start your experiment, simply execute your crafted `experiment.sh` script, which starts the processes in the background and leaves them running. The script first prepares your database and then asks whether to start the crawlers (answer with y/n to start crawler processes). If you wish to directly start the crawl without confirming prior to starting the crawlers, execute `experiment.sh -y` to skip manual input.

After all crawlers are started, it then starts the ZMQ listener if enabled. By default, the crawlers run forever and attempt to fetch new work from the database, however this functionality can be toggled by removing the `--forever` option in the call to `spawn.sh`.

[!WARNING]
If you do not use the docker setup, make sure to specify the required environment variables for the shell script accordingly (as visible in the `docker-compose.yml` file)

### 3. Stopping an experiment

For stopping an experiment, execute the `experiment-stop.sh` script with the name of your module as an argument. To access the containers shell, run:

```bash
docker exec -u typescriptcrawler -it typescript-crawler  /bin/bash
```

Afterwards, you can run the script:

- For stopping the `cxss` experiment, run `./experiment-stop.sh cxss`
- For stopping the `pmsecurity` experiment, run `./experiment-stop.sh pmsecurity`

### 4. Performing analysis
In the file `snippets/analysis.ts` we prepared code interacting with the database for analysis purposes. In order to perform the analysis after the crawl, run the provided shell script `experiment-analysis.sh` and specify the module:
- For cxss, run: `./experiment-analysis.sh cxss`
- For pmsecurity, run: `./experiment-analysis.sh pmsecurity`

You can add further analysis code, with each experiments table structure being inside its module implementation (specifically the `setup` method). The crawl artifacts, logs and the screenshots are stored at `/typescript-crawler-data/crawl_[TIMESTAMP]`, where `TIMESTAMP` is the time of starting the crawl.

[!WARNING]
Before performing analysis, make sure to kill all running processes relating to the crawl. Additionally, it is import to prune invalid results such as failed tasks due to network issues by sanitizing the data first.

## Folder Structure

    .
    ├── config                      # Configuration options for the crawler
        ├── index.ts                # Options for the crawler for configuration (crawl behavior, timeouts, ...)
        ├── parser.ts               # Command-line arguments read via argparse
    ├── crawler                     # Crawler source code
        ├── index.ts                # Actual crawler model
        ├── taskqueue.ts            # Queue for managing subjects (= tasks) the crawler can add tasks to and get from
        ├── visit.ts                # Visit (= perform) a task with the crawler (given as argument)
    ├── database                    # Database interface, models (sequelize). Credentials are defined via environment variables
        ├── models                  # Models for database setup (relevant table definitions for general crawler without modules)
        ├── db.ts                   # Database connection setup & pool configuration
    ├── modules                     # Crawl module code (for both experiments: cxss & pmsecurity)
    ├── setup                       # Setup scripts
        ├── database-fill-csv.ts    # Setup scripts for filling database with .csv file
        ├── database-fill.ts        # Initiating database with hardcoded examples
        ├── index.ts                # General setup script, calling crawler setup (modules), calling fill scripts, creating the datapath
        ├── prepare.sh              # Preparation script (checking whether log folders are empty and starts setup/setup.ts)
        ├── spawn.sh                # Script that starts multiple crawlers (number specified by arguments as well as craler arguments, just passed)
    ├── snippets                    # Additional code for modules and more
        ├── cxss                    # Clientside XSS helper code (exploit generator, ...)
        ├── pmsecurity              # PMForce repository if initialized
        ├── insecure-webpages       # Small webserver serving hardcoded examples for testing if enabled (START_INSECURE_WEBSERVER flag)
        ├── analysis.ts             # Sample analysis code to be run after the crawl
    ├── types                       # Type definitions
    ├── utils                       # Various util functions
        ├── factories               # Helper modules for creating subjects, domains, url in database
        ├── zmq                     # Command-line arguments read via argparse
            ├── zmq-listener.ts     # Listener script that fetches session from ZMQ connection
            ├── zmq-wrapper.ts      # Wrapper for ZMQ calls called from listener, also contains demo ZMQ server
    ├── docker-compose.yml          # Docker compose for simple startup
    ├── Dockerfile                  # Dockerfile for building container
    ├── experiment-analysis.sh      # Starts the experiment analysis script
    ├── experiment-stop.sh          # Terminate all running crawlers (specify experiment name as argument to stop child processes)
    ├── experiment.sh               # Script that starts experiment (database setup, start crawlers, zmq listener)
    ├── index.ts                    # Main entry point for experiment (starts process that fetches tasks from database and starts crawler process: crawler/visit.ts)
    ├── package-lock.json           # Dependency lock file
    ├── package.json                # Dependency files, project information
    ├── README.md
    └── tsconfig.json
