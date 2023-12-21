import pathlib
import re
from typing import Optional

import tld
from config import Config
from playwright.sync_api import Error, Frame, Locator, Page, Response
from tld.exceptions import TldBadUrl, TldDomainNotFound

CLICKABLES: str = r'button,*[role="button"],*[onclick],input[type="button"],input[type="submit"],' \
                  r'a[href="#"]'

SSO: str = r'Facebook|Twitter|Google|Yahoo|Windows.?Live|Linked.?In|Git.?Hub|Pay.?Pal|Amazon|' \
           r'v.?Kontakte|Yandex|37.?signals|Salesforce|Fitbit|Baidu|Ren.?Ren|Weibo|AOL|Shopify|' \
           r'Word.?Press|Dwolla|miiCard|Yammer|Sound.?Cloud|Instagram|The.?City|Apple|Slack|' \
           r'Evernote'


def get_tld_object(url: str) -> Optional[tld.utils.Result]:
    """
    Converts a string to parsed TLD.utils.Result object.

    Args:
    - url (str): The URL string from which the parsed TLD.utils.Result will be generated.

    Returns:
    - Optional[tld.utils.Result]: The parsed TLD.utils.Result object.
    """
    try:
        return tld.get_tld(url, as_object=True)
    except (TldBadUrl, TldDomainNotFound):
        return None


def get_url_origin(url: Optional[tld.utils.Result]) -> str:
    """
    Extract the origin of a TLD.utils.Result object.

    Args:
    - url (Optional[tld.utils.Result]): The parsed TLD.utils.Result object.

    Returns:
    - str: The origin (scheme://hostname:port) of the URL.
    """
    if url is None:
        return ''

    return url.parsed_url.scheme + '://' + url.parsed_url.netloc


def get_url_scheme_site(url: Optional[tld.utils.Result]) -> str:
    """
    Get the site (ETLD+1) of the TLD.utils.Result object.

    Args:
    - url (Optional[tld.utils.Result]): The parsed TLD.utils.Result object.

    Returns:
    - str: The site (ETLD+1) of the URL.
    """
    if url is None:
        return ''

    return url.parsed_url.scheme + '://' + url.fld


def get_url_full(url: Optional[tld.utils.Result]) -> str:
    """
    Get the full URL (without query or fragment) of the TLD.utils.Result object.

    Args:
    - url (Optional[tld.utils.Result]): The parsed TLD.utils.Result object.

     Returns:
    - str: The full URL as a string (without query or fragment).
    """
    if url is None:
        return ''

    return url.parsed_url.scheme + '://' + url.parsed_url.netloc + url.parsed_url.path


def get_url_full_with_query(url: Optional[tld.utils.Result]) -> str:
    """
    Get the full URL with query (without fragment) of the TLD.utils.Result object.

    Args:
    - url (Optional[tld.utils.Result]): The parsed TLD.utils.Result object.

     Returns:
    - str: The full URL as a string with query (without fragment).
    """
    if url is None:
        return ''

    return get_url_full(url) + ('?' if url.parsed_url.query else '') + url.parsed_url.query


def get_url_full_with_query_fragment(url: Optional[tld.utils.Result]) -> str:
    """
    Get the full URL with query and fragment of the TLD.utils.Result object.

    Args:
    - url (Optional[tld.utils.Result]): The parsed TLD.utils.Result object.

     Returns:
    - str: The full URL as a string with query and fragment.
    """
    if url is None:
        return ''

    return get_url_full_with_query(url) + (
        '#' if url.parsed_url.fragment else '') + url.parsed_url.fragment


def get_url_from_href(href: str, origin: tld.utils.Result) -> Optional[tld.utils.Result]:
    """
    Convert an href to a parsed TLD.utils.Result object.

    Args:
    - href (str): The href string
    - origin (tld.utils.Result): The URL of the page from where the href resides parsed as TLD.utils.Result object.

    Returns:
    - Optional[tld.utils.Result]: The parsed href as a TLD.utils.Result object.
    """
    if re.match('^http', href) is not None:
        res: Optional[tld.utils.Result] = get_tld_object(href)
    elif re.match('^//', href) is not None:
        res: Optional[tld.utils.Result] = get_tld_object(origin.parsed_url.scheme + ":" + href)
    else:
        if href[0] == '/':
            path: str = origin.parsed_url.path[:-1] if origin.parsed_url.path and \
                                                       origin.parsed_url.path[
                                                           -1] == '/' else origin.parsed_url.path
        else:
            path: str = origin.parsed_url.path if origin.parsed_url.path and origin.parsed_url.path[
                -1] == '/' else origin.parsed_url.path + '/'

        res: Optional[tld.utils.Result] = get_tld_object(
            origin.parsed_url.scheme + "://" + origin.parsed_url.netloc + path + href)

    return res


def get_screenshot(page: Page, path: pathlib.Path, force: bool) -> None:
    """
    Create a screenshot for a page and save it at specified path.

    Args:
    - page (Page): The page to capture the screenshot from.
    - path (pathlib.Path): The path where the screenshot will be saved.
    - force (bool): Indicates whether to overwrite an existing file if the path already exists.
    """
    if not path.exists() or force:
        try:
            page.screenshot(path=path, full_page=True)
        except Error:
            return


def get_locator_count(locator: Optional[Locator], page: Optional[Page | Frame] = None) -> int:
    """
    Get the number of elements in a Playwright locator.

    Args:
    - locator (Optional[Locator]): The locator to count.
    - page (Optional[Page | Frame]): The page or frame where the locator resides.

    Returns:
    - int: The number of elements in the locator. On an error, returns 0 elements.
    """
    if locator is None:
        return 0

    try:
        if page:
            page.inner_html('*', timeout=5000)

        return locator.count()
    except Error:
        return 0


def get_locator_nth(locator: Optional[Locator], nth: int) -> Optional[Locator]:
    """
    Get the n-th elements from a Playwright locator.

    Args:
    - locator (Optional[Locator]): The locator.
    - nth (int): The n-th element of the locator to retrieve.

    Returns:
    - Optional[Locator]: The nth occurrence of an element in the locator if found. Returns None if not found.
    """
    count: int = get_locator_count(locator)

    if locator is None or count < 1:
        return None

    if nth >= count:
        return None

    try:
        return locator.nth(nth)
    except Error:
        return None


def get_locator_attribute(locator: Optional[Locator], attribute: str) -> Optional[str]:
    """
    Get an attribute of a Playwright locator.

    Args:
    - locator (Optional[Locator]): The locator from which to extract the attribute.
    - attribute (str): The name of the attribute to retrieve.

    Returns:
    - Optional[str]: The value of the specified attribute if found. Returns None if the attribute or locator is missing.
    """
    if locator is None or get_locator_count(locator) > 1:
        return None

    try:
        return locator.get_attribute(attribute)
    except Error:
        return None


def get_outer_html(locator: Optional[Locator]) -> Optional[str]:
    """
    Get the outer HTML of a Playwright locator.

    Args:
    - locator (Optional[Locator]): The locator to extract the outer HTML from.

    Returns:
    - Optional[str]: The outer HTML content if the locator is found. Returns None if the locator is missing.
    """
    if locator is None:
        return None

    try:
        return locator.evaluate("node => node.outerHTML;")
    except Error:
        return None


def get_label_for(locator: Locator | Page, element_id: str) -> Locator:
    """
    Get the label of a an element with an ID.

    Args:
    - locator (Locator | Page): The locator or page object where the element resides.
    - element_id (str): The ID of the element for which the label is desired.

    Returns:
    - Locator: The label associated with the specified element.
    """
    return locator.locator(f"label[for=\"{element_id}\"]")


def invoke_click(page: Page | Frame, clickable: Optional[Locator], timeout=30000) -> None:
    """
    Emulate a user click on a Playwright locator.

    Args:
    - page (Page | Frame): The page or frame containing the clickable element.
    - clickable (Optional[Locator]): The locator representing the clickable element.
    - timeout (int): The maximum time in milliseconds to wait for the element to be clickable.
    """
    if clickable is None or get_locator_count(clickable) > 1:
        return

    try:
        clickable.hover(timeout=timeout)
        page.wait_for_timeout(500)
        clickable.click(delay=500, timeout=timeout)
        page.wait_for_load_state(Config.WAIT_LOAD_UNTIL)
        page.wait_for_timeout(Config.WAIT_AFTER_LOAD)
    except Error:
        # Ignored
        pass


def refresh_page(page: Page | Frame) -> Optional[Response]:
    """
    Refresh (with a top-level navigation) a page.

    Args:
    - page (Page | Frame): The page or frame to refresh.

    Returns:
    - Optional[Response]: The response object if the navigation succeeds. Returns None if unsuccessful.
    """
    try:
        response = page.goto(page.url, timeout=Config.LOAD_TIMEOUT, wait_until=Config.WAIT_LOAD_UNTIL)
        page.wait_for_timeout(Config.WAIT_AFTER_LOAD)
    except Error:
        return None

    return response
