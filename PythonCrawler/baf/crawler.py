import json
import os
import pathlib
import pickle
from datetime import datetime
from logging import Logger
from typing import Any, Callable, Dict, List, Optional, Type

import tld
from playwright.sync_api import Browser, BrowserContext, Error, Page, Playwright, Response, sync_playwright

from config import Config
from database import URL, URLDB, Task
from modules.collecturls import CollectURLs
from modules.feedbackurl import FeedbackURL
from modules.module import Module
from utils import get_tld_object, get_url_origin


class Crawler:
    def __init__(self, job: str, crawler_id: int, taskid: int, log: Logger, modules: List[Type[Module]]) -> None:
        # Prepare variables
        self.log: Logger = log
        self.job_id: str = job
        self.crawler_id: int = crawler_id
        self.state: Dict[str, Any] = {}
        self.cache: pathlib.Path = Config.LOG / f"job{self.job_id}crawler{self.crawler_id}.cache"
        self.task: Task = Task.get_by_id(taskid)

        # Load previous state
        if Config.RESTART and self.cache.exists():
            self.log.debug("Loading old cache")
            with open(self.cache, mode="rb") as file:
                self.state = pickle.load(file)
        elif self.task.session is not None:
            self.log.info("Loading session")
            self.state['Context'] = json.loads(self.task.session_data)

        # Prepare rest of variables
        self.landingurl: str = self.task.url
        if get_tld_object(self.landingurl) is None:
            self.log.warning(f"Can't parse URL {self.landingurl}")
            # Delete old cache
            if Config.RESTART and self.cache.exists():
                self.log.debug("Deleting cache")
                os.remove(self.cache)
            return

        self.scheme: str = 'https' if self.landingurl.startswith('https') else 'http'
        self.site: str = tld.get_tld(self.landingurl, as_object=True).fld
        self.origin: str = get_url_origin(tld.get_tld(self.landingurl, as_object=True))
        self.currenturl: str = self.state.get('Crawler')[0] if 'Crawler' in self.state else self.landingurl

        self.rank: int = self.task.rank
        self.depth: int = self.state.get('Crawler')[1] if 'Crawler' in self.state else 0
        self.repetition: int = 1

        self.stop: bool = False

        self.playwright: Playwright = None
        self.browser: Browser = None
        self.context: BrowserContext = None
        self.page: Page = None
        self.urldb: URLDB = URLDB(self)

        if 'URLDB' in self.state:
            self.urldb._seen = self.state['URLDB']
        else:
            self.state['URLDB'] = self.urldb._seen

        # If url was already seen before startup (indicator of crawler crashed) -> mark that URL and all of its repetitions as complete
        if self.urldb.get_seen(self.currenturl):
            URL.update(code=Config.ERROR_CODES['browser_error'], state='complete').where(URL.task==self.task, URL.job==self.job_id, URL.crawler==self.crawler_id, URL.site==self.site, URL.url==self.currenturl, URL.depth==self.depth, URL.state != 'complete').execute()
        else:
            self.urldb.add_url(self.currenturl, self.depth, None)

        # Prepare modules
        self.modules: List[Module] = []
        self.modules += [CollectURLs(self)] if Config.RECURSIVE else []
        for module in modules:
            self.modules.append(module(self))
        self.modules += [FeedbackURL(self)]
        self.log.debug(f"Prepared modules: {self.modules}")

        # Prepare filters
        url_filter_out: List[Callable[[tld.utils.Result], bool]] = []
        for module in self.modules:
            module.add_url_filter_out(url_filter_out)
        self.log.debug("Prepared filters")

    def start_crawl(self):
        # Stop crawler earlier if stop flag is set
        if self.stop:
            if Config.RESTART and self.cache.exists():
                self.log.debug("Deleting cache")
                os.remove(self.cache)
            return

        # Initiate playwright, browser, context, and page
        self.playwright = sync_playwright().start()

        if Config.BROWSER == 'firefox':
            self.browser = self.playwright.firefox.launch(headless=Config.HEADLESS)
        elif Config.BROWSER == 'webkit':
            self.browser = self.playwright.webkit.launch(headless=Config.HEADLESS)
        else:
            self.browser = self.playwright.chromium.launch(headless=Config.HEADLESS)

        self.log.debug(f"Start {Config.BROWSER.capitalize()} {self.browser.version}")

        self.context = self.browser.new_context(
            storage_state=self.state.get('Context', None),
            **self.playwright.devices[Config.DEVICE],
            locale=Config.LOCALE,
            timezone_id=Config.TIMEZONE
        )

        self.page = self.context.new_page()

        # Get the first URL
        url: Optional[URL] = self.urldb.get_url(1)
        self.log.info(f"Get URL {url.url if url is not None else url} depth {url.depth if url is not None else self.depth}")

        # Update variables
        if url is not None:
            self.currenturl = url.url
            self.depth = url.depth
            self.state['Crawler'] = (self.currenturl, self.depth)

        # Save crawler data
        if Config.RESTART:
            with open(self.cache, mode='wb') as file:
                pickle.dump(self.state, file)

        # Main loop
        while url is not None and not self.stop:
            # Initiate modules
            self.log.debug('Invoke module page handler')
            self._invoke_page_handler(url)

            # Repetition loop
            for repetition in range(1, Config.REPETITIONS + 1):
                self.repetition = repetition

                if repetition > 1:
                    url = self.urldb.get_url(repetition)
                    assert(url is not None)

                # Navigate to page
                response: Optional[Response] = self._open_url(url)
                self.log.info(f"Response status {response if response is None else response.status} repetition {repetition}")

                # Run modules response handler
                self.log.debug('Invoke module response handler')
                self._invoke_response_handler([response], url, [datetime.now()], repetition)

            # Get next URL to crawl
            url = self.urldb.get_url(1)
            self.log.info(f"Get URL {url.url if url is not None else url} depth {url.depth if url is not None else self.depth}")

            # Update variables
            if url is not None:
                self.currenturl = url.url
                self.depth = url.depth
                self.state['Crawler'] = (self.currenturl, self.depth)

            # Save crawler data
            if Config.RESTART:
                with open(self.cache, mode='wb') as file:
                    pickle.dump(self.state, file)

            # Close everything (to avoid memory issues)
            self.page.close()
            self.context.close()
            self.browser.close()

            # Re-open stuff
            if Config.BROWSER == 'firefox':
                self.browser = self.playwright.firefox.launch(headless=Config.HEADLESS)
            elif Config.BROWSER == 'webkit':
                self.browser = self.playwright.webkit.launch(headless=Config.HEADLESS)
            else:
                self.browser = self.playwright.chromium.launch(headless=Config.HEADLESS)

            self.context = self.browser.new_context(
                storage_state=self.state.get('Context', None),
                **self.playwright.devices[Config.DEVICE],
                locale=Config.LOCALE,
                timezone_id=Config.TIMEZONE
            )

            self.page = self.context.new_page()

        # Close everything
        self.page.close()
        self.context.close()
        self.browser.close()
        self.playwright.stop()

        # Delete old cache
        if Config.RESTART and self.cache.exists():
            self.log.debug("Deleting cache")
            os.remove(self.cache)

    def _open_url(self, url: URL) -> Optional[Response]:
        response: Optional[Response] = None
        error_message: Optional[str] = None

        # Navigate to URL
        try:
            response = self.page.goto(url.url, timeout=Config.LOAD_TIMEOUT, wait_until=Config.WAIT_LOAD_UNTIL)
            self.page.wait_for_timeout(Config.WAIT_AFTER_LOAD)
        except Error as error:
            error_message = ((error.name + ' ') if error.name else '') + error.message
            self.log.warning(error)

        # Update task status (only for the landing page)
        if url.depth == 0 and self.landingurl == url.url and ((self.repetition == 1) or (self.task.code == Config.ERROR_CODES['response_error'])) and self.depth == 0:
            self.task = Task.get_by_id(self.task.get_id())
            self.task.landing_page = self.page.url
            self.task.code = response.status if response is not None else Config.ERROR_CODES['response_error']
            self.task.error = error_message
            self.task.save()
            #get_screenshot(self.page, (Config.LOG / f"screenshots/{self.site}-{self.job_id}.png"), False)

        return response

    def _invoke_page_handler(self, url: URL) -> None:
        for module in self.modules:
            module.add_handlers(url)

    def _invoke_response_handler(self, responses: List[Optional[Response]], url: URL, start: List[datetime], repetition: int) -> None:
        for module in self.modules:
            module.receive_response(responses, url, self.page.url, start, repetition)
