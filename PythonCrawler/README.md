# PythonCrawler

PythonCrawler is a Python-based extendible and modular crawling framework that uses the [Playwright](https://playwright.dev/) browser automation tool.

## Installation and Setup

### Requirements

1. [Python3](https://www.python.org/downloads/)
2. [Docker](https://docs.docker.com/get-docker/)
3. Any VNC viewer, e.g., [realvnc](https://www.realvnc.com/de/connect/download/viewer/)

### Installation

1. Run `python3 create_secrets.py` file and edit the default passwords in the `secrets` directory.
2. Build the container with `docker compose up -d --build`
3. After the docker container launches, wait for it to complete the database and VNC setup
4. Open a shell within the docker container to interact with it: `docker compose exec -u pycrawler -it pycrawler /bin/bash`
5. Optional: Open a shell and monitor the logs of the crawler: `docker compose exec -u pycrawler -it pycrawler tail -f ./logs/*.log`
6. Optional: Connect to the VNC container at `localhost:55900`
7. Optional: Connect to the database at `localhost:55433`

## Usage

**Important:** All of the following commands assume they are executed within the docker container.

### Demo Mode

You can start the Javascript (`./demo/demo_inclusion.sh`) and Header (`./demo/demo_headers.sh`) experiment in a demonstration mode without setting up the account framework and registering accounts. Thus, the experiments will run in logged-out mode twice as the sessions are not valid. Still, this can be used to see how the experiments can be ran and what data the experiments produce.

The experiment results are stored in a PostgreSQL database.

Run the `./demo/demo_analysis.sh` script to start a jupyter notebook instance. You can connect to it through http://localhost:58888. There you can view and execute the `./demo/analysis/Headers.ipynb` and `./demo/analysis/Inclusion.ipynb` jupyter files to see a demonstration of how the data analysis can be done.

### Starting the Crawl

Edit the `config.py` file if needed to specify the ZMQ socket and additional crawling parameters.

Start the `python3 load_sessions.py` process in the background. It automatically queries the ZMQ API endpoint for an account. After it successfully receives an account, it automatically creates two task, one with a fresh session and one with a session being logged-in (by loading the account's cookies and local storage). Session unlocking is handled automatically in `main.py`, and session loading happens automatically in `crawler.py`.

Start the actual crawler with `python3 main.py`. Running `python3 main.py -h` shows additional options:
```
usage: main.py [-h] [-o LOG] [-m [MODULES ...]] -j JOB -c CRAWLERS [-i CRAWLERID] [-l]

options:
  -h, --help            show this help message and exit
  -o LOG, --log LOG     path to directory where output log will be saved
  -m [MODULES ...], --modules [MODULES ...]
                        which modules the crawler will run
  -j JOB, --job JOB     unique job id for crawl
  -c CRAWLERS, --crawlers CRAWLERS
                        how many crawlers will run concurrently
  -i CRAWLERID, --crawlerid CRAWLERID
                        starting crawler id (default 1); must be > 0
  -l, --listen          crawler will not stop if there is no task (useful for the use with the account framework where tasks are slowly coming in)
  ```

For example, to start the headers experiment with two concurrent crawlers, run: `python3 main.py --modules HeadersExperiment --job test --crawlers 2 --listen`.

Crawler logs and screenshots are saved in the `./logs` directory.

### Accounts and the Account Framework

The `load_sessions.py` script makes use of the account framework API and its capabilities to automatically query it and retrieve account sessions. Start the script `load_sessions.py` in the background, then launch the crawl from the `main.py` script: `python3 load_sessions.py --job test --crawlers 2 & python3 main.py --modules HeadersExperiment --job test --crawlers 2 --listen`. Use the same job name and number of crawlers for both `load_sessions.py` and `main.py`.

The Python Crawler runs inside a Docker container, therefore it needs additional configuration to query the account framework. If you run the account framework in Docker, you are already set up! By default, the crawler queries the docker network `accf-auto:5555`, which we map directly to the account framework's API.

## Inventory
- [create_secrets.py](create_secrets.py): Create the secrets files with default values
- [docker-compose.yaml](docker-compose.yaml): Docker Compose file to start the Python Crawler (crawler and database)
- [Dockerfile](Dockerfile): Dockerfile to build the worker containers 
- [README.me](README.md): This file
- `secrets/`: Settings and tokens for the Python Crawler that should not be shared
  - [db_password.txt](secrets/db_password.txt): The database password file
  - [vnc_password.txt](secrets/vnc_password.txt): The VNC password file
- `src/`: Contains the actual Python Crawler implementation
  - [entrypoint.sh](src/entrypoint.sh): Shell script run at start of the container
  - [config.py](src/config.py): Configuration file of the crawler
  - [crawler.py](src/crawler.py): Script that contains the actual crawler implementation
  - [database.py](src/database.py): Script that is an interface for the communication with the PostgreSQL database
  - [load_sessions.py](src/load_sessions.py): Script that automatically queries the ZMQ endpoint and loads sessions
  - [main.py](src/main.py): Script that starts and manages the crawlers
  - [requirements.txt](src/requirements.txt): Python library requirements for the Python Crawler
  - [utils.py](src/utils.py): Script that includes various utilities for the Python Crawler
  - `modules/`: Folder with various modules that the crawler makes use of
    - [module.py](src/modules/module.py): Interface for creating crawler modules
    - [collecturls.py](src/modules/collecturls.py): Module for collecting URLs
    - [feedbackurl.py](src/modules/feedbackurl.py): Module for recording visited URL information
    - [headersexperiment.py](src/modules/headersexperiment.py): Module for the headers experiment
    - [inclusionissues.py](src/modules/inclusionissues.py): Module for the inclusion experiment
    - [login.py](src/modules/login.py): Module for login-related stuff
  - `resources/`: Folder with JavaScript files used for the script inclusion experiment
  - `demo/`: Folder with demo files
    - [demo_analysis.sh](src/demo/demo_analysis.sh): Script that starts up the demo jupyter server
    - [demo_headers.sh](src/demo/demo_headers.sh): Script that starts the demo headers experiment
    - [demo_inclusion.sh](src/demo/demo_inclusion.sh): Script that starts the demo scrip inclusions experiment
    - [demo_session.py](src/demo/demo_session.py): Script that creates dummy sessions for the demo mode
    - `/headers`: Fodler with demo configuration file for the headers experiment
    - `/inclusions`: Folder with demo configuration file for the script inclusions experiment
    - `/analysis`: Folder with jupyter demo analysis files for the headers and script inclusions experiment
