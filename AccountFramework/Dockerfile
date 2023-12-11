# Playwright Container Base
FROM mcr.microsoft.com/playwright:v1.40.0-jammy

ENV TZ=Europe/Berlin
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone


# Install requirements
RUN apt-get update -y
RUN apt-get install -y build-essential libpq-dev x11vnc fluxbox gnome-terminal dbus-x11 software-properties-common python3-pip

# Install requirements
COPY ./app /app
RUN python3 -m pip install wheel setuptools
RUN python3 -m pip install -r /app/requirements.txt

# Create new user
ENV APP_USER=demouser
RUN groupadd -r $APP_USER
RUN useradd -u 1001 -r -g $APP_USER -d /home/$APP_USER -s /sbin/nologin -c "Docker image user" $APP_USER

# Set working directory to /app
WORKDIR /app

# Install bitwarden CLI
RUN npm install -g @bitwarden/cli