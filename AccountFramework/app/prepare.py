import argparse
import csv
import pathlib
import subprocess
import sys
import os
import httpx
import gzip
import traceback
from datetime import datetime
from typing import Optional

import db
import tld
from tranco import Tranco


def download_and_unzip(url, save_folder):
    """Download and unzip a URL."""
    zip_path = os.path.join(save_folder, url.split("/")[-1])
    output_file_path = zip_path.split(".gz")[0]
    try:
        os.makedirs(save_folder)
    except:
        pass

    if os.path.exists(output_file_path):
        return output_file_path

    # Download the file using httpx
    with httpx.stream("GET", url, follow_redirects=True) as response:
        if response.status_code == 200:
            # Save the file
            with open(zip_path, "wb") as file:
                for chunk in response.iter_bytes():
                    file.write(chunk)

            # Unzip the file
            with gzip.open(zip_path, "rt") as gz_file:
                with open(output_file_path, "w") as output_file:
                    output_file.write(gz_file.read())

            print("File downloaded and unzipped successfully")
            return output_file_path
        else:
            raise Exception(
                f"Failed to download file. Status code: {response.status_code}"
            )


def _prepare_aa_urls(crux_link: str, line_start: int, line_end: int):
    """Prepare the crawl tasks for account automation."""

    # Prepare date if needed
    src = download_and_unzip(crux_link, "crux/")
    date = crux_link.split("/")[-1].split(".")[0]

    t = Tranco(cache=True, cache_dir=".tranco")
    t_list = t.list(date="2023-01-30")

    # Read URLs file
    with open(src, "r") as src_file:
        reader = csv.reader(src_file)
        next(reader)

        for i, line in enumerate(reader):
            # Skip lines out of range
            if line_start > i + 1 or line_end < i + 1:
                continue

            # Based on CrUX, choose correct site, origin, rank, bucket
            bucket: int = int(line[1])
            origin: str = line[0]
            site: str = tld.get_tld(origin, as_object=True).fld
            rank: int = t_list.rank(site)

            website: Optional[db.Website] = db.Website.get_or_none(
                db.Website.site == site
            )
            # Skip website if we already crawled it once before
            if website is not None:
                continue

            # Prepare account automation task
            website = db.Website.create(
                origin=origin,
                site=site,
                landing_page=(origin + "/"),
                t_rank=rank,
                c_bucket=bucket,
                crux_date=date,
                tranco_date="2023-01-30",
            )
            task: aa_Task = aa_Task.create(
                job=datetime.now().strftime("%Y%m%d"),
                site=site,
                url=origin,
                landing_page=(origin + "/"),
                rank=rank,
            )


def main(crux_link: str, start: int, count: int, identity: int, crawlers: int) -> int:
    """Starts the account automation to find login and registration forms, and prepares manual registration tasks

    :param crux_link: URL to CRUX dataset
    :param start: starting site identified by rank
    :param count: the amount of URLs to prepare
    :param identity: id of the Identity instance
    :type crawlers: int (how many crawlers to start in parallel)
    :returns: 0
    :rtype: int
    """

    # Prepare the account automation
    end = start + count - 1
    _prepare_aa_urls(crux_link, start, end)

    # Search for registration and login forms with <CRAWLERS> crawlers
    try:
        print(
            f"Searching for Login and Registration Forms on {count} Websites with {crawlers} parallel crawlers. This might take a while."
        )
        aa = subprocess.Popen(
            [
                "python3",
                path_aa + "/main.py",
                "--modules",
                "FindRegistrationForms FindLoginForms",
                "--job",
                datetime.now().strftime("%Y%m%d"),
                "--crawlers",
                str(crawlers),
            ]
        )
        aa.wait()
    except Exception as e:
        traceback.print_exc()
        print(e)
        return 1

    print("Finished searching for forms. Adding Registration Tasks now.")

    # Add registration tasks for all sites where both registration and login form were discovered
    subquery = db.RegisterTask.select(db.RegisterTask.website)
    subquery = db.Website.select(db.Website.site).where(db.Website.id.in_(subquery))
    sites_regform = (
        aa_RegistrationForm.select(aa_RegistrationForm.site)
        .distinct()
        .where(aa_RegistrationForm.site.not_in(subquery))
    )
    sites_loginregform = (
        aa_LoginForm.select(aa_LoginForm.site)
        .distinct()
        .where(aa_LoginForm.site.in_(sites_regform))
    )

    identity: db.Identity = db.Identity.get_by_id(identity)

    # Iterate over sites with login and registration, schedule registration task
    for site in sites_loginregform:
        website = db.Website.get(site=site.site)
        db.RegisterTask.create(
            website=website, identity=identity, account=None, recording=True
        )
        url = aa_Task.get(site=site.site)
        website.landing_page = url.landing_page
        website.save()

    return


if __name__ == "__main__":
    # Prepare path to the account automation and import relevant modules
    path_aa: str = str((pathlib.Path(__file__).parent / "account_automation").resolve())
    sys.path = [path_aa] + sys.path

    try:
        with open("config.py", "r") as config, open(
            path_aa + "/config.py", "w"
        ) as configaa:
            configaa.write(config.read())
    except Exception:
        # Ignored
        pass

    from account_automation.database import aa_Task
    from account_automation.modules.findregistrationforms import aa_RegistrationForm
    from account_automation.modules.findloginforms import aa_LoginForm

    # Arguments parsing
    parser = argparse.ArgumentParser(
        description="Search for login and registration forms and add registration tasks if found.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument(
        "--count", type=int, required=True, help="How many sites to prepare"
    )
    parser.add_argument(
        "--crux_link", type=str, required=True, help="URL to CRUX dataset"
    )
    parser.add_argument(
        "--identity",
        type=int,
        required=True,
        help="Id (int) of the Identity instance to create registration tasks",
    )
    parser.add_argument(
        "--start",
        type=int,
        default=1,
        help="Starting site (identified by line number in the CSV file)",
    )
    parser.add_argument(
        "--crawlers", type=int, default=20, help="How many crawlers to start"
    )
    args = parser.parse_args()

    sys.exit(main(args.crux_link, args.start, args.count, args.identity, args.crawlers))
