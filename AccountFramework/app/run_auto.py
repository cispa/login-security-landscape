import subprocess
import argparse
import multiprocessing
from multiprocessing.pool import Pool
import datetime
from typing import Optional
import time
from typing_extensions import Type
import sys
import traceback
import db

import functools

print = functools.partial(print, flush=True)
_print = print


def print(*args, **kw):
    _print("[%s]" % (datetime.datetime.now()), *args, **kw)


class Tee(object):
    """Helper for better logging (to a file)."""
    def __init__(self, filename, name):
        self.file = open(f"{filename}", "a")
        self.stdout = sys.stdout
        self.name = name

    def __enter__(self):
        sys.stdout = self
        return self.file

    def __exit__(self, exc_type, exc_value, tb):
        sys.stdout = self.stdout
        if exc_type is not None:
            self.file.write(traceback.format_exc())
        self.file.close()

    def write(self, data):
        if data != "\n" and data != " " and data != "":
            data = f"{self.name}: {data}"
        self.file.write(data)
        self.stdout.write(data)

    def flush(self):
        self.file.flush()
        self.stdout.flush()


parser = argparse.ArgumentParser()
parser.add_argument("--num_workers", type=int, default=20)
LOG_BASE = "logs/00"


def get_task(table: Type[db.Task]) -> Optional[db.Task]:
    """Try to select a free task."""
    # Atomic transaction
    with db.db.atomic():
        subquery = (
            table.select(table.id)
            .where((table.status == "free") & (table.task_type == "auto"))
            .limit(1)
            .for_update()
        )
        tasks = (
            table.update(status="selected", actor="auto")
            .where(table.id.in_(subquery))
            .returning(table)
            .execute()
        )

    return tasks[0] if len(tasks) > 0 else None


def complete_task(task: db.Task, task_status: str):
    task.status = task_status
    task.save()
    print(f"{task._meta.table_name}-{task}: {task_status}")


def run_task(task_id: db.Task, task_type: str, task_timeout: int = 600):
    """Start the work_auto.py script on a task."""
    process_number = multiprocessing.current_process().name.split("-")[1]
    with Tee(f"{LOG_BASE}_0_main.log", f"worker-{process_number}"):
        with open(f"{LOG_BASE}_auto_{process_number}.log", "a") as f:
            try:
                subprocess.run(
                    ["python3", "work_auto.py", str(task_id), task_type],
                    stdout=f,
                    stderr=f,
                    timeout=task_timeout,
                    check=True,
                )
            except subprocess.TimeoutExpired:
                # Log task as timeout
                task_status = "timeout"
                complete_task(task_id, task_status)
            except subprocess.CalledProcessError:
                # Log task as failed
                task_status = "failed"
                complete_task(task_id, task_status)
            except Exception as e:
                print(
                    f"{task_id._meta.table_name}-{task_id}: Unexpected exception: {e}!"
                )


def main(num_workers: int):
    """Loop foreven and start auto tasks if available."""
    p = Pool(processes=num_workers)
    # Main loop
    print_sleep = True
    with Tee(f"{LOG_BASE}_0_main.log", "main"):
        while True:
            # Iterate through tables in order of priority
            for table, task_type in [
                (db.ValidateTask, "validate"),
                (db.LoginTask, "login"),
            ]:
                # Try to get task
                task: Optional[db.Task] = get_task(table)
                # Try the other task type if possible
                if task is None:
                    continue
                p.apply_async(run_task, [task, task_type])
                # Break to start from scratch again
                print_sleep = True
                break
            else:
                # No task was found, wait a bit for tasks to come available
                if print_sleep:
                    print("No Task found sleeping")
                    print_sleep = False
                time.sleep(60)


if __name__ == "__main__":
    args = parser.parse_args()
    main(args.num_workers)
