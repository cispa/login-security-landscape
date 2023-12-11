import re
from datetime import datetime
from typing import List, MutableSet, Optional

import tld
from database import aa_URL
from modules.module import Module
from playwright.sync_api import Error, Frame, Locator, Page, Response
from utils import CLICKABLES, SSO, get_locator_count, get_locator_nth, get_outer_html, get_tld_object, get_url_origin, invoke_click, refresh_page


class AcceptCookies(Module):
    """
    Module to automatically accepts cookie banners.
    """

    # Keywords for accept buttons
    CHECK_ENG: str = '/(\\W|^)(accept|okay|ok|consent|agree|allow|understand|continue|yes|' \
                     'got it|fine)(\\W|$)/i'
    CHECK_GER: str = '/(\\W|^)(stimm|verstanden|versteh|akzeptier|ja(\\W|$)|weiter(\\W|$)|' \
                     'annehm|bestätig|willig|zulassen(\\W|$)|lasse)/i'

    def __init__(self, crawler) -> None:
        super().__init__(crawler)
        self._urls: MutableSet[str] = self.crawler.state.get('AcceptCookies', set())

        self.crawler.state['AcceptCookies'] = self._urls

    def receive_response(self, responses: List[Optional[Response]], url: aa_URL, final_url: str, start: List[datetime], repetition: int) -> None:
        super().receive_response(responses, url, final_url, start, repetition)

        # Verify that response is valid
        response: Optional[Response] = responses[-1] if len(responses) > 0 else None
        if response is None or response.status >= 400:
            return

        # Check if we already accepted cookies for origin
        url_origin: Optional[tld.utils.Result] = get_tld_object(final_url)
        if (url_origin is None) or (get_url_origin(url_origin) in self._urls):
            return
        self._urls.add(get_url_origin(url_origin))

        # Accept cookies for origin
        AcceptCookies.accept(self.crawler.page, url.url, inframe=False, responses=responses, start=start)

        # Update state
        self.crawler.state['Context'] = self.crawler.context.storage_state()

    @staticmethod
    def accept(page: Page | Frame, url: str, inframe: bool = False, responses: Optional[List[Optional[Response]]] = None, start: Optional[List[datetime]] = None):
        # Check for cookies in first depth frames
        if not inframe:
            for frame in page.frames[1:]:
                AcceptCookies.accept(frame, frame.url, inframe=True, responses=responses, start=start)

        # Check for buttons with certain keywords
        try:
            # First check for english keywords
            buttons: Locator = page.locator(f"{CLICKABLES} >> text={AcceptCookies.CHECK_ENG} >> visible=true")
            locator_count: int = get_locator_count(buttons, page)

            # Then check for german keywords
            if locator_count == 0:
                buttons = page.locator(f"{CLICKABLES} >> text={AcceptCookies.CHECK_GER} >> visible=true")
                locator_count = get_locator_count(buttons, page)
        except Error:
            return

        # Click on each possible cookie accept button
        for i in range(locator_count):
            button: Optional[Locator] = get_locator_nth(buttons, i)
            if button is None:
                continue

            if re.search(SSO, get_outer_html(button) or '', flags=re.I) is not None:
                continue

            invoke_click(page, button, timeout=2000)

        # Stop earlier if we are in a frame
        if inframe:
            return

        # Refresh the page
        temp_time: datetime = datetime.now()
        temp_response: Optional[Response] = refresh_page(page, url)

        # Update if needed
        if responses is not None and start is not None:
            start.append(temp_time)
            responses.append(temp_response)
