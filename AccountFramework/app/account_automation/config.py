import os
import pathlib
from logging import INFO
from typing import Literal, Dict


class Config:
    DATABASE: str = os.environ.get("POSTGRES_DB")  # database name
    USER: str = os.environ.get("POSTGRES_USER")  # database user
    PASSWORD: str = pathlib.Path(os.environ.get("POSTGRES_PASSWORD_FILE")).read_text()  # database password
    HOST: str = os.environ.get("DB_HOST")  # database host
    PORT: str = int(os.environ.get("DB_PORT"))  # database port

    LOG: pathlib.Path = pathlib.Path('./logs/')  # path for saving logs
    LOG_LEVEL = INFO  # DEBUG|INFO|WARNING|ERROR

    BROWSER: Literal['chromium', 'firefox', 'webkit'] = 'chromium'
    DEVICE: str = 'Desktop Chrome'  # A device supported by playwright (https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/server/deviceDescriptorsSource.json)
    LOCALE: str = 'de-DE'
    TIMEZONE: str = 'Europe/Berlin'
    HEADLESS: bool = False  # Headless browser
    RESTART: bool = True  # If the browser crashes, try to restore the crawling process using a
    # cached file and continue with the next URL in line for the domain, otherwise continue with
    # the next domain

    RECURSIVE: bool = True  # Discover additional URLs while crawling
    BREADTHFIRST: bool = True  # Visit URLs in a breadth-first manner, otherwise depth-first
    SAME_ORIGIN: bool = False  # URL discovery for same-origin only
    SAME_ETLDP1: bool = True  # URL discovery for same ETLD+1 only
    SAME_ENTITY: bool = False  # URL discovery for same entity only (ETLD+1 or company, owner, etc.)
    DEPTH: int = 1  # URL discovery limit; 0 (initial URL only), 1 (+ all URLs landing page), etc.
    MAX_URLS: int = 500  # limit number of URLs gathered for a domain

    REPETITIONS: int = 1  # how many times to crawl the same URL and invoke module response handlers

    WAIT_LOAD_UNTIL: Literal['commit', 'domcontentloaded', 'load', 'networkidle'] = 'load'
    LOAD_TIMEOUT: int = 30000  # URL page loading timeout in ms (0 = disable timeout)
    WAIT_AFTER_LOAD: int = 5000  # let page execute after loading in ms
    RESTART_TIMEOUT: int = 600  # restart crawler if it hasn't done anything for ... seconds

    ACCEPT_COOKIES: bool = True  # Attempt to find cookie banners and accept them

    # Usually the code of the response in DB will be the response status (200, 404, etc.); if an
    # error occurs, for example response is NULL or browser is stuck, use the error codes below
    ERROR_CODES: Dict[str, int] = {'response_error': -1, 'browser_error': -2}
