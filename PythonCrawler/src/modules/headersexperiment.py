import json
from asyncio import CancelledError
from datetime import datetime
from logging import Logger
from typing import List, Optional

from peewee import BlobField, BooleanField, CharField, ForeignKeyField, IntegerField, TextField
from playwright.sync_api import BrowserContext, Error, Page, Response

from config import Config
from database import URL, BaseModel, Task, database
from modules.login import Login
from utils import get_screenshot


class Header(BaseModel):
    task = ForeignKeyField(Task)
    job = TextField()
    crawler = IntegerField()
    site = TextField()
    depth = IntegerField()
    repetition = IntegerField()
    mainframe = BooleanField()
    frame = TextField()
    method = CharField()
    code = IntegerField()
    codetext = TextField()
    content = CharField(null=True)
    resource = CharField()
    fromurl = ForeignKeyField(URL)
    tourl = TextField()
    tourlfinal = TextField()
    headers = TextField(null=True)
    body = BlobField(default=None, null=True)


class HeadersExperiment(Login):
    def __init__(self, crawler) -> None:
        super().__init__(crawler)

        # Setup variables
        self.context_alt: BrowserContext = None
        self.page_alt: Page = None
        self.state: bool = self.crawler.task.session is not None

        # Check if login was successful (in our experiment it is always successful)
        if not self.loginsuccess:
            self.crawler.stop = True

        # Switch states if needed (changes crawling URL collection perspective to logout)
        if (not self.state) and ('HeadersExperiment' not in self.crawler.state):
            self.crawler.state['HeadersExperiment'] = json.loads(self.crawler.task.session_data)
            self.crawler.state['Context'] = None
            self.crawler.task.note = 'logout/'
            self.crawler.task.save()
        else:
            self.crawler.task.note = 'login/'
            self.crawler.task.save()

    @staticmethod
    def register_job(log: Logger) -> None:
        log.info('Create header table')
        with database:
            database.create_tables([Header])
        Login.register_job(log)

    def add_handlers(self, url: URL) -> None:
        super().add_handlers(url)

        # Create response listener that saves all headers
        def handler(login: bool, page: Page):
            # Note to differentiate login and logout
            note: str = 'login/' if self.state else 'logout/'
            note += 'login' if login else 'logout'

            def helper(response: Response):
                # Capture header
                headers: Optional[str] = None
                try:
                    headers = str(response.headers_array())
                except (Exception, CancelledError):
                    # Ignored
                    pass
                
                # Capture body only on main page responses
                body: Optional[bytes] = None
                if (response.frame.parent_frame is None) and (not response.frame.is_detached()):
                    try:
                        body = response.body()
                    except (Exception, CancelledError):
                        # Ignored
                        pass
                
                try:
                    Header.create(task=self.crawler.task,
                                  job=self.crawler.job_id,
                                  crawler=self.crawler.crawler_id,
                                  site=self.crawler.site,
                                  depth=self.crawler.depth,
                                  repetition=self.crawler.repetition,
                                  mainframe=((response.frame.parent_frame is None) and (not response.frame.is_detached())),
                                  frame=response.frame.url,
                                  method=response.request.method,
                                  code=response.status,
                                  codetext=response.status_text,
                                  content=response.headers.get('content-type', None),
                                  resource=response.request.resource_type,
                                  fromurl=url,
                                  tourl=response.request.url,
                                  tourlfinal=response.url,
                                  headers=headers,
                                  body=body,
                                  note=note)
                except (Exception, CancelledError):
                    # Ignored
                    pass

            return helper
        
        # Differentiate between the two crawl states
        if self.state:
            # Create fresh alt context
            self.context_alt = self.crawler.browser.new_context(
                storage_state=None,
                **self.crawler.playwright.devices[Config.DEVICE],
                locale=Config.LOCALE,
                timezone_id=Config.TIMEZONE
            )

            self.page_alt = self.context_alt.new_page()

            # Register handlers
            self.crawler.page.on('response', handler(True, self.crawler.page))
            self.page_alt.on('response', handler(False, self.page_alt))
        else:
            # Create login alt context
            self.context_alt = self.crawler.browser.new_context(
                storage_state=self.crawler.state['HeadersExperiment'],
                **self.crawler.playwright.devices[Config.DEVICE],
                locale=Config.LOCALE,
                timezone_id=Config.TIMEZONE
            )

            self.page_alt = self.context_alt.new_page()

            # Register handlers
            self.crawler.page.on('response', handler(False, self.crawler.page))
            self.page_alt.on('response', handler(True, self.page_alt))

    def receive_response(self, responses: List[Optional[Response]], url: URL, final_url: str, start: List[datetime], repetition: int):
        super().receive_response(responses, url, final_url, start, repetition)

        # Navigate alt page
        response: Optional[Response] = None
        try:
            response = self.page_alt.goto(self.crawler.currenturl, timeout=Config.LOAD_TIMEOUT, wait_until=Config.WAIT_LOAD_UNTIL)
            self.page_alt.wait_for_timeout(Config.WAIT_AFTER_LOAD)
        except Error as error:
            self.crawler.log.warning(error)
        self.crawler.log.info(f"Response status {response if response is None else response.status} repetition {self.crawler.repetition} {'logout' if self.state else 'login'}")

        # Check if we are at the end of the crawl to make screenshots
        activeurls: int = URL.select().where(URL.task == self.crawler.task, URL.job == self.crawler.job_id, URL.crawler == self.crawler.crawler_id, URL.site == self.crawler.site, URL.state != 'complete').count()
        if (activeurls == 1) and (self.crawler.repetition == Config.REPETITIONS):
            page: Page = self.crawler.context.new_page() if self.state else self.context_alt.new_page()

            try:
                page.goto(self.crawler.landingurl, timeout=Config.LOAD_TIMEOUT, wait_until=Config.WAIT_LOAD_UNTIL)
                page.wait_for_timeout(Config.WAIT_AFTER_LOAD)
            except Error as error:
                self.crawler.log.warning(error)
            finally:
                get_screenshot(page, (Config.LOG / f"screenshots/{self.crawler.site}login{'3' if self.state else '5'}.png"), True)

            if self.loginurl is not None:
                try:
                    page.goto(self.loginurl, timeout=Config.LOAD_TIMEOUT, wait_until=Config.WAIT_LOAD_UNTIL)
                    page.wait_for_timeout(Config.WAIT_AFTER_LOAD)
                except Error as error:
                    self.crawler.log.warning(error)
                finally:
                    get_screenshot(page, (Config.LOG / f"screenshots/{self.crawler.site}login{'4' if self.state else '6'}.png"), True)

            page.close()
        
        # Always close all resources at the end of the page
        if self.crawler.repetition == Config.REPETITIONS:
            self.page_alt.close()
            self.context_alt.close()
