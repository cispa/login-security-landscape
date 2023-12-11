import argparse
import json
import sys
import time
from typing import Optional

import zmq

from config import Config
from database import Task
from modules.login import LoginForm


def lock_session(job: str, rsite: Optional[str]) -> Optional[str]:
    # Create socket
    context = zmq.Context()
    socket = context.socket(zmq.REQ)

    try:
        socket.connect(Config.ZMQ_SOCK)

        # Request session
        request = {"type": "get_session", "experiment": Config.EXPERIMENT}
        if rsite is not None:
            request.update({"type": "get_specific_session", "site": rsite})
        socket.send_string(json.dumps(request))
        response = json.loads(socket.recv_string())
        socket.close()

        # Check if session is valid
        if not response["success"]:
            return None
        
        # Get session data
        sessionid: str = str(response['session']['id'])
        url: str = response['session']['account']['website']['landing_page']
        site: str = response['session']['account']['website']['site']
        rank: int = response['session']['account']['website']['t_rank']

        # Check for login form
        if 'loginform' in response['session']:
            formurl: str = response['session']['loginform']['formurl']
            formurlfinal: str = response['session']['loginform']['formurlfinal']
            success: Optional[bool] = response['session']['loginform']['success']

            loginform: Optional[LoginForm] = LoginForm.get_or_none(site=site, formurl=formurl)
            if loginform is not None:
                loginform.success = success
                loginform.save()
            else:
                loginform = LoginForm.create(job=job, crawler=0, site=site, formurl=formurl, formurlfinal=formurlfinal, success=success)
        
        # Create two tasks, one with the session, the other without
        Task.create(job=job, site=site, url=url, landing_page=url, rank=rank, state='free', session=sessionid, session_data=json.dumps(response['session_data']))
        Task.create(job=job, site=site, url=url, landing_page=url, rank=rank, state='free', session_data=json.dumps(response['session_data']))
        return sessionid
    finally:
        socket.close()
        context.term()


def unlock_session(sessionid: str, experiment: str):
    if (Config.EXPERIMENT == 'demoheaders') or (Config.EXPERIMENT == 'demoinclusions'):
        return

    # Create socket
    context = zmq.Context()
    socket = context.socket(zmq.REQ)

    try:
        socket.connect(Config.ZMQ_SOCK)

        request = {"type": "unlock_session", "experiment": experiment, "session_id": sessionid}
        socket.send_string(json.dumps(request), zmq.NOBLOCK)
        response = json.loads(socket.recv_string(zmq.NOBLOCK))
        socket.close()

        if not response["success"]:
            raise Exception(response["error"])
    finally:
        socket.close()
        context.term()


def main(job: str, crawlers: int) -> int:
    sessions = None

    # Main loop
    try:
        while True:
            if sessions is not None and len(sessions) == 0:
                print("Scheduled tasks for all requested sites")
                break

            # Check if there are free tasks -> no free crawlers
            if Task.get_or_none(job=job, state='free') is not None:
                time.sleep(60)
                continue

            activetasks: int = Task.select().where(Task.job == job, Task.state == 'progress').count()

            print(f"{activetasks}/{crawlers} crawlers working")

            # Check if there are two free crawlers
            if  activetasks >= (crawlers - 1):
                time.sleep(60)
                continue

            # Get session
            site = None if sessions is None else sessions.pop()
            session: Optional[str] = lock_session(job, site)
            if session is None:
                if sessions is None:
                    print("No session")
                else:
                    print(f"Failed to get session for {site}, retrying later")
                    sessions.append(site)

                time.sleep(60)
            else:
                print("Locked session " + session)
    except KeyboardInterrupt:
        pass

    return 0

if __name__ == '__main__':
    # Preparing command line argument parser
    args_parser = argparse.ArgumentParser()
    args_parser.add_argument("-j", "--job", type=str, required=True, help="unique job id for crawl")
    args_parser.add_argument("-c", "--crawlers", type=int, required=True, help="how many crawlers are running")

    # Parse command line arguments
    args = vars(args_parser.parse_args())
    sys.exit(main(args.get('job'), args.get('crawlers')))
