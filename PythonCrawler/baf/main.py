import argparse
import importlib
import os
import pathlib
import re
import sys
import time
import traceback
from datetime import datetime
from logging import FileHandler, Formatter, Logger
from multiprocessing import Pipe, Process
from typing import List, Optional, Type

from add_tasks import unlock_session
from crawler import Crawler
from database import URL, Task, database
from modules.module import Module

# Import config
try:
    Config = importlib.import_module('config').Config
except ModuleNotFoundError as e:
    traceback.print_exc()
    print(e)
    print("Prepare the config.py file. You can use the config-example.py as a start.")
    sys.exit(1)


# Custom process for saving exceptions
class CustomProcess(Process):
    def __init__(self, *aargs, **kwargs):
        Process.__init__(self, *aargs, **kwargs)
        self._pconn, self._cconn = Pipe()
        self._exception = None

    def run(self):
        try:
            Process.run(self)
            self._cconn.send(None)
        except Exception as error:
            trace = traceback.format_exc()
            self._cconn.send((error, trace))

    @property
    def exception(self):
        if self._pconn.poll():
            self._exception = self._pconn.recv()
        return self._exception


def main(job: str, crawlers_count: int, module_names: List[str], log_path: Optional[pathlib.Path] = None, starting_crawler_id: int = 1, listen: bool = False) -> int:
    # Create log path if needed
    log_path = (log_path or Config.LOG).resolve()
    if not log_path.exists():
        os.mkdir(log_path)

    # Verify arguments
    if not (log_path.exists() and log_path.is_dir()):
        raise RuntimeError('Path to directory for log output is incorrect')

    if crawlers_count <= 0 or starting_crawler_id <= 0:
        raise RuntimeError('Invalid number of crawlers or starting crawler id.')

    # Prepare logger
    if not (log_path / 'screenshots').exists():
        os.mkdir(log_path / 'screenshots')
    handler: FileHandler = FileHandler(log_path / f"job{job}.log")
    handler.setFormatter(Formatter('%(asctime)s %(levelname)s %(message)s'))
    log: Logger = Logger(f"Job {job}")
    log.setLevel(Config.LOG_LEVEL)
    log.addHandler(handler)

    # Fix for multiple modules not correctly parsed
    if module_names and ' ' in module_names[0]:
        module_names = module_names[0].split()

    # Importing modules
    log.info("Import modules %s", str(module_names))
    modules: List[Type[Module]] = _get_modules(module_names)

    # Creating database
    log.info('Load database')
    with database.atomic():
        database.create_tables([Task])
        database.create_tables([URL])

    # Create modules database
    log.info('Load modules database')
    for module in modules:
        module.register_job(log)

    # Prepare crawlers
    crawlers: List[Process] = []
    for i in range(0, crawlers_count):
        process = Process(target=_manage_crawler, args=(job, i + starting_crawler_id, log_path, modules, listen))
        crawlers.append(process)

    # Start crawlers
    for i, crawler in enumerate(crawlers):
        crawler.start()
        log.info("Start crawler %s with JOBID %s PID %s", (i + starting_crawler_id), job, crawler.pid)

    # Wait for crawlers to finish
    log.info('Waiting for crawlers to complete')
    for crawler in crawlers:
        crawler.join()
        crawler.close()

    log.info('Crawl complete')

    # Exit code
    return 0


def _get_modules(module_names: List[str]) -> List[Type[Module]]:
    result: List[Type[Module]] = []
    for module_name in module_names:
        module = importlib.import_module('modules.' + module_name.lower())
        result.append(getattr(module, module_name))
    return result


def _get_task(job: str, crawler_id: int, log) -> Optional[Task]:
    # Get progress task
    task: Optional[Task] = Task.get_or_none(job=job, crawler=crawler_id, state='progress')
    if task is not None:
        log.info("Loading progress task")
        return task
    
    # Otherwise get new free task
    with database.atomic():
        result = database.execute_sql("SELECT id FROM task WHERE state='free' AND job=%s FOR UPDATE SKIP LOCKED LIMIT 1", (job,)).fetchall()
        
        if len(result) == 0:
            task = None
        else:
            log.info("Loading free task")
            database.execute_sql("UPDATE task SET crawler=%s, state='progress' WHERE id=%s", (crawler_id, result[0]))
            task = Task.get_by_id(result[0])
        
        if task is not None:
            task.crawler = crawler_id
            task.state = 'progress'
            task.save()
    
    return task


# Overwatch process that starts the actual crawlers
def _manage_crawler(job: str, crawler_id: int, log_path: pathlib.Path, modules: List[Type[Module]], listen: bool) -> None:
    log = _get_logger(job, crawler_id, log_path)

    # Get task
    task: Optional[Task] = _get_task(job, crawler_id, log)
    while task or listen:
        if not task and listen:
            time.sleep(60)
            task = _get_task(job, crawler_id, log)
            continue

        # Start crawler
        crawler: CustomProcess = CustomProcess(target=_start_crawler, args=(job, crawler_id, task.id, log_path, modules))
        timestart: datetime = datetime.today()
        timecurrent: datetime = datetime.today()
        crawler.start()

        # Crawler is alive or we restart crashed crawler and 24h limit did not pass
        while crawler.is_alive() or (Config.RESTART_TIMEOUT and (Config.LOG / f"job{job}crawler{crawler_id}.cache").exists() and ((timecurrent - timestart).seconds < 84600)):
            # Log crashed crawler and restart it
            if not crawler.is_alive():
                log.warning("Crawler %s crashed with %s", task.crawler, (crawler.exception[1] if crawler.exception else crawler.exception))
                crawler.close()
                crawler = CustomProcess(target=_start_crawler, args=(job, crawler_id, task.id, log_path, modules))
                crawler.start()

            # Let crawler run for some time
            crawler.join(timeout=Config.RESTART_TIMEOUT)

            # Get crawler's last entry
            line = _get_line_last(log_path / f"job{job}crawler{crawler_id}.log").split()

            # Check if crawler was idle for too much time or the crawler passed the 24h limit
            timecurrent = datetime.today()
            if len(line) > 1:
                timelastentry: datetime = datetime.strptime(line[0] + ' ' + line[1], '%Y-%m-%d %H:%M:%S,%f')

                if ((timecurrent - timelastentry).seconds < Config.RESTART_TIMEOUT) and ((timecurrent - timestart).seconds < 84600):
                    continue

            # Terminate crawler due to timeout
            log.error("Close stale crawler %s", str(task.crawler))

            crawler.terminate()
            crawler.join(timeout=30)

            if crawler.is_alive():
                crawler.kill()
                time.sleep(5)

            if Config.RESTART and (Config.LOG / f"job{job}crawler{crawler_id}.cache").exists() and ((timecurrent - timestart).seconds >= 84600):
                os.remove(Config.LOG / f"job{job}crawler{crawler_id}.cache")

        crawler.close()

        # Mark task as complete
        task = Task.get_by_id(task.get_id())
        task.state = 'complete'

        if Config.RESTART and (Config.LOG / f"job{job}crawler{crawler_id}.cache").exists():
            task.error = 'Crawler crashed' if not task.error else 'Crawler crashed, ' + task.error
            log.error("Crawler %s crashed", str(task.crawler))
            os.remove(Config.LOG / f"job{job}crawler{crawler_id}.cache")
        if (timecurrent - timestart).seconds >= 84600:
            task.error = 'Limit 24h' if not task.error else 'Limit 24h, ' + task.error
            log.error("Crawler %s passed 24h limit", str(task.crawler))
        
        task.save()

        # Check if the other crawler is complete, and if so, unlock account
        activelogintasks: int = 0
        try:
            activelogintasks = database.execute_sql("SELECT count(*) FROM task WHERE session_data IS NOT NULL AND state != 'complete' AND job = %s AND site = %s", (job, task.site)).fetchone()[0]
        except Exception as error:
            log.error(error)
        
        if (activelogintasks == 0) and (task.session_data is not None):
            log.info("Unlock session")
            taskid = database.execute_sql("SELECT session FROM task WHERE session IS NOT NULL AND state = 'complete' AND job = %s AND site = %s LIMIT 1", (job, task.site)).fetchone()[0]

            try:
                unlock_session(str(taskid), Config.EXPERIMENT)
            except Exception as error:
                log.warning(error)

        # Get next task
        task = _get_task(job, crawler_id, log)
    
    log.handlers[-1].close()


def _start_crawler(job: str, crawler_id: int, task: int, log_path: pathlib.Path, modules: List[Type[Module]]) -> None:
    log = _get_logger(job, crawler_id, log_path)
    log.info('Start crawler')
    crawler: Crawler = Crawler(job, crawler_id, task, log, modules)
    crawler.start_crawl()
    log.info('Stop crawler')
    log.handlers[-1].close()


def _get_logger(job: str, crawler_id: int, log_path: pathlib.Path) -> Logger:
    handler: FileHandler = FileHandler(log_path / f"job{job}crawler{crawler_id}.log")
    handler.setFormatter(Formatter('%(asctime)s %(levelname)s %(message)s'))
    log = Logger(f"Job {job} Crawler {crawler_id}")
    log.setLevel(Config.LOG_LEVEL)
    log.addHandler(handler)
    return log


def _get_line_last(path: str | pathlib.Path) -> str:
    with open(path, mode='rb') as file:
        line: bytes = b''

        try:
            file.seek(-2, 2)
        except OSError:
            return ''

        while re.match('\\d{4}-\\d{2}-\\d{2}', line.decode("utf-8", errors="ignore")) is None:
            try:
                file.seek(-(len(line) + 2) if len(line) > 0 else 0, 1)
            except OSError:
                return ''

            while file.read(1) != b'\n':
                try:
                    file.seek(-2, 1)
                except OSError:
                    try:
                        file.seek(-1, 1)
                    except OSError:
                        return ''
                    break

            line = file.readline() or b''
    return line.decode("utf-8", errors="ignore")


if __name__ == '__main__':
    # Preparing command line argument parser
    args_parser = argparse.ArgumentParser()
    args_parser.add_argument("-o", "--log", type=pathlib.Path,
                             help="path to directory where output log will be saved")
    args_parser.add_argument("-m", "--modules", type=str, nargs='*',
                             help="which modules the crawler will run")
    args_parser.add_argument("-j", "--job", type=str, required=True,
                             help="unique job id for crawl")
    args_parser.add_argument("-c", "--crawlers", type=int, required=True,
                             help="how many crawlers will run concurrently")
    args_parser.add_argument("-i", "--crawlerid", type=int, default=1,
                             help="starting crawler id (default 1); must be > 0")
    args_parser.add_argument("-l", "--listen", default=False, action='store_true',
                             help="crawler will not stop if there is no job; query and sleep until a job is found")

    # Parse command line arguments
    args = vars(args_parser.parse_args())
    sys.exit(main(
        args.get('job'),
        args.get('crawlers'),
        args.get('modules') or [],
        args.get('log'),
        args.get('crawlerid'),
        args.get('listen')
    ))
