# PyCrawler

PyCrawler is a Python-based extendible and modular crawling framework that uses the [Playwright](https://playwright.dev/) browser automation tool.

## Requirements
1. Docker
2. A VNC viewer (e.g. RealVNC)

## Installation Instructions
1. Run `python create_secrets.py` file and edit the default passwords in the `secrets` directory.
2. Build the container with `docker compose up -d --build`
3. After the docker container launches, wait for it to complete the database and VNC setup
4. Connect to the VNC container at localhost:55900 and to the database at localhost:55432

## Demo Mode

You can start the Javascript (`./demo/demo_inclusion.sh`) and Header (`./demo/demo_headers.sh`) experiment in a demonstration mode without setting up the account framework and registering accounts. Thus, the experiments will run in logged-out mode twice as the sessions are not valid. Still, this can be used to see how the experiments can be ran and what data the experiments produce.

The experiment results are stored in a PostgreSQL database.

Run the `./demo/demo_analysis.sh` script to start a jupyter notebook instance. You can connect to it through port 58888. There you can execute the `Headers.ipynb` and `Inclusion.ipynb` jupyter files to see a demonstration of how the data analysis can be done.

## Starting the Crawl
Copy the `config-example.py` to `config.py` and edit it to specify the ZMQ socket and additional crawling parameters.

Start the `python add_tasks.py` process in the background. It automatically queries the ZMQ API endpoint for an account. After it successfully receives an account, it automatically creates two task, one with a fresh session and one with a session being logged-in (by loading the account's cookies and local storage). Session unlocking is handled automatically in `main.py`, and session loading happens automatically in `crawler.py`.

Start the actual crawler with `python main.py`. Running `python main.py -h` shows additional options:
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
  -l, --listen          crawler will not stop if there is no job; query and sleep until a job is found
  ```

For example, to start the headers experiment, run: `python main.py -m HeadersExperiment -j test -c 1`

Crawler logs and screenshots are saved in the `/baf/logs` directory.
