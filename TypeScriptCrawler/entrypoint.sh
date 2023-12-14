#!/bin/bash
CWD=$(pwd)

# Check if should start insecure webserver containing sample pages for testing (environment variable START_INSECURE_WEBSERVER)
if [[ "$START_INSECURE_WEBSERVER" == "true" ]]; then 
    node $CWD/snippets/insecure-webpages/server.js &
fi

# Start display & VNC Server for headfull crawling. Connect via IP:5900
echo "[entrypoint] Starting the Xvfb screen and VNC"
rm -f /tmp/.X99-lock
Xvfb :99 -screen 0 1920x1080x24 -nolisten tcp -nolisten unix &

sleep 1
x11vnc -display :99 -bg -shared -forever -passwd $VNC_PASSWORD -xkb -rfbport 5900 >> $CWD/x11vnc.log
export DISPLAY=:99 && fluxbox -log $CWD/fluxbox.log &

echo "[entrypoint] Startup complete"
tail -f /dev/null