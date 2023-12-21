FROM mcr.microsoft.com/playwright:v1.40.0-jammy

# install required packages
RUN apt-get update -y
RUN DEBIAN_FRONTEND=noninteractive apt-get install -y python3-pip x11vnc fluxbox gnome-terminal dbus-x11 xvfb libpq-dev postgresql sudo

# setup unprivileged user
RUN useradd -ms /bin/bash pycrawler

# copy into container to /pycrawler, use this as workdir and own by unprivileged user
COPY ./src /pycrawler

# install python requirements
RUN python3 -m pip install -r /pycrawler/requirements.txt

# make sure the /pycrawler directory is accessible to the user
WORKDIR /pycrawler
RUN chown -R pycrawler /pycrawler

# allow unprivileged user to use sudo without password
RUN echo "pycrawler ALL=(ALL) NOPASSWD: ALL">/etc/sudoers.d/pycrawler

# run as unprivileged user
USER pycrawler

# execute entry script
ENTRYPOINT ["/bin/bash", "/pycrawler/entrypoint.sh"]
