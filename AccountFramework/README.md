# Account Framework

The Account Framework manages accounts, sessions and tasks for websites to be used by web experiments.
Features:
- Task management and execution:
    - Registration Tasks (manual only)
    - Login Tasks (automated with manual fallback)
    - Validation Tasks (automated with manual fallback)
- Session management:
    - API that delivers valid sessions to experiments
        - By default an experiment receives any available session that was not used by the experiment already
        - Option to receive a session for a specific site (if available) regardless of whether the website was already used
    - Automatically expiry and revalidation of sessions
- Extra:
    - Automated registration and login form finding on CrUX sites
    - Bitwarden-assisted manual mode
    - Demo for quick overview of all features

## Installation and Setup

Please follow the below steps to setup the account framework. After following these steps a working account framework instance should exist that can be used for both the demo mode and the real mode.

### Prerequistes

Prerequistes on the host system (tested on MacOS 14 and Ubuntu 22.04, similar sytems should also work):
- [Python3](https://www.python.org/downloads/)
- [Docker](https://docs.docker.com/get-docker/)
- Any VNC viewer, e.g., [realvnc](https://www.realvnc.com/de/connect/download/viewer/)
- [GMAIL](https://mail.google.com/mail/) account
- Optional but recommended: [Bitwarden](https://vault.bitwarden.com/#/register) account
- RAM: >8GB

### Installation
- First run `python3 create_secrets.py` to generate a secrets directory with passwords and tokens for the database, VNC, GMAIL, the account identity and bitwarden.
    - These files are accessible in the docker containers at `/run/secrets/*`.
    - The GMAIL details in [identity.sh](secrets/identity.sh) have be filled before the first start. 
    - The other files are recommended to be personalized before the first start but it is not strictly required.
    - For changes to propagate, a restart of the docker containers is required. We recommend setting them at the beginning. 
- If Bitwarden should not be used/[bw_env.sh](secrets/bw_env.sh) is not filled, set `use_bitwarden` to false in [docker-compose.yaml](docker-compose.yaml)
- Run `docker compose up -d --build`. After a successful build three containers are running:
    - `accf-auto`: Account Framework API + automated worker, API is running on port `5555`, VNC is running on port `55900` with password [vnc_password.txt](secrets/vnc_password.txt)
    - `worker1`: Container for the first manual worker, VNC is running on port `55901` with password [vnc_password.txt](secrets/vnc_password.txt)
    - `db`: Postgres Database, running on port `55433` on the host (`5432` within docker) with username `postgres` and password [db_password.txt](secrets/db_password.txt). The main database is called `accounts`.

### Setup

Before using the account framework, some manual steps within the containers have to be performed:
- Decide whether to use Bitwarden or not:
    - Without Bitwarden: 
        - Set `use_bitwarden=False` in [docker-compose.yaml](docker-compose.yaml)
        - Run `docker compose restart` if the setting changed
    - With Bitwarden:
        - Create a Bitwarden account at: https://vault.bitwarden.com/#/register
        - Create an API key and copy `bw_client_secret`, `bw_client_id` and `bw_password`` (https://vault.bitwarden.com/#/settings/security/security-keys) to [bw_env.sh](secrets/bw_env.sh)
        - Run `docker compose restart` if the secrets changed
- Connect to the manual worker container with any VNC viewer on port: `55901` and password [vnc_password.txt](secrets/vnc_password.txt)
- Open a terminal on the virtual screen: right click -> applications -> shells -> bash (maximize)
- Within the VNC terminal run: `source /run/secrets/identity && python3 setup_manualmode.py`
    - If Bitwarden mode is active, perform the following steps in the opened Chromium:
        - Pin bitwarden extension: click on the extension icon next to the URL bar; click on the PIN icon; now there should be the bitwarden icon next to the URL bar
        - Login to bitwarden extension: click on the bitwarden icon and login (use the same account as specified in [bw_env.sh](secrets/bw_env.sh))
        - Go to settings: 
            - Set vault timeout to `never` (click yes)
            - Set autofill to `auto-fill on page load` (tick the box)
            - Go to options: untick `Ask to add login`, `Ask to update existing login` (we update with the API outside of bitwarden)
            - Close the bitwarden extension
        - Deactivate the chromium built-in pw manager: go to settings (chrome://settings), search for password manager, select settings, untick `offer to save passwords`
        - Go back to the terminal and click enter to close the browser
    - Always setup GMAIL:
        - Follow the instructions in the terminal and login on GMAIL
        - Close the browser (using X)


## Usage 

In the following, we describe how to use the various features of the account framework.

### Quickstart
Running the following will create a demo identity and some registration and login tasks for both automated workers and the manual mode.
We recommend running it in the beginning to get an overview of the framework. However, the demo mode can result in more than one session for the same website-identity pair. Thus, we recommend cleansing the database before using the account framework for real experiments.
- First open a shell in the account framework container: `docker compose exec -u demouser -it accf-auto  /bin/bash`
- Run `source /run/secrets/identity && python3 demo_task_creation.py` within the shell to create demo login and registration tasks.
- Optional:
    - Connect to the automated worker with any VNC viewer on port `55900` with password [vnc_password.txt](secrets/vnc_password.txt) to watch the automated worker process login and validation tasks. The automated workers automatically run in an endless loop trying to fetch and process tasks.
    - Connect to the database with any database viewer and watch the `login_tasks` and `sessions` tables.
- Perform the demo manual tasks:
    - Connect to the manual worker with any VNC viewer on port `55901` with password [vnc_password.txt](secrets/vnc_password.txt)
    - Open a terminal on the virtual screen: right click -> applications -> shells -> bash (maximize)
    - Run `python3 work_manual.py` and follow the instructions in the terminal (more details about the manual mode below)
- Within the non-VNC terminal run `python3 api_demo.py` to test the client functionality of the API
- Run `docker compose logs --tail 50 accf-auto` to see the logging output of the API and similar

### Preparation (Search for Registration and Login Forms)

The account framework can search for login and registration forms on websites from the CrUX list and automatically create registration tasks for a given identity for sites where both a login and a registration form was discovered.
- Open a shell within the automated worker: `docker compose exec -u demouser -it accf-auto  /bin/bash`
- Run `python3 prepare.py --help` to check the usage and settings of the preparation script.
- For example, run the following to start automatic crawling for registration/login URLs for the first 10 origins of CrUX December 2022: `DISPLAY=:99 python3 prepare.py --count 10 --crux_link https://raw.githubusercontent.com/zakird/crux-top-lists/main/data/global/202212.csv.gz --identity 1`
- Note that CrUX contains origins and only the first one is used per site/etld+1

### Manual Mode

By running `python3 work_manual.py` within a terminal opened in a VNC session on the manual worker, one can start processing manual registration, login, and validation tasks.
In general, the prompt will guide one through the steps to complete each tasks. In addition, we provide some details here:
- Always enter an identifiable name in the beginning such that it is possible to trace back who performed which tasks
- If some entries in the database are incorrect and you cannot change them through the tool, it is possible to change them directly via the database (however this might lead to a broken model state)
- The tool automatically assigns an available task, after every successful or unsuccessful attempt, there is an option to stop. Do not stop within a task.
- The tool will first open one browser window with an email account opened, you need this account to verify registration (or logins) on many sites. The tool will then open another browser window specificly for the current task.
    - If bitwarden is active:
        - Do not close the browser manually but let the CLI handle it
        - The autofill shortcut is CMD/CTRL + Shift + L
        - Login: autofill often works, only click login and fill captchas and similar
        - Register: click on the identity (within the bw extension) once, then click on the login information (within the bw extension), then fill in remaining fields on the site (hopefully none) and click on register
    - If bitwarden is not active: 
        - Close the second browser window manually after each task
        - The tool tries to record everything you do on a website such that it can be used later to optimize the automated tools. This sometimes interferes with the usage of the website. In such cases, the tool gives you an option to redo a task without recording.
- For every task, the tool allows you to enter notes in the end. Please use this fied if something unexpected happened or if no option described the situation correctly.
- Additional notes about Registration Tasks:
    - If the opened page is not a registration page, try to find a registration option on the same-site. If you cannot find one or it is on another site, close the browser and leave a comment in the notes. Otherwise continue with the task and leave a comment in the notes as well.
    - If it is a registration page, try to register using the given account details.
        - Try to create a fully working account, i.e., verify the mail, accept cookies, step through any setup actions that are necessary
            - Try to not accept spam mails and similar, opt-out of everything possible except for cookie banners where you should try to click `accept all` and things like `stay logged-in` or `trust this device`.
        - If it is not possible to create a fully working account (e.g, a phone number is required), or it is obviously too much effort (e.g., one has to fill out an 30 minute survey in the beginning), abort creation of the account and select the correct outcome and optionally leave notes.
        - If the email address is not accepted, use the email address without the `+domain` part.
    - If you changed any entries (e.g., the email or password; accidentally or because the default was not accepted): the tool gives you the chance to change them.
- Additional notes about Login Tasks:
    - If the opened page is not a login page, try to search for a login page on the same-site. If none can be found or it is not on the same-site (e.g., login for youtube.com is on google.com), close the browser and leave a comment in the notes. Otherwise, follow the instructions below and leave a note that the initial page was not a login page as well.
    - If the page is a login page, try to log in with the given account details.
        - Try to accept all cookies, `stay logged-in`, dismiss any popup/banners, to arrive at a fully logged-in state
        - Fill out captchas if they appear
        - If there are issues caused by recording, close the browser and selet that there were recording issues. The task will be made available again without recording.

## Inventory
- `app/`: Code of the Account Framework; Some of the below directories are automatically created later by the framework and do not exist in Git.
    - `account_automation/`: Code for the automated login, login oracle, registration and login form finding
        - [findloginforms.py](app/account_automation/modules/findloginforms.py): Login Form finding
        - [findregistrationforms.py](app/account_automation/modules/findregistrationforms.py): Registration Form finding
        - [login.py](app/account_automation/modules/login.py): Automated login and login oracle
        - The other files are helper files or allow running `account_automation` standalone.
    - `auth/`: Contains the session information (cookies + local storage) for each created session.
    - `bitwarden/`: Contains the Bitwarden Browser Extension code
    - `crux/`: Contains local copies of the CrUX Top1M (managed by `prepare.py`)
    - `dirs/`: Contains the Chromium profiles for Bitwarden
    - `login/`, `register/`, `validate/`: Recordings (both HAR and Playwright codegen python files) for manual login/registration/validation attempts (only if recording is active and bitwarden is not active)
    - `logs/`: Contains log files for the API and the automated workers of the account framework as well as of `prepare.py`
    - [api_demo.py](app/api_demo.py): Demo to showcase client usage of the account framework API
    - [api.py](app/api.py): Account framework API
    - [bw_helper.py](app/bw_helper.py): Utility code for Bitwarden integration
    - [config.py](app/config.py): Settings for the `account_automation` code.
    - [create_identity.py](app/create_identity.py): Code to create an account framework identity in the database
    - [Database.md](app/Database.md): Documentation about the account framework database structures
    - [db_documentr.py](app/db_documenter.py): Automatically creates `Database.md`
    - [db.py](app/db.py): Code to manage the Account Framework database models
    - [demo_task_creation.py](app/demo_task_creation.py): Code to add demo tasks to the account framework
    - [entrypoint-unprivileged.sh](app/entrypoint-unprivileged.sh): Shell script run at start of the worker containers
    - [entrypoint.sh](app/entrypoint.sh): Privileged shell script run at start of the worker containers (start Xvfb)
    - [expire_sessions.py](app/expire_sessions.py): Expire sessions that were not used in the last 12 hours
    - [prepare.py](app/prepare.py): Code to run automated registration and login form finding on CrUX websites and automatically creating registration tasks for them
    - [requirements.txt](app/requirements.txt): Requiments file for the containers
    - [run_auto.py](app/run_auto.py): Wrapper to manage the automated workers of the account framework
    - [setup_manualmode.py](app/setup_manualmode.py): Setup code to be able to perform manual tasks: login on GMAIL for email verification and optionally setup Bitwarden
    - [work_auto.py](app/work_auto.py): Automated Worker Code: run automated login and validation tasks (schedules manual tasks if failed)
    - [work_manual.py](app/work_manual.py): Manual Worker Code: run to manually perform registration, login and validation tasks
- `secrets/`: Settings and tokens for the Account Framework that should not be shared
    - [bw_env.sh](secrets/bw_env.sh): Settings related to the Bitwarden-Assisted Mode (usage is optional; if not used set `use_bitwarden` in [docker-compose.yaml](docker-compose.yaml) to false)
    - [db_password.txt](secrets/db_password.txt): Password for the Postgres database
    - [identity.sh](secrets/identity.sh): Information about the used identity (username, password, etc. to be used for new accounts) and GMAIL email address + password (necessary for email verification)
    - [vnc_password.txt](secrets/vnc_password.txt): Password for the VNC instance
    - The folder and files will be generated later.
    - These files are accessible in the docker contairens at `/run/secrets/*`. For changes to propagate a restart of the docker containers is required.
- [create_secrets.py](create_secrets.py): Create the secrets files with default values
- [docker-compose.yaml](docker-compose.yaml): Docker Compose file to start the Account Framework (Auto Worker, Manual Worker, Database)
- [Dockerfile](Dockerfile): Dockerfile to build the worker containers 
- [README.me](README.md): This file
- [seccomp.json](seccomp.json): Security Profile necessary to run Chromium in the container



