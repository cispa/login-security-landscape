# TypeScriptCrawler

TypeScriptCrawler is a modular, extensible crawler written in Typescript, using [Playwright](https://playwright.dev/) for web experiments. The crawler can use sessions from the account framework for visiting sites in logged-in and logged-out state. Additionally, the crawler supports a demo mode, that allows to run the experiments without real sessions for demonstration purposes.
The provided modules `cxss` and `pmsecurity` correspond to experiments `5.1 Client-Side XSS` and `5.4 PostMessages` in the paper.

## Installation and Setup

### Prerequisites

Prerequisites on the host system (tested on Ubuntu 22.04, similar systems should also work):
- [Python3](https://www.python.org/downloads/)
- [Docker](https://docs.docker.com/get-docker/)
- Any VNC viewer, e.g., [realvnc](https://www.realvnc.com/de/connect/download/viewer/)

### Installation

Please follow the following steps to setup the crawler. We highly recommend configuring both the docker container via the [docker-compose file](docker-compose.yaml) as well as the crawler in the [config/index.ts](src/config/index.ts) file prior to building. After completing all steps, a working crawler instance should exist which can be used for both the [demo mode](#demo-mode) and interaction with the account framework.

- First run `python3 create_secrets.py` to create a directory for secrets containing the credentials for the VNC and database
- Run `docker compose up -d --build` to build and start the crawler and database containers. If successful, the following containers are running:
  - `typescript-crawler`:
    - Ubuntu container build for Playwright, containing the crawler code and exposing the VNC on port `55903`. The password is stored at [secrets/vnc_password.txt](secrets/vnc_password.txt).
  - `typescript-crawler-db`:
    - Postgres database containing crawl data, exposed on port `55434` with the password being stored in [secrets/db_password.txt](secrets/db_password.txt)
    - Every time `experiment.sh` is executed within the `typescript-crawler`, a new database with the name `{cxss|pmsecurity}___{timestamp}` is created.

> [!IMPORTANT]
> Since our build process for the cxss experiment fetches specific dependencies and builds [Foxhound](https://github.com/SAP/project-foxhound), it is **necessary** to configure all relevant options in the [docker-compose.yaml](docker-compose.yaml) prior to building the container. Since the container has to clone the foxhound repository, install necessary dependencies and build Firefox, expect this process to take longer (around 1 hour).

### Setup

Before the experiment, some manual steps preparing the containers have to be performed. General experiment settings can be configured in [docker-compose.yaml](docker-compose.yaml).

- Choose the experiment to start:
  - Set `EXPERIMENT: cxss` to run the client-side XSS experiment
  - Set `EXPERIMENT: pmsecurity` to run the PostMessages experiment
- Decide whether to start the crawlers in demo mode:
  - Set `DEMO_MODE` to `"true"` to use the [demo mode](#demo-mode)
  - Otherwise set it to `"false"` - if the DEMO mode is disabled, the crawlers attempt to fetch sessions from the account framework and it has to be running
- Configure the Account Framework/ZMQ connection if not in DEMO mode:
  - Set `ZMQ_HOST` to point to the account framework. If you are using our Docker setup, do not change this value since we rely on internal Docker networking to access the framework.
  - Adjust `ZMQ_EXPERIMENT` to reflect your experiment name as observed by the account framework. This value is used for instance to keep state which sessions the experiment received and which not.
- Additionally, you can adjust further properties in the [config/index.ts](src/config/index.ts) file. In that file in the container, you can specify crawl settings such as timeouts and number of pages to crawl.

#### Demo Mode

If the demo mode is enabled, it is not necessary to set up the account framework. Since we use empty session data, the crawlers will visit the hardcoded sites twice in logged-out state. This mode allows to inspect how the experiments run and what data they collect.

### Usage

In the following, we describe how to perform an experiment using our crawler. Make sure to have all variables properly set up as described above. First, attach to the crawler container shell by running the following command:

```bash
docker compose exec -u typescriptcrawler -it typescript-crawler  /bin/bash
```

#### Starting an experiment

To start the experiment, run the following within the crawler container:

```bash
./experiment.sh
```

Optional:
  - Add `-y` to skip manual confirmation steps (useful for automation).
  - Connect to the automated worker container with any VNC viewer on port `55903` with password [vnc_password.txt](secrets/vnc_password.txt) to watch the experiment

Running the experiment will first create the necessary database as well as data path for crawl artifacts. Additionally, it builds the crawler code, prepares the database and spawns all crawlers. Lastly, if not in DEMO mode, it starts requesting sessions from the account framework.


> [!NOTE]
> The crawl artifacts, logs and the screenshots are stored at `/typescript-crawler-data/crawl_[TIMESTAMP]`, where `TIMESTAMP` is the time of starting the crawl.

#### Stopping an experiment

Before stopping the experiment, make sure that all crawlers are inactive. The script kills all processes related to the experiment run. To stop a running experiment, run the following command:

```bash
./experiment-stop.sh
```

> [!CAUTION]
> Terminating the experiment when crawlers are writing to the database can lead to inconsistent data points, which then need to be removed before analysis.

#### Running the sample analysis

In the file [src/snippets/analysis.ts](src/snippets/analysis.ts) we prepared code interacting with the database for analysis purposes. In order to execute the analysis after the crawl, run the provided shell script using:

```bash
./experiment-analysis.sh
```

> [!WARNING]
> Before performing the analysis, make sure to kill all running processes relating to the crawl. 

## Inventory

- `secrets/`: Settings and tokens for the TypeScript Crawler that should not be shared
  - [db_password.txt](secrets/db_password.txt): The database password file
  - [vnc_password.txt](secrets/vnc_password.txt): The VNC password file
- `src/`: Crawler source code
  - `config/`: Configuration options for the crawler
    - [index.ts](src/config/index.ts): Options for the crawler for configuration (crawl behavior, timeouts, ...)
    - [parser.ts](src/config/parser.ts): Command-line arguments read via argparse
  - `crawler/:` Crawler model
    - [index.ts](src/crawler/index.ts): Crawler class
    - [taskqueue.ts](src/crawler/taskqueue.ts): Queue for managing subjects (= tasks), which the crawler can add to and get from
    - [visit.ts](src/crawler/visit.ts): Visit (= perform) a task with the crawler (given as argument)
  - `database/`: Database interface and table definitions
    - `models/`: Models for database setup (relevant table definitions for general crawler without modules)
    - [db.ts](src/database/db.ts): Database connection setup & connection pool configuration
  - `modules/`: Crawl module code (for both experiments: cxss & pmsecurity)
  - `setup/`: Setup scripts
    - [database-fill-csv.ts](src/setup/database-fill-csv.ts): Populating the database with .csv file
    - [database-fill.ts](src/setup/database-fill.ts): Initiating database with hardcoded examples
    - [index.ts](src/setup/index.ts): General setup script, calling crawler setup (and module setup), fill scripts and creating the datapath
    - [prepare.sh](src/setup/prepare.sh): Preparation script (checking whether log folders are empty and starts [index.ts](src/setup/index.ts))
    - [spawn.sh](src/setup/spawn.sh): Script that starts multiple crawlers (count specified by arguments passed during invocation)
    - `snippets/`: Additional code for modules and more
      - `cxss/`: Clientside XSS experiment helper code (exploit generator, ...)
      - `insecure-webpages/`: Small webserver serving hardcoded examples for testing if enabled (see `START_INSECURE_WEBSERVER` flag)
      - `pmxss/`: PostMessages experiment helper code (pmforce Repository, ...)
      - [analysis.ts](src/snippets/analysis.ts): Sample analysis code to be run after the crawl
  - `types/`: Type definitions
  - `utils/`: Various helper functions
    - `factories/`: Functions for creating subjects, domains, url in database
    - `zmq/`: Code used for interacting with a ZMQ connection if enabled
      - [zmq-listener.ts](src/utils/zmq/zmq-listener.ts): Listener script that fetches session from ZMQ connection
      - [zmq-wrapper.ts](src/utils/zmq/zmq-wrapper.ts): Wrapper for ZMQ calls called from listener, also contains demo ZMQ server
    - The other typescript files here are helper functions, used for instance for logging or interacting with the database
  - [experiment-analysis.sh](src/experiment-analysis.sh): Starts the experiment analysis script
  - [experiment-stop.sh](src/experiment-stop.sh): Terminate all running crawlers
  - [experiment.sh](src/experiment.sh): Script that starts an experiment (database setup, start crawlers and lastly the zmq listener)
  - [index.ts](src/index.ts): Main entry point for the crawler (starts a process that fetches tasks from database and starts a [visit.ts](src/crawler/visit.ts) process)
  - [package-lock.json](src/package-lock.json): Dependency lock file
  - [package.json](src/package.json): Dependency files, project information
  - [tsconfig.json](src/tsconfig.json)
- [create_secrets.py](create_secrets.py): Generate secret files with default values
- [docker-compose.yaml](docker-compose.yaml): Docker compose to create a postgres and crawler container
- [Dockerfile](Dockerfile): Dockerfile for building the crawler
- [README.me](README.md): This file
