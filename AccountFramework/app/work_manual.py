import os
import pathlib
import signal
import subprocess
import sys
import time
import traceback
import argparse
from datetime import datetime
from typing import Optional, Type
import shutil
import tempfile
import json
from playwright.sync_api import sync_playwright, Page, BrowserContext

import bullet
import db
from playhouse.shortcuts import model_to_dict
from bw_helper import update_or_create_login

parser = argparse.ArgumentParser()
parser.add_argument(
    "--mode",
    type=str,
    default="validate,login,register",
    help="Mode to run: register_only for only registration tasks everything else for all tasks",
)


def choice_list(question, choices, choice_type=bullet.Bullet):
    """Pretty print a choice list."""
    cli = choice_type(
        prompt=f"\n{question}",
        choices=choices,
        indent=0,
        align=5,
        margin=2,
        bullet="\u261E",
        bullet_color=bullet.colors.bright(bullet.colors.foreground["cyan"]),
        word_color=bullet.colors.bright(bullet.colors.foreground["yellow"]),
        word_on_switch=bullet.colors.bright(bullet.colors.foreground["yellow"]),
        background_color=bullet.colors.background["black"],
        background_on_switch=bullet.colors.background["black"],
        pad_right=5,
    )

    return cli.launch()


def datetime_valid(dt_str):
    """Check whether a str is a valid iso date."""
    try:
        datetime.fromisoformat(dt_str)
    except:
        return False
    return True


def change_data(
    object: db.Model,
    question="Did you change any settings? Choose from the items below (selection with space):",
    choices=[
        "None",
        "username",
        "email",
        "password",
        "first_name",
        "last_name",
        "birthday",
        "gender",
    ],
):
    """Bullet dialog to change data in a db model."""
    cli = bullet.Check(prompt=question, choices=choices)
    result = cli.launch()
    if not "None" in result:
        for entry in result:
            getting_valid = True
            while getting_valid:
                cli = bullet.Input(f"New {entry}: ")
                result = cli.launch()
                if entry == "birthday":
                    if datetime_valid(result):
                        pass
                    else:
                        print("Please enter a valid date: YYYY-MM-DD!")
                        continue
                setattr(object, entry, result)
                getting_valid = False
    return object


def get_notes():
    return input(
        "Please leave any additional notes here (press enter to leave empty): "
    )


def get_task(table: Type[db.Task], actor) -> Optional[db.Task]:
    """Get the next available task."""
    with db.db.atomic():
        task: Optional[db.Task] = table.get_or_none(
            status="free", task_type="manual", priority=0
        )
        if task is None:
            task: Optional[db.Task] = table.get_or_none(
                status="free", task_type="manual"
            )
        if task is not None:
            task.actor = actor
            task.status = "progress"
            task.save()
    return task


def duplicate_free_task(
    table: Type[db.Task], task: db.Task, recording: bool, priority: int = 0
):
    """Duplicate a task. (e.g., to redo without recording)"""
    # Duplicate task, save one as 'completed', the other as 'free'
    table.create(
        **model_to_dict(
            task,
            recurse=False,
            exclude={
                table.creation_time,
                table.id,
                table.status,
                table.actor,
                table.recording,
                table.priority,
            },
        ),
        actor=None,
        status="free",
        recording=recording,
        priority=priority,
    )


def complete_task(task: db.Task):
    task.status = "completed"
    task.save()


def run_bw_browser(playwright, task_type, session, url):
    """Start the browser with the bitwarden browser extension active."""
    # Always load browser extension state, perform user action, save storage state
    path_to_extension = "./bitwarden"
    # Use one custom directory for each worker
    # Copy the directory after setup, and always reset to that state!
    base_user_data_dir = "./dirs/base-dir"
    with tempfile.TemporaryDirectory() as temp_dir:
        # Copy the contents of the source directory to the temporary directory
        shutil.copytree(base_user_data_dir, temp_dir, dirs_exist_ok=True)
        context: BrowserContext = playwright.chromium.launch_persistent_context(
            temp_dir,
            accept_downloads=False,
            chromium_sandbox=True,
            headless=False,
            args=[
                f"--disable-extensions-except={path_to_extension}",
                # Is this necessary? Does it do anything?
                f"--load-extension={path_to_extension}",
                "",
            ],
            # Do not open the "Chrome is being controlled by automated test software." bar; only works with chromium_sandbox=True
            ignore_default_args=["--enable-automation"],
        )
        # Close the automatically opened bitwarden homepage
        page = context.wait_for_event("page")
        page.close()
        # Use the automatically opened about:blank page to navigate somewhere useful
        page: Page = context.pages[0]
        page.goto(url)

        # Wait until user is finished.
        _ = bullet.YesNo(
            "Press enter if finished. Do not close the browser manually."
        ).launch()

        # If login; save storage state (remove the bitwarden cookies!)
        if task_type == "login":
            data = context.storage_state()
            cookies = [
                entry
                for entry in data["cookies"]
                if not entry.get("domain", "").endswith("bitwarden.com")
            ]
            localStorage = [
                entry
                for entry in data["origins"]
                if not entry.get("origin", "").endswith("bitwarden.com")
            ]
            data = {"cookies": cookies, "origins": localStorage}
            with open(f"auth/{session}.json", "w") as file:
                json.dump(data, file)

        # Cleanup
        context.close()


def open_browser(
    session: str, url: str, folder: str, recording: bool
) -> Optional[Exception]:
    """Either open browser with bitwarden or open a default playwright browser."""
    if os.getenv("use_bitwarden") == "true":
        with sync_playwright() as playwright:
            try:
                run_bw_browser(playwright, task_type=folder, session=session, url=url)
            except Exception as e:
                print(
                    f"Did you close the browser directly instead of continuing on the command line? Error: {e}"
                )

    else:
        # Record worker actions if recording is True
        if recording:
            args = [
                "playwright",
                "codegen",
                "--target=python",
                "--output",
                f"{folder}/{session}.py",
            ]
        else:
            args = ["playwright", "open"]
        # Save network traffic
        args += ["--browser", "chromium", "--save-har", f"{folder}/{session}.har"]
        # Save or load storage (cookies and local storage): Save for login, load for validate, nothing for register
        args += ["--save-storage", f"auth/{session}.json"] + (
            ["--load-storage", f"auth/{session}.json"] if folder == "validate" else []
        )
        # Full screen
        args += ["--viewport-size", "1920,540"]
        # URL to open
        args += [url]

        try:
            print(
                "Close the browser manually when finished (do not close the GMAIL browser)."
            )
            process = subprocess.Popen(args)
            process.wait()
        except Exception as e:
            traceback.print_exc()
            return e


def validate(task: db.ValidateTask):
    """Manual validation task."""
    # Get relevant fields needed for login validation
    landing_page: str = task.session.account.website.landing_page
    session: db.Session = task.session

    print(f"Please verify that we are logged in on {landing_page}")
    # Give worker time to process the task description
    time.sleep(2)

    # Open playwright to validate
    error: Optional[Exception] = open_browser(
        session.name, landing_page, "validate", task.recording
    )

    if task.recording:
        result: str = choice_list(
            question="Select the most appopriate choice:",
            choices=[
                "Logged-in",
                "Not logged-in",
                "unclear (recording issues)",
                "other (please leave details in the notes)",
            ],
        )
    else:
        result: str = choice_list(
            question="Select the most appopriate choice:",
            choices=[
                "Logged-in",
                "Not logged-in",
                "other (please leave details in the notes)",
            ],
        )

    # Mark session as verifed if sessions works
    if result == "Logged-in":
        session.session_status = db.SessionStatus.get(db.SessionStatus.name == "active")
        session.verified = True
        session.verified_browsers = "Chromium"
    elif result == "unclear (recording issues)":
        session.verified = False
        session.verified_browsers = ""
        duplicate_free_task(db.ValidateTask, task, recording=False)
    else:
        session.session_status = db.SessionStatus.get(db.SessionStatus.name == "broken")
        session.verified = False
        session.verified_browsers = ""

        # Schedule a new login task
        new_task: db.LoginTask = db.LoginTask.create(
            account=task.session.account, task_type="auto"
        )

    # Update task and session
    note: str = get_notes()
    task.note = note
    task.validate_result = result
    session.verify_type = "manual"
    session.save()
    task.session.account.validation_note = task.note
    task.session.account.save()


def login(task: db.LoginTask):
    """Manual login task."""
    # Get relevant fields needed for manual login
    site: str = task.account.website.site
    landing_page: str = task.account.website.landing_page
    accountid: int = task.account.id
    session: str = f"{str(accountid)}-{datetime.now().strftime('%Y-%m-%d')}-{site}"
    credentials: db.Credentials = task.account.credentials

    # Check for existing login page in DB and prioritize those with previous success
    login_page: Optional[aa_LoginForm] = aa_LoginForm.get_or_none(
        (aa_LoginForm.site == site) & aa_LoginForm.success
    )
    login_page = login_page or aa_LoginForm.get_or_none(aa_LoginForm.site == site)
    if login_page is not None:
        landing_page = login_page.formurl

    # Display task to worker
    print(
        f"Please log in to {landing_page} using the credentials username={credentials.username}, email={credentials.email}, password={credentials.password}"
    )
    if task.account.registration_note:
        print("Registration note: ", end=None)
        print(task.account.registration_note)

    # Give worker time to process the task description
    time.sleep(2)

    # Open playwright to login
    error: Optional[Exception] = open_browser(
        session, landing_page, "login", task.recording
    )

    # Get login result
    choices: list[str] = list(
        map(
            lambda x: x.note,
            db.LoginResult.select().where(db.LoginResult.name != "auto failed"),
        )
    )
    note: str = choice_list("Did you manage to login?", choices)
    login_result: db.LoginResult = db.LoginResult.get(db.LoginResult.note == note)

    if login_page is not None:
        login_page.status = login_result.success
        login_page.save()

    if not login_result.success:
        if login_result.name == "recording":
            duplicate_free_task(db.LoginTask, task, recording=False)
        elif (
            not login_result.name == "account issues"
            and task.recording
            and bullet.YesNo(
                "Do you think the task would succeed without recording interference?",
                default="n",
            ).launch()
        ):
            duplicate_free_task(db.LoginTask, task, recording=False)
        elif (
            login_result.name == "page issues"
            and bullet.YesNo(
                "Do you think the issues were temporary and we should try the task again?",
                default="n",
            ).launch()
        ):
            duplicate_free_task(
                db.LoginTask, task, recording=task.recording, priority=-1
            )

    # Add notes
    note: str = get_notes()
    task.login_result = login_result
    task.note = note

    # Create a new session
    session_status: db.SessionStatus = (
        db.SessionStatus.get(db.SessionStatus.name == "active")
        if login_result.success
        else db.SessionStatus.get(db.SessionStatus.name == "broken")
    )
    session: db.Session = db.Session.create(
        name=session,
        actor=task.actor,
        session_status=session_status,
        login_result=login_result,
        account=accountid,
    )

    # Update account status (e.g., set to blocked or unclear if login was not successful)
    task.account.account_status = (
        db.AccountStatus.get(db.AccountStatus.name == "active")
        if login_result.success
        else (
            db.AccountStatus.get(db.AccountStatus.name == "blocked")
            if login_result.name == "account issues"
            else db.AccountStatus.get(db.AccountStatus.name == "unclear")
        )
    )
    task.account.login_note = task.note
    task.account.session = session
    task.account.save()

    # Schedule a new validation task
    if login_result.success:
        new_task: db.ValidateTask = db.ValidateTask.create(
            session=session, task_type="auto"
        )


def register(task: db.RegisterTask):
    """Manual registration task."""
    # Get required fields for login validation
    site: str = task.website.site
    landing_page: str = task.website.landing_page
    username: str = task.identity.username
    e1, e2 = task.identity.email.split("@")
    email: str = f"{e1}+{site}@{e2}"
    password: str = task.identity.password
    birthday: str = task.identity.birthday
    first_name: str = task.identity.first_name
    last_name: str = task.identity.last_name
    gender: str = task.identity.gender
    session: str = f"0-{datetime.now().strftime('%Y-%m-%d')}-{site}"

    # Create or update bitwarden credentials
    if os.getenv("use_bitwarden") == "true":
        update_or_create_login([site, username, password, email])

    # Check for existing registration page in DB
    reg_form: Optional[aa_RegistrationForm] = aa_RegistrationForm.get_or_none(
        aa_RegistrationForm.site == site
    )
    if reg_form:
        reg_page = reg_form.formurl
    else:
        reg_page = landing_page

    print(
        f"Please register on {task.website.origin} using the credentials: username={username}, email={email}, password={password}, first name={first_name}, last name={last_name}, birthday={birthday}, gender={gender}"
    )
    # Give worker time to process the task description
    time.sleep(2)

    # Open playwright to register and wait until the worker closes the browser or it crashes
    error: Optional[Exception] = open_browser(
        session, reg_page, "register", task.recording
    )

    # Get registration result
    choices: list[str] = [r.note for r in db.RegistrationResult.select()]
    reg_result: db.RegistrationResult = db.RegistrationResult.get(
        db.RegistrationResult.note
        == choice_list("Select the most appropriate outcome:", choices)
    )

    # If task failed and recording: ask worker whether to repeat the task without recording or whether there were page issues
    if not reg_result.success:
        if reg_result.name == "recording":
            duplicate_free_task(db.RegisterTask, task, recording=False)
        elif (
            task.recording
            and bullet.YesNo(
                "Do you think the task would succeed without recording interference?",
                default="n",
            ).launch()
        ):
            duplicate_free_task(db.RegisterTask, task, recording=False)
        elif (
            reg_result.name == "page issues"
            and bullet.YesNo(
                "Do you think the issues were temporary and we should try the task again?",
                default="n",
            ).launch()
        ):
            duplicate_free_task(
                db.RegisterTask, task, recording=task.recording, priority=-1
            )

    note: str = get_notes()
    task.registration_result = reg_result
    task.note = note

    # Create or update credentials
    credentials, _ = db.Credentials.get_or_create(
        website=task.website,
        identity=task.identity,
        username=username,
        email=email,
        password=password,
    )
    # Ask for changes in credentials if success
    if reg_result.success or reg_result.name == "partial":
        credentials = change_data(
            credentials, choices=["None", "username", "email", "password"]
        )
        credentials.save()

    # Select correct account status
    account_status: db.AccountStatus
    if reg_result.success:
        account_status = db.AccountStatus.get(db.AccountStatus.name == "active")
    elif reg_result.name == "partial":
        account_status = db.AccountStatus.get(db.AccountStatus.name == "unclear")
    else:
        account_status = db.AccountStatus.get(db.AccountStatus.name == "no account")

    # Create or update account (update, e.g., if task got repeated due to recording issues)
    account, _ = db.Account.get_or_create(credentials=credentials, website=task.website)
    db.Account.update(
        actor=task.actor,
        session=None,
        account_status=account_status,
        registration_result=reg_result,
        registration_note=task.note,
    ).where(db.Account.id.in_([account])).execute()
    task.account = account
    # Update bitwarden credentials (update does not matter if nothing got changed)
    if os.getenv("use_bitwarden") == "true":
        update_or_create_login(account)

    # Schedule a new auto login task if registration was successful
    if reg_result.success:
        new_task: db.LoginTask = db.LoginTask.create(account=account, task_type="auto")


def main(mode: str) -> int:
    """Loop through tasks until no tasks are left or user wants to quit."""
    # Name of the worker
    actor: str = input("Please enter your name to get started: ")

    validate_tasks = len(
        db.ValidateTask()
        .select()
        .where(db.ValidateTask.task_type == "manual", db.ValidateTask.status == "free")
    )
    login_tasks = len(
        db.LoginTask()
        .select()
        .where(db.LoginTask.task_type == "manual", db.LoginTask.status == "free")
    )
    register_tasks = len(
        db.RegisterTask()
        .select()
        .where(db.RegisterTask.task_type == "manual", db.RegisterTask.status == "free")
    )
    print(
        f"There are {validate_tasks} validate tasks, {login_tasks} login tasks, and {register_tasks} register tasks available."
    )
    # Open the GMAIL browser window
    mail = subprocess.Popen(
        [
            "playwright",
            "open",
            "--browser",
            "firefox",
            "--load-storage",
            "auth/0-gmail.json",
            "--save-storage",
            "auth/0-gmail.json",
            "https://mail.google.com/mail/u/2/#inbox",
        ],
        start_new_session=True,
    )

    # Main loop
    try:
        while True:
            task: Optional[db.Task] = None

            # For the setup phase, we only want to create accounts
            if mode == "register_only":
                tasks = [(db.RegisterTask, register)]
            else:
                # Iterate over tasks in terms of priority
                # LoginTasks are only assigned if no validate tasks are left
                # RegisterTasks are only assigned if no login tasks are left
                # Tasks with negative priority are assigned last in a category
                tasks = [
                    (db.ValidateTask, validate),
                    (db.LoginTask, login),
                    (db.RegisterTask, register),
                ]

            for table, handler in tasks:
                task = get_task(table, actor)
                if task is None:
                    continue

                handler(task)
                complete_task(task)
                break

            # Stop if no task was done
            if task is None:
                print("All tasks completed!")
                break

            # Stop if worker has enough
            if not bullet.YesNo("Continue with next task?").launch():
                break
    except Exception as e:
        traceback.print_exc()
    finally:
        # Kill mail browser
        os.killpg(os.getpgid(mail.pid), signal.SIGTERM)

    # Exit
    return 0


if __name__ == "__main__":
    aapath = str((pathlib.Path(__file__).parent / "account_automation").resolve())
    sys.path = [aapath] + sys.path
    from account_automation.modules.findloginforms import aa_LoginForm
    from account_automation.modules.findregistrationforms import aa_RegistrationForm

    args = parser.parse_args()
    sys.exit(main(args.mode))
