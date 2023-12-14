#!/bin/bash

export APP_USER=demouser

# Transfer ownsership of directory
mkdir -p logs auth dirs register validate login

chown -R $APP_USER:$APP_USER .

# Create home directory for unprivileged user
mkdir -p /home/$APP_USER
# Change ownership of home directory to unprivileged user
chown -R $APP_USER:$APP_USER /home/$APP_USER
# Set the home directory to this directory
export HOME=/home/demouser

# Run the rest as an unprivileged user
su -s /bin/bash -m demouser -c "./entrypoint-unprivileged.sh"
