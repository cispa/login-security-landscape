#!/bin/bash

# set display environment variable
export DISPLAY=:99
# make sure playwright is in path
export PATH=$PATH:/home/baf_user/.local/bin

# setup database
sudo service postgresql restart
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname = '$POSTGRES_DB';" | grep -q 1 || sudo -u postgres psql -c "CREATE DATABASE $POSTGRES_DB;"
sudo -u postgres psql $POSTGRES_DB -c "ALTER USER postgres WITH PASSWORD '$(cat $POSTGRES_PASSWORD_FILE | tr -d '\n')';"
# dummy run which will initialize the database
PYTHONPATH=/baf/demo/headers:/baf python3 main.py -m "InclusionIssues HeadersExperiment" -j null -c 1

# start display
rm -f /tmp/.X99-lock
Xvfb $DISPLAY -screen 0 1920x1080x24 -nolisten tcp -nolisten unix &

# start vnc server (optional)
sleep 1
x11vnc -display $DISPLAY -bg -shared -forever -passwdfile $VNC_PASSWORD_FILE -xkb -rfbport 5900

# start fluxbox (optional)
fluxbox -log fluxbox.log &

echo "Startup complete"
tail -f /dev/null
