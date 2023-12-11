#!/bin/bash

export APP_USER=demouser

# Transfer ownsership of directory
mkdir -p logs auth dirs register validate login

chown -R $APP_USER:$APP_USER .

# Make sure display can be started
rm -f /tmp/.X99-lock

# Create home directory for unprivileged user (if it doesn't yet exist)
mkdir -p /home/$APP_USER
# Change ownership of home directory to unprivileged user
chown -R $APP_USER:$APP_USER /home/$APP_USER
# Set the home directory to this directory
export HOME=/home/demouser

# Run the rest as an unprivileged user
su -s /bin/bash -m demouser -c "./entrypoint-unprivileged.sh"
