import os

secrets_path = "secrets"
os.makedirs(secrets_path, exist_ok=True)

# VNC password
with open(f"{secrets_path}/vnc_password.txt", "w") as f:
    f.write("secure")

# DB password
with open(f"{secrets_path}/db_password.txt", "w") as f:
    f.write("postgres")

# Bitwarden
with open(f"{secrets_path}/bw_env.sh", "w") as f:
    f.write("""export BW_MAIL=''
export BW_CLIENTSECRET=''
export BW_CLIENTID=''
export BW_PASSWORD=''
""")

# Bitwarden
with open(f"{secrets_path}/identity.sh", "w") as f:
    f.write("""# Identity Information for both Bitwarden and the Account Framework Identity Table
# NOTE: fill the following
# GMAIL: used both for mail verification 
export gmail_pw="email-password"
export gmail_mail="email"
# Identity base values
export i_identity_name="Demo Identity"
export i_birthday="1990-01-01"
export i_gender="male"
export i_pw="password"
export i_title="Mr"
export i_firstName="Firstname"
export i_middleName="Middlename"
export i_lastName="Lastname"
export i_address1="Address 1"
export i_city="City"
export i_state="State"
export i_postalCode="0000"
export i_country="Country"
export i_company="Company"
export i_phone="+4900000000000"
export i_ssn="000-123-4567"
export i_username="username"
export i_passportNumber="DE-123456789"
export i_licenseNumber="D123-12-123-12333"
""")
