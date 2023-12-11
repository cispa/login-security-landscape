from datetime import datetime
from typing import MutableSet, Optional

from config import Config
from peewee import DateTimeField, ForeignKeyField, IntegerField, Model, PostgresqlDatabase, TextField

# PostgresqlDatabase instance to store data
database = PostgresqlDatabase(Config.DATABASE,
                              user=Config.USER,
                              password=Config.PASSWORD,
                              host=Config.HOST,
                              port=Config.PORT,
                              autorollback=True,
                              sslmode='disable')


class BaseModel(Model):
    """
    A base model with common fields
    """
    created = DateTimeField(default=datetime.now)
    updated = DateTimeField(default=datetime.now)
    note = TextField(default=None, null=True)

    # Overrides the save method to automatically update the 'updated' field before saving.
    def save(self, *args, **kwargs):
        self.updated = datetime.now()
        return super(BaseModel, self).save(*args, **kwargs)

    class Meta:
        database = database


# Task table
class aa_Task(BaseModel):
    """
    The tasks the crawler works on.
    """
    job = TextField()
    crawler = IntegerField(null=True)
    site = TextField()
    url = TextField()
    landing_page = TextField()
    rank = IntegerField()
    state = TextField(default='free')
    code = IntegerField(null=True)
    error = TextField(null=True)


# URL table
class aa_URL(BaseModel):
    """
    The URLs the crawler visits.
    """
    task = ForeignKeyField(aa_Task)
    job = TextField()
    crawler = IntegerField()
    site = TextField()
    url = TextField()
    urlfinal = TextField(default=None, null=True)
    fromurl = ForeignKeyField('self', null=True, backref='children')
    depth = IntegerField()
    code = IntegerField(default=None, null=True)
    repetition = IntegerField()
    start = DateTimeField(default=None, null=True)
    end = DateTimeField(default=None, null=True)
    state = TextField(default='free')


class URLDB:
    """
    An in-memory URL database for crawlers to track visited URLs and interface with the URL table.
    """
    def __init__(self, crawler) -> None:
        from crawler import Crawler
        self.crawler: Crawler = crawler
        self._seen: MutableSet[str] = set()  # Tracks visited URLs
    
    def get_active(self) -> int:
        return aa_URL.select().where(aa_URL.task == self.crawler.task,
                                  aa_URL.job == self.crawler.job_id,
                                  aa_URL.crawler == self.crawler.crawler_id,
                                  aa_URL.site == self.crawler.site,
                                  aa_URL.state != 'complete').count()

    def get_url(self, repetition: int) -> Optional[aa_URL]:
        """
        Get the next URL to visit.
        """
        url: Optional[aa_URL] = None

        if repetition == 1:
            if Config.BREADTHFIRST:
                url = aa_URL.select().where(
                    aa_URL.task == self.crawler.task,
                    aa_URL.job == self.crawler.job_id,
                    aa_URL.crawler == self.crawler.crawler_id,
                    aa_URL.site == self.crawler.site,
                    aa_URL.depth == self.crawler.depth,
                    aa_URL.repetition == repetition,
                    aa_URL.state == 'free'
                ).order_by(aa_URL.created.asc()).first()


            url = url or aa_URL.select().where(
                aa_URL.task == self.crawler.task,
                aa_URL.job == self.crawler.job_id,
                aa_URL.crawler == self.crawler.crawler_id,
                aa_URL.site == self.crawler.site,
                aa_URL.repetition == repetition,
                aa_URL.state == 'free'
            ).order_by(aa_URL.created.asc()).first()
        else:
            url = aa_URL.get_or_none(task=self.crawler.task,
                                  job=self.crawler.job_id,
                                  crawler=self.crawler.crawler_id,
                                  site=self.crawler.site,
                                  url=self.crawler.currenturl,
                                  depth=self.crawler.depth,
                                  repetition=repetition,
                                  state='waiting')

        if url is None:
            return None

        url.state = 'progress'
        url.save()
        return url

    def get_seen(self, url: str) -> bool:
        """
        Check if URL was already visited.
        """
        return url in self._seen

    def add_seen(self, url: str):
        """
        Mark URL as seen.
        """
        self._seen.add(url)
        if url[-1] == '/':
            self._seen.add(url[:-1])
        else:
            self._seen.add(url + '/')

    def add_url(self, url: str, depth: int, fromurl: Optional[aa_URL], force: bool = False) -> None:
        """
        Add URL to URL table.
        """
        if url in self._seen and not force:
            return

        self.add_seen(url)

        with database.atomic():
            aa_URL.create(task=self.crawler.task,
                       job=self.crawler.job_id,
                       crawler=self.crawler.crawler_id,
                       site=self.crawler.site,
                       url=url,
                       fromurl=fromurl,
                       depth=depth,
                       repetition=1)

            for repetition in range(2, Config.REPETITIONS + 1):
                aa_URL.create(task=self.crawler.task,
                           job=self.crawler.job_id,
                           crawler=self.crawler.crawler_id,
                           site=self.crawler.site,
                           url=url,
                           fromurl=fromurl,
                           depth=depth,
                           repetition=repetition,
                           state='waiting')
