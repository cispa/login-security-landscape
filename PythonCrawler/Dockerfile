FROM mcr.microsoft.com/playwright:v1.40.0-jammy

# install required packages
RUN apt-get update -y
RUN DEBIAN_FRONTEND=noninteractive apt-get install -y python3-pip x11vnc fluxbox gnome-terminal dbus-x11 xvfb libpq-dev postgresql sudo

# setup unprivileged user
RUN useradd -ms /bin/bash baf_user

# copy baf into container to /baf, use this as workdir and own by unprivileged user
COPY ./baf /baf

# install python requirements
RUN python3 -m pip install -r /baf/requirements.txt

# make sure the /baf directory is accessible to the user
WORKDIR /baf
RUN chown -R baf_user /baf

# allow unprivileged user to use sudo without password
RUN echo "baf_user ALL=(ALL) NOPASSWD: ALL">/etc/sudoers.d/baf_user

# run as unprivileged user
USER baf_user

# execute entry script
ENTRYPOINT ["/bin/bash", "/baf/baf_startup.sh"]
