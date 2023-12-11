import httpx
import os
import zipfile

base_url = "http://accf-auto:9999"


def download_and_unzip(url, save_folder):
    """Download and unzip a URL (used to download bitwarden browser extension)."""
    try:
        os.makedirs(save_folder)
    except:
        print("Folder already exists. Skipping download.")
        return

    # Download the file using httpx
    with httpx.stream("GET", url, follow_redirects=True) as response:
        if response.status_code == 200:
            zip_path = os.path.join(save_folder, url.split("/")[-1])

            # Save the file
            with open(zip_path, "wb") as file:
                for chunk in response.iter_bytes():
                    file.write(chunk)

            # Unzip the file
            with zipfile.ZipFile(zip_path, "r") as zip_ref:
                zip_ref.extractall(save_folder)

            print("File downloaded and unzipped successfully")
        else:
            print(f"Failed to download file. Status code: {response.status_code}")


def update_bw(url, method, json=None, params=None):
    """Update bitwarden content/force sync.
    https://bitwarden.com/help/vault-management-api/
    """
    # Sync vault between each important operation!
    r = httpx.post(f"{base_url}/sync", timeout=30)
    if r.status_code != 200:
        print("Sync", r, r.text)
    r = httpx.request(method=method, url=url, json=json, params=params, timeout=30)
    if r.status_code != 200:
        print(f"Perform action: {url}", r, r.text)
    r = httpx.post(f"{base_url}/sync", timeout=30)
    if r.status_code != 200:
        print("Sync", r, r.text)


def update_or_create_identity():
    """Create or update the identity in bitwarden (defined in secrets/identity.sh)"""
    identity_item = {
        "organizationId": None,
        "collectionIds": None,
        "folderId": None,
        "type": 4,
        "name": os.getenv("i_identity_name"),
        "notes": "",
        "favorite": True,
        "fields": [
            {"name": "regex=birthday", "value": os.getenv("i_birthday"), "type": 0},
            {"name": "regex=gender", "value": os.getenv("i_gender"), "type": 0},
            {"name": "regex=password", "value": os.getenv("i_pw"), "type": 0},
        ],
        "login": None,
        "secureNote": None,
        "card": None,
        "identity": {
            "title": os.getenv("i_title"),
            "firstName": os.getenv("i_firstName"),
            "middleName": os.getenv("i_middleName"),
            "lastName": os.getenv("i_lastName"),
            "address1": os.getenv("i_address1"),
            "address2": None,
            "address3": None,
            "city": os.getenv("i_city"),
            "state": os.getenv("i_state"),
            "postalCode": os.getenv("i_postalCode"),
            "country": os.getenv("i_country"),
            "company": os.getenv("i_company"),
            "email": os.getenv("gmail_mail"),
            "phone": os.getenv("i_phone"),
            "ssn": os.getenv("i_ssn"),
            "username": os.getenv("i_username"),
            "passportNumber": os.getenv("i_passportNumber"),
            "licenseNumber": os.getenv("i_licenseNumber"),
        },
        "reprompt": 0,
    }
    r = httpx.get(
        f"{base_url}/list/object/items", params={"search": os.getenv("i_identity_name")}
    ).json()["data"]["data"]
    print(len(r), r)
    if len(r) == 1:
        identity_id = r[0]["id"]
        update_bw(
            url=f"{base_url}/object/item/{identity_id}",
            method="PUT",
            json=identity_item,
        )
    elif len(r) == 0:
        update_bw(url=f"{base_url}/object/item", method="POST", json=identity_item)
    else:
        print("Invalid number of fitting identities!")


def update_or_create_login(account):
    """Create or update a login entry in bitwarden."""
    if type(account) == list:
        site = account[0]
        username = account[1]
        password = account[2]
        email = account[3]
    else:
        creds = account.credentials
        site = account.website.site
        username = creds.username
        password = creds.password
        email = creds.email
    url = f"https://{site}"
    login_item = {
        "organizationId": None,
        "collectionIds": None,
        "folderId": None,
        "type": 1,  # Type 1: login
        "name": f"Login: {site}",
        "notes": None,
        "favorite": False,
        "fields": [{"name": "regex=e.?mail", "value": email, "type": 0}],
        "login": {
            "uris": [
                {"match": 0, "uri": url},
            ],
            "username": username,
            "password": password,
            "totp": None,
        },
        "reprompt": 0,
    }
    r = httpx.get(
        f"{base_url}/list/object/items", params={"search": f"Login: {site}"}
    ).json()["data"]["data"]
    if len(r) == 1:
        identity_id = r[0]["id"]
        update_bw(
            url=f"{base_url}/object/item/{identity_id}", method="PUT", json=login_item
        )
    elif len(r) == 0:
        update_bw(url=f"{base_url}/object/item", method="POST", json=login_item)
    else:
        print("Invalid number of fitting identities!")
