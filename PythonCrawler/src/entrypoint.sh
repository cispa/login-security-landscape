#!/bin/bash

# Make sure playwright is in path
export PATH=$PATH:/home/pycrawler/.local/bin

# Initialize the database
PYTHONPATH=/pycrawler/demo/headers:/pycrawler python3 main.py -m "InclusionIssues HeadersExperiment" -j null -c 1

# Start remote desktop (Xvfb, fluxbox and x11vnc)
export DISPLAY=:99
rm -f /tmp/.X99-lock
Xvfb $DISPLAY -screen 0 1920x1080x24 -nolisten tcp -nolisten unix &
fluxbox -log fluxbox.log &
x11vnc -display $DISPLAY -bg -shared -forever -passwdfile $VNC_PASSWORD_FILE -xkb -rfbport 5900

echo "Startup complete"
tail -f /dev/null
