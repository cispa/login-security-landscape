import httpx
import os
import db
import pathlib
import sys
import datetime


def test_login():
    """Test if demo.dashpress.io works."""
    data_login = {
        "rememberMe": True,
        "username": "root",
        "password": "password",
    }
    url_login = "https://demo.dashpress.io/api/auth/signin"
    # POST request for user login
    response_login = httpx.post(url_login, json=data_login)
    # Login successful
    if response_login.status_code == 200 or response_login.status_code == 201:
        # print("Test login successful", response_login.status_code)
        pass
    else:
        assert (
            response_login.status_code > 201
        ), f"Failed to login with response code: {response_login.status_code}"


def create_auto_login_task(identity):
    site = "demo.dashpress.io"
    origin = "https://demo.dashpress.io"
    rank = -1
    bucket = -1
    website, _ = db.Website.get_or_create(
        origin=origin,
        site=site,
        landing_page=origin + "/",
        t_rank=rank,
        c_bucket=bucket,
        crux_date=None,
        tranco_date=None,
    )
    aa_RegistrationForm.get_or_create(
        job="demo",
        crawler=1,
        site=site,
        depth=0,
        formurl=origin + "/auth",
        formurlfinal=origin + "/auth",
    )
    aa_LoginForm.get_or_create(
        job="demo",
        crawler=1,
        site=site,
        depth=0,
        formurl=origin + "/auth",
        formurlfinal=origin + "/auth",
    )
    credentials, _ = db.Credentials.get_or_create(
        website=website,
        identity=identity,
        username="root",
        email="",
        password="password",
    )
    account, _ = db.Account.get_or_create(
        credentials=credentials,
        website=website,
        actor="Demo",
        account_status=1,
        registration_result=1,
        registration_note="",
    )

    # Create auto login task:
    # Usually this should succeed and result in an auto validation task + a valid session that can be used
    db.LoginTask.create(account=account, task_type="auto")
    print(f"Created auto login task for {origin}.")
    # Create a manual login task:
    db.LoginTask.create(account=account, task_type="manual")
    print(
        f"Created manual login task for {origin}. (If this task succeeds, there are two sessions for the same account (chaos; use in demo mode only))"
    )


def create_manual_registration_task(identity):
    site = "stable.demo.geonode.org"
    origin = "https://stable.demo.geonode.org"
    rank = -1
    bucket = -1
    website, _ = db.Website.get_or_create(
        origin=origin,
        site=site,
        landing_page=origin + "/",
        t_rank=rank,
        c_bucket=bucket,
        crux_date=None,
        tranco_date=None,
    )
    aa_RegistrationForm.get_or_create(
        job="demo",
        crawler=1,
        site=site,
        depth=0,
        formurl=origin + "/account/signup/?next=/",
        formurlfinal=origin + "/account/signup/?next=/",
    )
    aa_LoginForm.get_or_create(
        job="demo",
        crawler=1,
        site=site,
        depth=0,
        formurl=origin + "/account/login/?next=%2Faccount%2Fsignup%2F%3Fnext%3D%2F",
        formurlfinal=origin
        + "/account/login/?next=%2Faccount%2Fsignup%2F%3Fnext%3D%2F",
    )
    # Create manual register task
    # Register Task -> auto login task -> auto validate task
    db.RegisterTask.create(website=website, identity=identity)
    print(
        f"Created manual registration task for {origin}. Account activation mail might land in the spam."
    )


if __name__ == "__main__":
    # Prepare path to the account automation and import relevant modules
    path_aa: str = str((pathlib.Path(__file__).parent / "account_automation").resolve())
    sys.path = [path_aa] + sys.path

    from account_automation.modules.findregistrationforms import aa_RegistrationForm
    from account_automation.modules.findloginforms import aa_LoginForm

    # Create dummy identity
    identity, _ = db.Identity.get_or_create(
        username=os.getenv("i_username") + "demo",
        email=os.getenv("gmail_mail").split("@")[0] + "+demo@gmail.com",
        password=os.getenv("i_pw"),
        first_name=os.getenv("i_firstName"),
        last_name=os.getenv("i_lastName"),
        gender=os.getenv("i_gender"),
        country=os.getenv("i_country"),
        zip_code=os.getenv("i_postalCode"),
        city=os.getenv("i_city"),
        address=os.getenv("i_address1"),
        birthday=datetime.datetime.strptime(os.getenv("i_birthday"), "%Y-%m-%d"),
        phone=os.getenv("i_phone"),
    )

    # Create an auto + manual login task on https://demo.dashpress.io
    test_login()
    create_auto_login_task(identity)

    # Create a manual registration task on https://stable.demo.geonode.org/
    create_manual_registration_task(identity)
