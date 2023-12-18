#!/bin/bash
CWD=$(pwd)

# Check if should start insecure webserver containing sample pages for testing (environment variable START_INSECURE_WEBSERVER)
if [[ "$START_INSECURE_WEBSERVER" == "true" ]]; then 
    node $CWD/snippets/insecure-webpages/server.js &
fi

# Start display & VNC Server for headfull crawling. Connect via IP:5900
echo "[entrypoint] Starting the Xvfb screen and VNC"
export DISPLAY=:99

rm -f /tmp/.X99-lock
Xvfb $DISPLAY -screen 0 1920x1080x24 -nolisten tcp -nolisten unix &
fluxbox -log $CWD/fluxbox.log &

# Start VNC server for remote connection
sleep 1
x11vnc -display $DISPLAY -bg -shared -forever -passwdfile $VNC_PASSWORD_FILE -xkb -rfbport 5900 >> $CWD/x11vnc.log

echo "[entrypoint] Startup complete"
tail -f /dev/null