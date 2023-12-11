import argparse
import json
import sys

from database import Task


def add_site(site, url, rank, job):
    session_id = 0
    session_data = {"session_data": {'cookies': [], 'origins': []}}

    Task.create(job=job, site=site, url=url, landing_page=url, rank=rank, state='free', session=session_id, session_data=json.dumps(session_data))
    Task.create(job=job, site=site, url=url, landing_page=url, rank=rank, state='free', session_data=json.dumps(session_data))

def main(job: str):
    add_site('example.com', 'https://example.com/', 0, job)
    add_site('wikipedia.org', 'https://www.wikipedia.org/', 1, job)
    add_site('arxiv.org', 'https://arxiv.org/', 2, job)
    return 0

if __name__ == "__main__":
    # Preparing command line argument parser
    args_parser = argparse.ArgumentParser()
    args_parser.add_argument("-j", "--job", type=str, required=True, help="unique job id for crawl")

    # Parse command line arguments
    args = vars(args_parser.parse_args())
    sys.exit(main(args.get('job')))
