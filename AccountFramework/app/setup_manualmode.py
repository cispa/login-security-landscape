from playwright.sync_api import sync_playwright, Page, BrowserContext
from bw_helper import update_or_create_identity, download_and_unzip
import bullet
import subprocess
import os


path_to_extension = "./bitwarden"
user_data_dir = "./dirs/base-dir"

def setup_bw(playwright):
    """Setup bitwarden browser extension profile"""
    _ = bullet.YesNo("Press enter to launch Chromium to setup the Bitwarden browser extension:").launch()
    context: BrowserContext = playwright.chromium.launch_persistent_context(
        user_data_dir,
        accept_downloads=False,
        chromium_sandbox=True,
        headless=False,
        args=[
            f"--disable-extensions-except={path_to_extension}",
            f"--load-extension={path_to_extension}",
            ""
        ],
        # Do not open the "Chrome is being controlled by automated test software." bar
        ignore_default_args=["--enable-automation"]
    )

    # Close the automatically opened bitwarden homepage
    page = context.wait_for_event("page")
    page.close()
    
    # Use the automatically opened about:blank page
    page: Page = context.pages[0]
    page.goto("about:blank")

    # Wait until user is finished
    _ = bullet.YesNo("Finished bitwarden setup?").launch()
    
    # Cleanup
    context.close()

def setup_gmail():
    mail = os.getenv("gmail_mail")
    pw = os.getenv("gmail_pw")
    _ = bullet.YesNo(f"Press enter to setup the GMAIL profile.\nMail={mail}, PW={pw}").launch()
    print("Close the browser with the X button in the browser.")                     
    subprocess.call(["playwright", "open", "https://mail.google.com", "--browser=firefox", "--save-storage=auth/0-gmail.json"])

with sync_playwright() as playwright:
    if os.getenv("use_bitwarden") == "true":
        # Create the bitwarden identity
        update_or_create_identity() 

        # Download bitwarden browser extension
        download_and_unzip(
            "https://github.com/bitwarden/clients/releases/download/browser-v2023.10.2/dist-chrome-2023.10.2.zip",
            "bitwarden/"
        )
        setup_bw(playwright)
    setup_gmail()