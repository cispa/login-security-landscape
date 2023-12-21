#!/bin/bash

# Start remote desktop (Xvfb, fluxbox and x11vnc)
export DISPLAY=:99
rm -f /tmp/.X99-lock
Xvfb $DISPLAY -screen 0 1920x1080x24 -nolisten tcp -nolisten unix &
fluxbox -log fluxbox.log &
x11vnc -display $DISPLAY -bg -shared -forever -passwdfile $VNC_PASSWORD_FILE -xkb -rfbport 5900

# Load information from env file
source $BW_ENV_FILE
source $IDENTITY_FILE


# Start Account Framework API + Automated Workers
if [[ -z "$WORKER" ]]; then
    # Bitwarden: Login, start HTTP API
    if [[ "$use_bitwarden" == true ]]; then
        bw login --apikey
        bw serve --port 9999 --hostname 0.0.0.0 &
        # Unlock BW API
        curl -X POST http://localhost:9999/unlock -d "{\"password\": \"${BW_PASSWORD}\"}" -H 'Content-Type: application/json'
    fi
    # Setup db and rerun documentation creation
    python3 db.py
    python3 db_documenter.py
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