import os

secrets_path = "secrets"
os.makedirs(secrets_path, exist_ok=True)

# VNC password
with open(f"{secrets_path}/vnc_password.txt", "w") as f:
    f.write("secure")

# DB password
with open(f"{secrets_path}/db_password.txt", "w") as f:
    f.write("postgres")
