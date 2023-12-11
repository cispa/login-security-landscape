import pathlib
import sys
from datetime import timedelta, datetime
from typing import Optional

import db
from playhouse.shortcuts import model_to_dict
from playwright.sync_api import Browser, BrowserContext, Playwright, sync_playwright
from typing_extensions import Type


def duplicate_free_task(
    table: Type[db.Task], task: db.Task, recording=False, task_type="auto"
):
    """Duplicate a task (to recreate as manual)."""
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
                table.task_type,
            },
        ),
        actor=None,
        status="free",
        recording=recording,
        task_type=task_type,
    )


def complete_task(task: db.Task, task_status: str):
    task.status = task_status
    task.save()


def get_task_account(account):
    """Get acconut data from an account instance."""
    return (
        account.credentials.email,
        account.credentials.username,
        account.credentials.password,
        account.credentials.identity.first_name,
        account.credentials.identity.last_name,
    )


def validate(task: db.ValidateTask):
    """Auto validate task."""
    task_status = "completed"
    # Get relevant fields needed for automatic verification
    account = get_task_account(task.session.account)
    site: str = task.session.account.website.site
    landing_page: str = task.session.account.website.landing_page
    session: db.Session = task.session

    # Check if session is newly created (less than 12 hours)
    recent: bool = (datetime.now() - session.creation_time) < timedelta(hours=12)
    # Additionnaly check if session was manually created (manual validation tasks are only scheduled if recent==true)
    recent = recent and session.actor != "auto"

    # Initialize Playwright
    playwright: Playwright = sync_playwright().start()
    chromium: Browser = playwright.chromium.launch(headless=False)
    chromium_context: BrowserContext = chromium.new_context(
        storage_state=f"auth/{session.name}.json"
    )
    firefox: Browser = playwright.firefox.launch(headless=False)
    firefox_context: BrowserContext = firefox.new_context(
        storage_state=f"auth/{session.name}.json"
    )

    # Get login page and prioritize those with previous success
    login_page: Optional[aa_LoginForm] = aa_LoginForm.get_or_none(
        (aa_LoginForm.site == site) & aa_LoginForm.success
    )
    login_page = login_page or aa_LoginForm.get_or_none(aa_LoginForm.site == site)

    success_chromium: bool = False
    success_firefox: bool = False

    # Verify login in Chromium and Firefox
    success_chromium = Login.verify_login(
        chromium,
        chromium_context,
        landing_page,
        login_page.formurl if login_page is not None else None,
        account,
    )
    success_firefox = Login.verify_login(
        firefox,
        firefox_context,
        landing_page,
        login_page.formurl if login_page is not None else None,
        account,
    )

    # Update session if validation failed
    if not (success_chromium or success_firefox):
        # Recent manual login: schedule manual validate task
        if recent:
            duplicate_free_task(
                db.ValidateTask, task, recording=False, task_type="manual"
            )
        # Not a manual login or not a recent login: schedule new auto login task
        else:
            # 1. After login task (session is marked as active) -> switch to broken
            # 2. After being expired -> stay expired
            if session.session_status == db.SessionStatus.get(
                db.SessionStatus.name == "expired"
            ):
                session.session_status = db.SessionStatus.get(
                    db.SessionStatus.name == "expired"
                )
            elif session.session_status == db.SessionStatus.get(
                db.SessionStatus.name == "active"
            ):
                session.session_status = db.SessionStatus.get(
                    db.SessionStatus.name == "broken"
                )
            else:
                print(
                    f"Error: SessionStatus should not be {session.session_status.name} in auto validate task!"
                )
            session.verified = False

            new_task: db.LoginTask = db.LoginTask.create(
                account=task.session.account, task_type="auto"
            )

        task.validate_result = "Not logged-in"
    # Validation success: session is valid
    else:
        session.session_status = db.SessionStatus.get(db.SessionStatus.name == "active")
        session.verified = True
        session.verified_browsers = (
            "Chromium,Firefox"
            if (success_chromium and success_firefox)
            else ("Chromium" if success_chromium else "Firefox")
        )
        task.validate_result = "Logged-in"

    # Update session
    session.verify_type = "auto"
    session.save()

    if success_chromium:
        chromium_context.storage_state(path=f"auth/{session.name}.json")
    else:
        firefox_context.storage_state(path=f"auth/{session.name}.json")

    # Free resources
    chromium_context.close()
    firefox_context.close()
    chromium.close()
    firefox.close()
    playwright.stop()
    return task_status


def login(task: db.LoginTask):
    """Auto login task."""
    task_status = "completed"
    # Get relevant fields needed for automatic login
    account = get_task_account(task.account)
    site: str = task.account.website.site
    landing_page: str = task.account.website.landing_page
    accountid: int = task.account.id
    session_name: str = f"{str(accountid)}-{datetime.now().strftime('%Y-%m-%d')}-{site}"

    # Initialize Playwright
    playwright: Playwright = sync_playwright().start()
    browser = playwright.chromium.launch(headless=False)
    context: BrowserContext = browser.new_context(storage_state=None)

    # Get login URLs from database (Ordered by success)
    loginurls = (
        aa_LoginForm.select()
        .where(aa_LoginForm.site == site)
        .order_by(aa_LoginForm.success)
    )

    success: bool = False

    # Iterate over login URLs until login is successful
    loginurl: aa_LoginForm
    for loginurl in loginurls:
        # Try to log in
        success = Login.login(browser, context, landing_page, loginurl.formurl, account)

        # Update login URL success
        loginurl.success = success
        loginurl.save()

        if not success:
            continue

        # Store context
        context.storage_state(path=f"auth/{session_name}.json")
        break

    # Free resources
    context.close()
    browser.close()
    playwright.stop()

    # Schedule new manual login task if not successful
    if not success:
        duplicate_free_task(db.LoginTask, task, recording=False, task_type="manual")
        session_status: db.SessionStatus = db.SessionStatus.get(
            db.SessionStatus.name == "broken"
        )
        login_result: db.LoginResult = db.LoginResult.get(
            db.LoginResult.name == "auto failed"
        )
        task.account.status = db.AccountStatus.get(db.AccountStatus.name == "unclear")
    # Schedule auto validate task if successful
    else:
        session_status: db.SessionStatus = db.SessionStatus.get(
            db.SessionStatus.name == "active"
        )
        login_result: db.LoginResult = db.LoginResult.get(db.LoginResult.name == "lsp")
        task.account.status = db.AccountStatus.get(db.AccountStatus.name == "active")

    # Create session and save info
    task.login_result = login_result
    session: db.Session = db.Session.create(
        actor="auto",
        name=session_name,
        session_status=session_status,
        login_result=login_result,
        account=accountid,
    )
    task.account.session = session
    task.account.save()

    # Schedule new auto validate task
    if success:
        db.ValidateTask.create(session=session, task_type="auto")

    return task_status


str_to_th = {"validate": (db.ValidateTask, validate), "login": (db.LoginTask, login)}


def main(task_id: str, task_type: str) -> int:
    """Process a task."""
    table, handler = str_to_th[task_type]
    task: db.Task = table.get_or_none(id=task_id)
    if task is None:
        print(f"{datetime.now()}: Cannot claim task {task_id}, {task_type}")
        return 0
    task.status = "processing"
    task.save()
    print(
        f"{datetime.now()}: Starting task: {table}: {model_to_dict(task, recurse=False)}"
    )
    task_status = handler(task)
    complete_task(task, task_status)
    print(f"{datetime.now()}: Completed task: {task_status}")

    return 0


if __name__ == "__main__":
    sys.path = [
        str((pathlib.Path(__file__).parent / "account_automation").resolve())
    ] + sys.path
    from account_automation.modules.findloginforms import aa_LoginForm
    from account_automation.modules.login import Login

    sys.exit(main(sys.argv[1], sys.argv[2]))
