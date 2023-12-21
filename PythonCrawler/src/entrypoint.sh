#!/bin/bash

# make sure playwright is in path
export PATH=$PATH:/home/pycrawler/.local/bin

# setup database
sudo service postgresql restart
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname = '$POSTGRES_DB';" | grep -q 1 || sudo -u postgres psql -c "CREATE DATABASE $POSTGRES_DB;"
sudo -u postgres psql $POSTGRES_DB -c "ALTER USER postgres WITH PASSWORD '$(cat $POSTGRES_PASSWORD_FILE | tr -d '\n')';"
# dummy run which will initialize the database
PYTHONPATH=/pycrawler/demo/headers:/pycrawler python3 main.py -m "InclusionIssues HeadersExperiment" -j null -c 1

# Start remote desktop (Xvfb, fluxbox and x11vnc)
export DISPLAY=:99
rm -f /tmp/.X99-lock
Xvfb $DISPLAY -screen 0 1920x1080x24 -nolisten tcp -nolisten unix &
fluxbox -log fluxbox.log &
x11vnc -display $DISPLAY -bg -shared -forever -passwdfile $VNC_PASSWORD_FILE -xkb -rfbport 5900

echo "Startup complete"
tail -f /dev/null
