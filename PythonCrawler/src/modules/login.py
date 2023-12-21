import re
from datetime import datetime
from logging import Logger
from typing import Callable, List, Optional, Tuple

import tld
from peewee import BooleanField, IntegerField, TextField
from playwright.sync_api import Error, Page, Response, sync_playwright

from config import Config
from database import URL, BaseModel, database
from modules.module import Module
from utils import get_screenshot, get_url_full_with_query_fragment


class LoginForm(BaseModel):
    job = TextField()
    crawler = IntegerField()
    site = TextField()
    depth = IntegerField()
    formurl = TextField()
    formurlfinal = TextField()
    success = BooleanField(null=True)


class Login(Module):
    ERROR_MESSAGE: str = r"(\W|^)(incorrect|wrong|falsch|fehlerhaft|ungültig|ungueltig|" \
                         r"not match|stimmt nicht|existiert nicht|doesn't match|doesn't exist|" \
                         r"not exist|isn't right|not right|nicht richtig|fail|fehlgeschlagen|" \
                         r"wasn't right|not right)(\W|$)"

    LOGOUTKEYWORDS = r'log.?out|sign.?out|log.?off|sign.?off|exit|quit|invalidate|ab.?melden|' \
                     r'aus.?loggen|ab.?meldung|verlassen|aus.?treten|annullieren'

    def __init__(self, crawler) -> None:
        super().__init__(crawler)

        self.loginsuccess: bool = False
        self.endsuccess: Optional[bool] = None
        self.loginurl: Optional[str] = None
        self.account: Optional[Tuple[str, str, str, str, str]] = None

        # Initiate login if neeeded
        if 'Login' in self.crawler.state:
            self.loginsuccess = True
            self.loginurl = self.crawler.state['Login']
        else:
            self.setup()
    
    def setup(self) -> None:
        # Initiate playwright, browser, context, and page
        playwright = sync_playwright().start()

        if Config.BROWSER == 'firefox':
            browser = playwright.firefox.launch(headless=Config.HEADLESS)
        elif Config.BROWSER == 'webkit':
            browser = playwright.webkit.launch(headless=Config.HEADLESS)
        else:
            browser = playwright.chromium.launch(headless=Config.HEADLESS)

        # Create login context
        context = browser.new_context(
            storage_state=self.crawler.state.get('Context', None),
            **playwright.devices[Config.DEVICE],
            locale=Config.LOCALE,
            timezone_id=Config.TIMEZONE
        )

        page = context.new_page()

        # Log in (in our experiment it's just a stub)
        self.loginsuccess = True
        loginform: Optional[LoginForm] = LoginForm.get_or_none(site=self.crawler.site, success=True)
        loginform = loginform or LoginForm.get_or_none(site=self.crawler.site)
        self.loginurl = loginform.formurl if loginform is not None else None
        self.crawler.state['Login'] = self.loginurl

        # Check if login is successful
        if (not self.loginsuccess) or (self.crawler.task.session is None):
            page.close()
            context.close()
            browser.close()
            playwright.stop()
            return

        # Navigate and make login screenshots
        try:
            page.goto(self.crawler.landingurl, timeout=Config.LOAD_TIMEOUT, wait_until=Config.WAIT_LOAD_UNTIL)
            page.wait_for_timeout(Config.WAIT_AFTER_LOAD)
        except Error as error:
            self.crawler.log.warning(error)
        finally:
            get_screenshot(page, (Config.LOG / f"screenshots/{self.crawler.site}login1.png"), False)

        if self.loginurl:
            try:
                page.goto(self.loginurl, timeout=Config.LOAD_TIMEOUT, wait_until=Config.WAIT_LOAD_UNTIL)
                page.wait_for_timeout(Config.WAIT_AFTER_LOAD)
            except Error as error:
                self.crawler.log.warning(error)
            finally:
                get_screenshot(page, (Config.LOG / f"screenshots/{self.crawler.site}login2.png"), False)

        # Close resources
        page.close()
        context.close()
        
        # Create fresh context
        context = browser.new_context(
            storage_state=None,
            **playwright.devices[Config.DEVICE],
            locale=Config.LOCALE,
            timezone_id=Config.TIMEZONE
        )

        page = context.new_page()

        # Navigate and make fresh context screenshots
        try:
            page.goto(self.crawler.landingurl, timeout=Config.LOAD_TIMEOUT, wait_until=Config.WAIT_LOAD_UNTIL)
            page.wait_for_timeout(Config.WAIT_AFTER_LOAD)
        except Error as error:
            self.crawler.log.warning(error)
        finally:
            get_screenshot(page, (Config.LOG / f"screenshots/{self.crawler.site}login7.png"), False)
        
        if self.loginurl:
            try:
                page.goto(self.loginurl, timeout=Config.LOAD_TIMEOUT, wait_until=Config.WAIT_LOAD_UNTIL)
                page.wait_for_timeout(Config.WAIT_AFTER_LOAD)
            except Error as error:
                self.crawler.log.warning(error)
            finally:
                get_screenshot(page, (Config.LOG / f"screenshots/{self.crawler.site}login8.png"), False)

        # Close resources
        page.close()
        context.close()
        browser.close()
        playwright.stop()

    @staticmethod
    def register_job(log: Logger) -> None:
        log.info('Create login form table')
        with database:
            database.create_tables([LoginForm])

    def receive_response(self, responses: List[Optional[Response]], url: URL, final_url: str, start: List[datetime], repetition: int):
        super().receive_response(responses, url, final_url, start, repetition)

        # Check if we are at the end of the crawl to make screenshots
        activeurls: int = URL.select().where(URL.task == self.crawler.task, URL.job == self.crawler.job_id, URL.crawler == self.crawler.crawler_id, URL.site == self.crawler.site, URL.state != 'complete').count()
        if (activeurls == 1) and (self.crawler.repetition == Config.REPETITIONS):
            page: Page = self.crawler.context.new_page()

            try:
                page.goto(self.crawler.landingurl, timeout=Config.LOAD_TIMEOUT, wait_until=Config.WAIT_LOAD_UNTIL)
                page.wait_for_timeout(Config.WAIT_AFTER_LOAD)
            except Error as error:
                self.crawler.log.warning(error)
            finally:
                get_screenshot(page, (Config.LOG / f"screenshots/{self.crawler.site}login3.png"), False)

            if self.loginurl is not None:
                try:
                    page.goto(self.loginurl, timeout=Config.LOAD_TIMEOUT, wait_until=Config.WAIT_LOAD_UNTIL)
                    page.wait_for_timeout(Config.WAIT_AFTER_LOAD)
                except Error as error:
                    self.crawler.log.warning(error)
                finally:
                    get_screenshot(page, (Config.LOG / f"screenshots/{self.crawler.site}login4.png"), False)

            page.close()

    def add_url_filter_out(self, filters: List[Callable[[tld.utils.Result], bool]]) -> None:
        # Ignore URLs which could lead to logout
        def filt(url: tld.utils.Result) -> bool:
            return re.search(Login.LOGOUTKEYWORDS, get_url_full_with_query_fragment(url), flags=re.I) is not None

        filters.append(filt)
