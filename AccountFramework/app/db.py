"""
Database used to store information about sessions and accounts
We use the peewee ORM
"""

import datetime
import os
import pathlib
import sys

from peewee import (
    BooleanField,
    DateField,
    DateTimeField,
    DeferredForeignKey,
    ForeignKeyField,
    IntegerField,
    Model,
    PostgresqlDatabase,
    TextField,
)

# setup database connection wrapper thingy
db = PostgresqlDatabase(
    database=os.environ.get("POSTGRES_DB"),
    user=os.environ.get("POSTGRES_USER"),
    password=pathlib.Path(os.environ.get("POSTGRES_PASSWORD_FILE")).read_text(),
    host=os.environ.get("DB_HOST"),
    port=int(os.environ.get("DB_PORT")),
    autorollback=True,
)


# =========================== #
#        HELPER CLASSES       #
# =========================== #
# Classes that will not get their own table, but will serve as a base for other classes.
# These are:
# - Timestamped
# - Result
# - Status
# - Task


class Timestamped(Model):
    """
    Base class we use for almost everything, as it cannot be wrong to have timestamps.
    """

    creation_time = DateTimeField(
        default=datetime.datetime.now, help_text="Time this entry was created"
    )
    update_time = DateTimeField(
        default=datetime.datetime.now, help_text="Time this entry was last updated"
    )

    def save(self, *args, **kwargs):
        self.update_time = datetime.datetime.now()
        return super(Timestamped, self).save(*args, **kwargs)

    class Meta:
        database = db


class Result(Model):
    """
    Enum which can be extended to include new entries.
    Represents the result attempting to do something
    """

    success = BooleanField(help_text="Whether or not the attempt was successful")
    note = TextField(help_text="Description of the result")
    name = TextField(help_text="Short name")

    class Meta:
        database = db


class Status(Model):
    """
    Enum which can be extended to include new entries.
    Represents the status of a something
    """

    active = BooleanField(help_text="Whether or not the Status is active")
    note = TextField(help_text="Description of the Status")
    name = TextField(help_text="Short name")

    class Meta:
        database = db


class Task(Timestamped):
    """
    Base class for all tasks.
    """

    actor = TextField(
        null=True, default=None, help_text="Name of actor handling this task"
    )
    status = TextField(
        default="free",
        help_text='Current status of this task ("free", "completed", or "progress")',
    )
    priority = IntegerField(
        default=0, help_text="Higher priority means more urgent to be completed"
    )
    task_type = TextField(
        default="manual",
        help_text="How the task should be processed. Currently only 'manual' or 'auto' exist.",
    )
    recording = BooleanField(
        default=False,
        help_text="Whether the task was recorded with codegen or not (no recording is used if bitwarden is used)",
    )
    note = TextField(default="", help_text="Additional notes for a task.")

    def claim():
        pass
        # print(__class__)

    class Meta:
        database = db


# =========================== #
#          SESSIONS           #
# =========================== #
# Everything directly related to sessions.
# Contains:
# - SessionStatus
# - LoginResult
# - Session


class SessionStatus(Status):
    """
    Represents the status of a session.
    """

    class Meta:
        database = db
        table_name = "session_status"


class LoginResult(Result):
    """
    Represents the result of a login attempt.
    """

    class Meta:
        database = db
        table_name = "login_result"


class Session(Timestamped):
    """
    Represents a user session.
    The session can be broken though (status.active == False).
    """

    name = TextField(
        help_text="The name of the session (account_id-time_now-domain); same as the file name"
    )
    actor = TextField(
        null=True,
        default=None,
        help_text="Who created the session (i.e., who performed the login task)",
    )
    session_status = ForeignKeyField(SessionStatus, help_text="Session information")
    login_result = ForeignKeyField(LoginResult, help_text="Login information")
    experiment = TextField(
        null=True,
        default=None,
        help_text="Experiment currently using the session or None.",
    )
    unlock_time = DateTimeField(
        default=datetime.datetime.now,
        help_text="Timestamp until the experiment can use the session (after that it automatically gets unlocked)",
    )
    locked = BooleanField(
        default=False,
        help_text="Whether the session is currently locked (by an experiment)",
    )
    account = DeferredForeignKey(
        "Account",
        help_text="Reference to account associated with this session. We do not use a back-reference here, as we keep old sessions. Thus, one account can be referenced by multiple sessions.<br>since the Account class is defined further down, we need a deferred reference",
    )
    # Auto verified sessions stay valid for N hours, manually verified sessions stay valid for M hours
    verified = BooleanField(
        default=False, help_text="Whether the session is verified (success)"
    )
    verify_type = TextField(
        default="no", help_text="How this session was verified: no, auto, manual"
    )
    verified_browsers = TextField(
        default="",
        help_text="List of browsers the session was successfully verified in.",
    )

    class Meta:
        database = db
        table_name = "sessions"


# =========================== #
#          ACCOUNTS           #
# =========================== #
# This section contains the class for accounts and everything it needs (and isn't defined in prior sections):
# - Website
# - Identity
# - Credentials
# - AccountStatus
# - RegistrationResult
# - Account


class Website(Timestamped):
    """
    represents a website we can create accounts for.
    """

    origin = TextField(help_text="Origin")
    site = TextField(help_text="Site (etld+1)", unique=True)
    landing_page = TextField(help_text="Full URL of the origin landing page")
    t_rank = IntegerField(help_text="Website rank according to Tranco")
    c_bucket = IntegerField(help_text="Website bucket according to CrUX")
    tranco_date = TextField(null=True, default=None, help_text="Tranco date")
    crux_date = TextField(null=True, default=None, help_text="CrUX date")

    class Meta:
        database = db
        table_name = "websites"


class Identity(Timestamped):
    """
    represents a template of personal information.
    Idendities can be "instanciated" into Credentials.
    """

    username = TextField(help_text="Preferred username")
    email = TextField(help_text="Preferred email address", unique=True)
    password = TextField(help_text="Preferred password")
    first_name = TextField(help_text="First name")
    last_name = TextField(help_text="Last name")
    gender = TextField(help_text="Gender")
    country = TextField(help_text="Country")
    zip_code = TextField(help_text="Zip code")
    city = TextField(help_text="City")
    address = TextField(help_text="Address")
    birthday = DateField(help_text="Birthday")
    phone = TextField(help_text="Phone number")
    storage_json = TextField(
        default="",
        help_text="Path to the storage_json of the email account of this identity",
    )

    class Meta:
        database = db
        table_name = "identities"


class Credentials(Timestamped):
    """
    represents credentials required to login and additional User information
    """

    username = TextField(default="", help_text="Username for login")
    email = TextField(default="", help_text="Email for login")
    password = TextField(default="", help_text="Password for login")
    identity = ForeignKeyField(
        Identity, help_text='"Blueprint" for personal information'
    )
    website = ForeignKeyField(
        Website, null=True, help_text="Website the credentials belong to"
    )

    class Meta:
        database = db
        table_name = "credentials"
        # Unique on identity + website
        indexes = ((("identity", "website"), True),)


class AccountStatus(Status):
    """
    Represents the status of an account.
    """

    class Meta:
        database = db
        table_name = "account_status"


class RegistrationResult(Result):
    """
    Represents the result of a register attempt.
    """

    class Meta:
        database = db
        table_name = "registration_result"


class Account(Timestamped):
    """
    Represents a single registered account for a website.
    Each account has exactly one credentials and exactly one session and belongs to exactly one website.
    """

    actor = TextField(null=True, help_text="Who created the account")
    website = ForeignKeyField(
        Website, backref="accounts", help_text="Website the account belongs to"
    )
    credentials = ForeignKeyField(
        Credentials,
        unique=True,
        backref="accounts",
        help_text="Login credentials (and possibly additional information about registered user)",
    )
    session = ForeignKeyField(
        Session,
        unique=True,
        null=True,
        default=None,
        help_text="Active session (may be None)",
    )
    account_status = ForeignKeyField(
        AccountStatus, null=True, help_text="Account status"
    )
    registration_result = ForeignKeyField(
        RegistrationResult, null=True, help_text="Registration information"
    )
    registration_note = TextField(
        default="", help_text="Note for last registration attempt"
    )
    login_note = TextField(default="", help_text="Note of last login attempt")
    validation_note = TextField(default="", help_text="Note of last validation attempt")

    class Meta:
        database = db
        table_name = "accounts"


# =========================== #
#           TASKS             #
# =========================== #
# Tasks are basically jobs we hand out to a HiWi (or an automated tool) to complete.
# There are tasks to:
#  - log into an account (LoginTask)
#  - validate an account (ValidateTask)
#  - register an account (RegisterTask)


class LoginTask(Task):
    """
    Represents a task for someone (or something) to log an account in.
    As a result, the account's session will be replaced with a new session and the account status may change.
    """

    account = ForeignKeyField(
        Account,
        help_text="Account to login (contains everything required to perform the login)",
    )
    login_result = ForeignKeyField(
        LoginResult, null=True, help_text="Outcome of the login task"
    )

    class Meta:
        database = db
        table_name = "login_tasks"


class ValidateTask(Task):
    """
    Represents a task for someone (or something) to validate an active session of an account.
    As a result, the sessions status may change and the validator will be changed.
    If, e.g., the account got suspended, the account status may also be changed.
    """

    session = ForeignKeyField(Session, help_text="Session to re-validation")
    validate_result = TextField(default="", help_text="Outcome of the validation task")

    class Meta:
        database = db
        table_name = "validate_tasks"


class RegisterTask(Task):
    """
    Represents a task for someone (or something) to register an account for the given website with the given credentials.
    As a result, a new entry in the accounts table should appear, even if creation fails.
    This entry should be referenced by :account.
    """

    website = ForeignKeyField(Website, help_text="Website to create an account on")
    identity = ForeignKeyField(Identity, help_text="Identity to use for registration")
    # The account might get overwritten later (if we redo registration for the same site and identity)
    account = ForeignKeyField(
        Account,
        null=True,
        default=None,
        help_text="Account that was created following this request",
    )
    registration_result = ForeignKeyField(
        RegistrationResult,
        null=True,
        default=None,
        help_text="Outcome of a registration task for later analysis",
    )

    class Meta:
        database = db
        table_name = "register_tasks"


# =========================== #
#         EXPERIMENTS         #
# =========================== #
# This section contains all information about ongoing experiments
# - ExperimentWebsite


class ExperimentWebsite(Timestamped):
    """
    Represents information about which websites were used by which experiment
    """

    website = ForeignKeyField(
        Website, help_text="Website that was acquired by the experiment"
    )
    experiment = TextField(help_text="Experiment that acquired the website")
    session = ForeignKeyField(
        Session, null=True, help_text="Session that the experiment received"
    )

    class Meta:
        database = db
        table_name = "experiment_websites"

        # Unique on website and experiment
        indexes = ((("website", "experiment"), True),)


def initialize_db():
    # ===========================#
    #           CONFIG           #
    # ===========================#
    # Copy config to the BAF
    aapath = str((pathlib.Path(__file__).parent / "account_automation").resolve())
    try:
        with open("config.py", "r") as config, open(
            aapath + "/config.py", "w"
        ) as configaa:
            configaa.write(config.read())
    except Exception:
        # Ignored
        pass

    # ===========================#
    #      TABLE CREATION        #
    # ===========================#
    # create all the tables :)
    TABLES = [
        SessionStatus,
        LoginResult,
        Session,
        Website,
        Identity,
        Credentials,
        AccountStatus,
        RegistrationResult,
        Account,
        LoginTask,
        ValidateTask,
        RegisterTask,
        ExperimentWebsite,
    ]
    # These are the tables for the account automation
    sys.path = [aapath] + sys.path
    from account_automation.database import aa_Task, aa_URL
    from account_automation.modules.findregistrationforms import aa_RegistrationForm
    from account_automation.modules.findloginforms import aa_LoginForm

    TABLES = TABLES + [aa_Task, aa_URL, aa_RegistrationForm, aa_LoginForm]
    db.create_tables(TABLES)

    # ===========================#
    #    TABLE INITIALIZATION    #
    # ===========================#
    # add initial values to database, if database is empty
    if SessionStatus.select().count() == 0:
        # --- SessionStatus ---
        SessionStatus.create(
            active=True, name="active", note="Active session (logged-in)"
        )
        SessionStatus.create(active=False, name="expired", note="Session expired")
        SessionStatus.create(
            active=False,
            name="broken",
            note="Broken session (various reasons, e.g., login failed)",
        )

        # --- AccountStatus ---
        AccountStatus.create(active=True, name="active", note="Active account")
        AccountStatus.create(
            active=False,
            name="no account",
            note="Registration failed (no account exist)",
        )
        AccountStatus.create(
            active=False, name="blocked", note="Account got blocked/banned"
        )
        AccountStatus.create(
            active=False,
            name="unclear",
            note="Unclear (everything else; e.g., login is currently not possible, but there is no sign that the account got banned)",
        )

        # --- LoginResult ---
        LoginResult.create(
            success=True,
            name="lsp",
            note="Login successful (password only + no captcha)",
        )
        LoginResult.create(
            success=True,
            name="lspc",
            note="Login successfull (password only + required filling captcha)",
        )
        LoginResult.create(
            success=True,
            name="lse",
            note="Login successful (requires email verification or similar; with and without captcha)",
        )
        LoginResult.create(
            success=False,
            name="account issues",
            note="Issue with the account (e.g., account blocked or invalid credentials) please leave details in the notes",
        )
        LoginResult.create(
            success=False,
            name="login issues ",
            note="Issue with the login (e.g., endless captcha loop, login process is broken) please leave details in the notes",
        )
        LoginResult.create(
            success=False,
            name="page issues",
            note="Issue with the page (e.g., block page, website down) please leave details in the notes",
        )
        LoginResult.create(
            success=False,
            name="recording",
            note="Issues with the recording (or manual error); will reschedule the task without recording.",
        )
        LoginResult.create(
            success=False, name="auto failed", note="Automatic login failed"
        )

        # --- RegistrationResult ---
        RegistrationResult.create(
            success=True,
            name="success",
            note="Success: Registration successful (new account created)",
        )
        RegistrationResult.create(
            success=False,
            name="partial",
            note="Partial: Account was created but the account is stuck at a startup screen or is not activated (e.g., a site requires a phone number after login)",
        )
        RegistrationResult.create(
            success=False,
            name="requirements",
            note="Requirements: Account could not be created due to unsatifsiable requirements (e.g., credit card or phone number required for registration)",
        )
        RegistrationResult.create(
            success=False,
            name="no registration",
            note="No registration: The site has no registration option (or none was found)",
        )
        RegistrationResult.create(
            success=False,
            name="language issues",
            note="Language issues: An account could not be created due to language issues",
        )
        RegistrationResult.create(
            success=False,
            name="duplicate",
            note="Duplicate: The account could not be created as it already existed (for this identity).",
        )
        RegistrationResult.create(
            success=False,
            name="registration issues",
            note="Issues with the registration (e.g., infinite captcha loop, registration process is broken ,...) please leave details in the notes.",
        )
        RegistrationResult.create(
            success=False,
            name="page issues",
            note="Issues with the page (e.g., block page or website down) please leave details in the notes.",
        )
        RegistrationResult.create(
            success=False,
            name="recording",
            note="Issues with the recording (or manual error); will reschedule the task without recording.",
        )

    return TABLES


if __name__ == "__main__":
    initialize_db()
