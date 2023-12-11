import os
import pathlib
import re
from typing import Optional

import numpy
import tld
from playwright.sync_api import Error, Frame, Locator, Page, Response
from sklearn.cluster import dbscan
from tld.exceptions import TldBadUrl, TldDomainNotFound

from config import Config

CLICKABLES: str = r'button,*[role="button"],*[onclick],input[type="button"],input[type="submit"],' \
                  r'a[href="#"]'

SSO: str = r'Facebook|Twitter|Google|Yahoo|Windows.?Live|Linked.?In|Git.?Hub|Pay.?Pal|Amazon|' \
           r'v.?Kontakte|Yandex|37.?signals|Salesforce|Fitbit|Baidu|Ren.?Ren|Weibo|AOL|Shopify|' \
           r'Word.?Press|Dwolla|miiCard|Yammer|Sound.?Cloud|Instagram|The.?City|Apple|Slack|' \
           r'Evernote'


def get_tld_object(url: str) -> Optional[tld.utils.Result]:
    try:
        return tld.get_tld(url, as_object=True)
    except (TldBadUrl, TldDomainNotFound):
        return None


def get_url_origin(url: Optional[tld.utils.Result]) -> str:
    if url is None:
        return ''

    return url.parsed_url.scheme + '://' + url.parsed_url.netloc


def get_url_scheme_site(url: Optional[tld.utils.Result]) -> str:
    if url is None:
        return ''

    return url.parsed_url.scheme + '://' + url.fld


def get_url_entity(url: Optional[tld.utils.Result]) -> str:
    if url is None:
        return ''

    etldp1: str = url.fld

    # TODO improve
    if re.search(r'^(google\.|youtube\.com|blogger\.com|blogspot\.com)', etldp1,
                 flags=re.I) is not None:
        return 'Google'
    elif re.search(r'^(facebook\.com|fb\.com)', etldp1, flags=re.I) is not None:
        return 'Facebook'
    elif re.search(r'^(microsoft\.com|msn\.com|live\.com|outlook\.com)', etldp1,
                   flags=re.I) is not None:
        return 'Microsoft'

    return etldp1


def get_url_full(url: Optional[tld.utils.Result]) -> str:
    if url is None:
        return ''

    return url.parsed_url.scheme + '://' + url.parsed_url.netloc + url.parsed_url.path


def get_url_full_with_query(url: Optional[tld.utils.Result]) -> str:
    if url is None:
        return ''

    return get_url_full(url) + ('?' if url.parsed_url.query else '') + url.parsed_url.query


def get_url_full_with_query_fragment(url: Optional[tld.utils.Result]) -> str:
    if url is None:
        return ''

    return get_url_full_with_query(url) + (
        '#' if url.parsed_url.fragment else '') + url.parsed_url.fragment


def get_url_from_href(href: str, origin: tld.utils.Result) -> Optional[tld.utils.Result]:
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
    if not path.exists() or force:
        try:
            page.screenshot(path=path, full_page=True)
        except Error:
            return


def get_locator_count(locator: Optional[Locator], page: Optional[Page | Frame] = None) -> int:
    if locator is None:
        return 0

    try:
        if page:
            page.inner_html('*', timeout=5000)

        return locator.count()
    except Error:
        return 0


def get_locator_nth(locator: Optional[Locator], nth: int) -> Optional[Locator]:
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
    if locator is None or get_locator_count(locator) > 1:
        return None

    try:
        return locator.get_attribute(attribute)
    except Error:
        return None


def get_outer_html(locator: Optional[Locator]) -> Optional[str]:
    if locator is None:
        return None

    try:
        return locator.evaluate("node => node.outerHTML;")
    except Error:
        return None


def get_label_for(locator: Locator | Page, element_id: str) -> Locator:
    return locator.locator(f"label[for=\"{element_id}\"]")


def get_string_distance(str1: str, str2: str, normalize: bool = False) -> float:
    track = numpy.zeros((len(str1) + 1, len(str2) + 1))

    for i in range(len(str1) + 1):
        track[i][0] = i

    for j in range(len(str2) + 1):
        track[0][j] = j

    for i in range(1, len(str1) + 1):
        for j in range(1, len(str2) + 1):
            cost: int = str1[i - 1] != str2[j - 1]
            track[i][j] = min(track[i - 1][j] + 1, track[i][j - 1] + 1, track[i - 1][j - 1] + cost)

            if i > 1 and j > 1 and str1[i - 1] == str2[j - 2] and str1[i - 2] == str2[j - 1]:
                track[i][j] = min(track[i][j], track[i - 2][j - 2] + 1)

    result: float = float(track[len(str1)][len(str2)])
    return (2 * result) / (len(str1) + len(str2) + result) if normalize and (
            len(str1) + len(str2) + result) != 0.0 else result


def get_urls_distance(url1: tld.utils.Result, url2: tld.utils.Result,
                      normalize: bool = False) -> float:
    if get_url_origin(url1) != get_url_origin(url2):
        return 1.0 if normalize else float(len(url1.parsed_url.path) + len(url2.parsed_url.path))

    path1: list[str] = list(filter(''.__ne__, url1.parsed_url.path.split('/')))
    path2: list[str] = list(filter(''.__ne__, url2.parsed_url.path.split('/')))

    if len(path1) > 1 and len(path1) == len(path2) and (
            len(path1[-1]) >= 25 or len(path2[-1]) >= 25):
        return get_string_distance(path1[-2], path2[-2], normalize=True)

    return get_string_distance(url1.parsed_url.path, url2.parsed_url.path, normalize=normalize)


def get_urls_cluster(urls: list[tld.utils.Result], threshold: float):
    cluster = dbscan(numpy.arange(len(urls)).reshape(-1, 1),
                     metric=lambda x, y: get_urls_distance(urls[int(x[0])], urls[int(y[0])],
                                                           normalize=True), eps=threshold,
                     min_samples=2)

    # TODO finish
    return cluster


def invoke_click(page: Page | Frame, clickable: Optional[Locator], timeout=30000) -> None:
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


def get_visible_extra(locator: Optional[Locator]) -> bool:
    if locator is None or get_locator_count(locator) != 1:
        return False

    try:
        locator.click(timeout=2000, trial=True)
    except Error:
        return False

    opacity: str = locator.evaluate("""
                                    node => {
                                      var resultOpacity = 1;
                                    
                                      while (node) {
                                        try {
                                          resultOpacity = Math.min(resultOpacity, window.getComputedStyle(node).getPropertyValue("opacity") || resultOpacity);
                                        }
                                        catch { }
                                        node = node.parentNode;
                                      }
                                    
                                      return resultOpacity;
                                    }
                                    """)

    return locator.is_visible() and float(opacity) > 0.0


def refresh_page(page: Page | Frame, url: str) -> Optional[Response]:
    try:
        response = page.goto(url, timeout=Config.LOAD_TIMEOUT, wait_until=Config.WAIT_LOAD_UNTIL)
        page.wait_for_timeout(Config.WAIT_AFTER_LOAD)
    except Error:
        return None

    return response
