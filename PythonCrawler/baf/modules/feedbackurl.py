from datetime import datetime
from logging import Logger
from typing import List, Optional

from playwright.sync_api import Response

from config import Config
from database import URL, database
from modules.module import Module


class FeedbackURL(Module):
    @staticmethod
    def register_job(log: Logger) -> None:
        log.info('Create feedback stats table')
        with database:
            database.create_tables([URL])

    def receive_response(self, responses: List[Optional[Response]], url: URL, final_url: str, start: List[datetime], repetition: int) -> None:
        super().receive_response(responses, url, final_url, start, repetition)

        # Get response and its status code
        response: Optional[Response] = responses[-1] if len(responses) > 0 else None
        code: int = response.status if response is not None else Config.ERROR_CODES['response_error']

        # Update response in table
        url.urlfinal = self.crawler.page.url
        url.code = code
        url.state = 'complete'
        url.start = start[-1]
        url.end = datetime.now()
        url.save()
