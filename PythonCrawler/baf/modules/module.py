from datetime import datetime
from logging import Logger
from typing import Callable, List, Optional

import tld
from playwright.sync_api import Response

from database import URL


class Module:
    """
    A baseclass from which all modules inherit.
    """

    def __init__(self, crawler) -> None:
        """
        Initializes module instance.

        Args:
            crawler (Crawler): crawler that owns this module
        # """
        from crawler import Crawler
        self.crawler: Crawler = crawler

    @staticmethod
    def register_job(log: Logger) -> None:
        """
        Initialize job preparations, for example creation of database.

        Args:
            log (Logger): log
        """

    def add_handlers(self, url: URL) -> None:
        """
        Add event handlers before navigating to a page.

        Args:
            url (URL): URL, depth, rank, previous URL
        """

    def receive_response(self, responses: List[Optional[Response]], url: URL, final_url: str, start: List[datetime], repetition: int) -> None:
        """
        Receive response from server.

        Args:
            responses (List[Optional[Response]]): list of responses from crawler and modules
            url (URL): URL, depth, rank, previous URL
            final_url (str): final url after redirections
            start (List[datetime]): start times for crawl and for each module response initiation
            repetition (int): current URL visited repetition
        """

    def add_url_filter_out(self, filters: List[Callable[[tld.utils.Result], bool]]) -> None:
        """
        Remove certain urls when gethering links. Add a filtering function to the list of existing
        filters.

        Args:
            filters (List[Callable[[tld.utils.Result], bool]]): shared list of already existing filters
        """
