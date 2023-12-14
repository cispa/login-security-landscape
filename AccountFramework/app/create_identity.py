import db
import os
import datetime

# Create the default identity at startup
identity: db.Identity = db.Identity.get_or_create(
    username=os.getenv("i_username"),
    email=os.getenv("gmail_mail"),
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
)[0]

print(f"The id of the default identity is: {identity}")
