#!/bin/bash

# Start remote desktop
export DISPLAY=:99
Xvfb $DISPLAY -screen 0 1920x1080x24 & fluxbox -log fluxbox.log & x11vnc -display $DISPLAY -bg -shared -forever -nopw -quiet -xkb -rfbport 5900 -passwdfile $VNC_PASSWORD_FILE

# Load information from env file
source $BW_ENV_FILE
source $IDENTITY_FILE


# Start Account Framework API + Automated Workers
if [[ -z "$WORKER" ]]; then
    # Bitwarden: Login, start HTTP API
    bw login --apikey
    bw serve --port 9999 --hostname 0.0.0.0 &
    # Setup db and rerun documentation creation
    python3 db.py
    python3 db_documenter.py
    # Wait for DB to be ready
    sleep 5
    # Unlock BW API
    curl -X POST http://localhost:9999/unlock -d "{\"password\": \"${BW_PASSWORD}\"}" -H 'Content-Type: application/json'
    # Setup the identity
    python3 create_identity.py
    # Start the API
    watchmedo auto-restart --patterns="api.py" python3 api.py &
    watchmedo auto-restart --patterns="expire_sessions.py;api.py" python3 expire_sessions.py &
    # Start automated workers
    python3 run_auto.py
# Stay alive for Manual Mode
else
    echo "Worker stay alive!"
    tail -f /dev/null
fi