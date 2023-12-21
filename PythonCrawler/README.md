# PythonCrawler

PythonCrawler is a Python-based extendible and modular crawling framework that uses the [Playwright](https://playwright.dev/) browser automation tool. The crawler can use sessions from the account framework for visiting sites in logged-in and logged-out state. Additionally, the crawler supports a demo mode, that allows to run the experiments without real sessions for demonstration purposes.
The provided modules `HeadersExperiment` and `InclusionIssues` correspond to experiments `5.2 Security Headers` and `5.3 JavaScript Inclusions` in the paper.

## Installation and Setup

### Prerequisites

Prerequisites on the host system (tested on Ubuntu 22.04, similar systems should also work):
- [Python3](https://www.python.org/downloads/)
- [Docker](https://docs.docker.com/get-docker/)
- Any VNC viewer, e.g., [realvnc](https://www.realvnc.com/de/connect/download/viewer/)

### Installation

- First run `python3 create_secrets.py` file and optionally edit the default passwords in the `secrets` directory.
- Run `docker compose up -d --build` to build and start the crawler and database containers. If successful, the following containers are running:
  - `pycrawler`:
    - Ubuntu container build for Playwright, containing the crawler code and exposing the VNC on port `55902`. The password is stored at [secrets/vnc_password.txt](secrets/vnc_password.txt).
  - `db`:
    - Postgres database containing crawl data, exposed on port `55433` with the password being stored in [secrets/db_password.txt](secrets/db_password.txt)

## Usage

All of the following commands assume they are executed within the docker container. I.e., first run `docker compose exec -u pycrawler -it pycrawler /bin/bash` and run the provided commands in the opened shell.
Optionally, the logs of the crawler can be monitored with the following command on the host: `docker compose exec -u pycrawler -it pycrawler tail -f ./logs/*.log`. In addition, the crawler can be watched by connection to the crawler via VNC on port `55902`.

### Demo Mode

Run `./demo/demo_inclusion.sh` to start the InclusionIssues experiment or `./demo/demo_headers.sh` to run the Headers experiment.
In demonstration mode the experiment runs without the need of setting up the account framework. Thus, the experiments will run in logged-out mode twice with invalid sessions. The demo mode can be used to see how the experiments run and what data the experiments collect.

Optionally run `./demo/demo_analysis.sh` to start a jupyter notebook instance for a demo analysis. Connect to jupyter lab at http://localhost:58888 in a browser on the host system and enter the token printed in the container shell (also retrievable by running `jupyter server list` in the container). In the web interface you can open and execute `Headers.ipynb` and `Inclusion.ipynb` for some demo analysis.

### Real Crawl with Account Framework Sessions

- Optionally edit [config.py](src/config.py) to specify crawling parameters, the default is suitable for the InclusionIssues experiment (either edit in the docker container or rebuild for changes on the host to take effect).
- Run `python3 load_sessions.py --job test --crawlers 2` process in one container shell. It automatically queries the Account Framework API endpoint for sessions. After it successfully receives a session, it automatically creates two task, one with an empty session and one with the receibed logged-in session.
- In another container shell, start the crawler with `python3 main.py`. 
- For example, to start the InclusionIssues experiment with two concurrent crawlers, run: `python3 main.py --modules InclusionIssues --job test --crawlers 2 --listen`.
- Notes:
  - Crawler logs and screenshots are saved in the `./logs` directory.
  - The job and crawlers arguments of `load_sessions.py` and `main.py` have to be identical
  - Run `python3 main.py --help` to see additional options

## Inventory
- `secrets/`: Settings and tokens for the Python Crawler that should not be shared
  - [db_password.txt](secrets/db_password.txt): The database password file
  - [vnc_password.txt](secrets/vnc_password.txt): The VNC password file
- `src/`: Contains the Python Crawler implementation
  - `demo/`: Folder with demo files
    - `/analysis`: Folder with jupyter demo analysis files for the headers and script inclusions 
    - `/headers`: Fodler with demo configuration file for the headers experiment
    - `/inclusions`: Folder with demo configuration file for the script inclusions experiment
    - [demo_analysis.sh](src/demo/demo_analysis.sh): Script that starts up the demo jupyter server
    - [demo_headers.sh](src/demo/demo_headers.sh): Script that starts the demo headers experiment
    - [demo_inclusion.sh](src/demo/demo_inclusion.sh): Script that starts the demo scrip inclusions experiment
    - [demo_session.py](src/demo/demo_session.py): Script that creates dummy sessions for the demo mode
  - `modules/`: Folder with various modules that the crawler makes use of
    - [module.py](src/modules/module.py): Interface for creating crawler modules
    - [collecturls.py](src/modules/collecturls.py): Base module for collecting URLs
    - [feedbackurl.py](src/modules/feedbackurl.py): Base module for recording visited URL information
    - [headersexperiment.py](src/modules/headersexperiment.py): Experiment module for the headers experiment
    - [inclusionissues.py](src/modules/inclusionissues.py): Experiment module for the inclusion experiment
    - [login.py](src/modules/login.py): Base module for authenticated experiments
  - `resources/`: Folder with JavaScript files used for the script inclusion experiment
experiment
  - [config.py](src/config.py): Configuration file of the crawler
  - [crawler.py](src/crawler.py): Script that contains the actual crawler implementation
  - [database.py](src/database.py): Script that is an interface for the communication with the PostgreSQL database
  - [entrypoint.sh](src/entrypoint.sh): Shell script run at start of the container
  - [load_sessions.py](src/load_sessions.py): Script that automatically queries the account framework to receive sessions for experiments
  - [main.py](src/main.py): Script that starts and manages the crawlers
  - [requirements.txt](src/requirements.txt): Python library requirements for the Python Crawler
  - [utils.py](src/utils.py): Script that includes various utilities for the Python Crawler
- [create_secrets.py](create_secrets.py): Create the secrets files with default values
- [docker-compose.yaml](docker-compose.yaml): Docker Compose file to start the Python Crawler (crawler and database)
- [Dockerfile](Dockerfile): Dockerfile to build the crawler container 
- [README.me](README.md): This file
