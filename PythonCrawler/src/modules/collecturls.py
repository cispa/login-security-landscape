import random
from datetime import datetime
from typing import Callable, List, Optional

import tld
from playwright.sync_api import Error, Locator, Response

from config import Config
from database import URL
from modules.module import Module
from utils import get_locator_attribute, get_locator_count, get_locator_nth, get_tld_object, get_url_from_href, get_url_full, get_url_full_with_query, get_url_full_with_query_fragment, get_url_origin


class CollectURLs(Module):
    """
    Module to automatically collect links to crawl further.
    """

    def __init__(self, crawler) -> None:
        super().__init__(crawler)
        self._max_urls: int = self.crawler.state.get('CollectUrls', (Config.MAX_URLS - 1))
        self._url_filter_out: List[Callable[[tld.utils.Result], bool]] = []

        self.crawler.state['CollectUrls'] = self._max_urls

    def receive_response(self, responses: List[Optional[Response]], url: URL, final_url: str, start: List[datetime], repetition: int) -> None:
        super().receive_response(responses, url, final_url, start, repetition)

        # Speedup by ignoring repetitive URL collection from the same page
        if self.crawler.repetition > 1:
            return

        # Make sure to add page as seen
        parsed_url_final: Optional[tld.utils.Result] = get_tld_object(final_url)
        self.crawler.urldb.add_seen(get_url_full(parsed_url_final) if parsed_url_final is not None else final_url)

        # Check if depth or max URLs exceeded
        if self.crawler.depth >= Config.DEPTH or self._max_urls < 1:
            return

        if (parsed_url_final is None) or (len(responses) == 0) or (responses[-1] is None):
            return

        # Check if response redirected out of bounds
        if Config.SAME_ORIGIN and (self.crawler.origin != get_url_origin(parsed_url_final)):
            return

        if Config.SAME_ETLDP1 and (self.crawler.site != parsed_url_final.fld):
            return

        # Get all <a> tags with a href
        try:
            links: Locator = self.crawler.page.locator('a[href]')
        except Error:
            return

        # Iterate over each href
        urls: List[tld.utils.Result] = []
        for i in range(get_locator_count(links)):
            # Get href attribute
            link: Optional[str] = get_locator_attribute(get_locator_nth(links, i), 'href')

            if link is None or not link.strip():
                continue

            # Parse attribute
            parsed_link: Optional[tld.utils.Result] = get_url_from_href(link.strip(), parsed_url_final)
            if not parsed_link:
                continue

            # Check for same origin
            if Config.SAME_ORIGIN and self.crawler.origin != get_url_origin(parsed_link):
                continue

            # Check for same ETLD+1
            if Config.SAME_ETLDP1 and self.crawler.site != parsed_link.fld:
                continue

            # Check if URL was seen before
            parsed_link_full: str = get_url_full(parsed_link)
            if self.crawler.urldb.get_seen(parsed_link_full):
                continue
            self.crawler.urldb.add_seen(parsed_link_full)

            # Run filter on URL
            filter_out: bool = False
            for filt in self._url_filter_out:
                if filt(parsed_link):
                    filter_out = True
                    break
            if filter_out:
                continue

            # Add URL to a bucket
            urls.append(parsed_link)

        self.crawler.log.info(f"Find {min(len(urls), self._max_urls)} URLs")

        # Shuffle the URLs bucket
        random.shuffle(urls)

        # For each found URL, add it to the database, while making sure not to exceed the max URL limit
        for parsed_link in urls:
            self.crawler.urldb.add_url(get_url_full_with_query_fragment(parsed_link), self.crawler.depth + 1, url, force = True)

            self._max_urls -= 1
            if self._max_urls < 1:
                break

        self.crawler.state['CollectUrls'] = self._max_urls

    def add_url_filter_out(self, filters: List[Callable[[tld.utils.Result], bool]]) -> None:
        self._url_filter_out = filters
