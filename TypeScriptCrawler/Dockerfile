FROM mcr.microsoft.com/playwright:v1.33.0-focal
ENV TZ=Europe/Berlin
ENV DEBIAN_FRONTEND noninteractive
ARG EXPERIMENT

# install stuff
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone
RUN apt-get update --fix-missing -y
RUN apt-get install -y software-properties-common
RUN add-apt-repository ppa:deadsnakes/ppa
RUN apt-get update --fix-missing -y
RUN apt-get upgrade -y
RUN apt-get install -y build-essential libpq-dev

# Create directory for crawler source & crawler data path
RUN mkdir -p /typescript-crawler
RUN mkdir -p /typescript-crawler-data
RUN mkdir -p /foxhound
WORKDIR /typescript-crawler 
# Copy project source
COPY . . 

# Install VNC and fluxbox to interact with headfull runs
RUN apt-get install -y x11vnc fluxbox

# Install database client
RUN apt-get install -y postgresql-client

# Install python3 and 
RUN apt-get install -y python3.10 python3.10-dev python3-pip
# Install dependencies for pmsecurity experiment (pmforce)
RUN pip3 install z3-solver==4.8.7.0 ply

# Install python2
RUN apt-get install -y python2.7 python2.7-dev
# Install dependencies for cxss experiment (exploit generator)
RUN apt-get install -y libxml2-dev libxslt-dev cmake pkg-config 
RUN mkdir -p /install 
WORKDIR /install
# Install pip for python2 to install exploit generator dependencies later
RUN curl https://bootstrap.pypa.io/pip/2.7/get-pip.py --output get-pip.py
RUN python2.7 get-pip.py 

# Build foxhound if enabled
RUN if [ "$EXPERIMENT" = "cxss" ]; then \
    apt-get install -y wget autoconf2.13 ccache libnspr4-dev software-properties-common git bash findutils gzip libxml2 m4 make perl tar unzip watchman;\
    curl https://sh.rustup.rs -sSf | sh -s -- -y;  \
    ${HOME}/.cargo/bin/rustup install 1.66;\
    ${HOME}/.cargo/bin/rustup default 1.66;\
    ${HOME}/.cargo/bin/rustup override set 1.66;\
    . "$HOME/.cargo/env";\
    mkdir -p /foxhound/build; \
    mkdir -p /foxhound/playwright; \
    git clone --branch v1.33.0 https://github.com/microsoft/playwright.git /foxhound/playwright; \
    GIT_SSL_NO_VERIFY=true git clone https://github.com/SAP/project-foxhound -b main /foxhound/build; \
    cd /foxhound/build; \
    git checkout firefox-release; \
    ./mach --no-interactive bootstrap --application-choice=browser; \
    git checkout 2916e0188bc9; \
    git apply --index --whitespace=nowarn /foxhound/playwright/browser_patches/firefox/patches/*; \
    cp -r /foxhound/playwright/browser_patches/firefox/juggler /foxhound/build/juggler; \
    cp taintfox_mozconfig_ubuntu .mozconfig; \
    sed -i 's/ac_add_options --enable-bootstrap/# ac_add_options --enable-bootstrap/g' .mozconfig; \
    echo "ac_add_options --disable-crashreporter" >> .mozconfig; \
    echo "ac_add_options --disable-backgroundtasks" >> .mozconfig; \
    echo "ac_add_options --enable-release" >> .mozconfig; \
    echo "ac_add_options --without-wasm-sandboxed-libraries" >> .mozconfig; \
    ./mach build; \
    cp /foxhound/playwright/browser_patches/firefox/preferences/00-playwright-prefs.js /foxhound/build/obj-tf-release/dist/bin/browser/defaults/preferences/00-playwright-prefs.js;\
    cp /foxhound/playwright/browser_patches/firefox/preferences/playwright.cfg /foxhound/build/obj-tf-release/dist/bin/playwright.cfg;\
    fi

WORKDIR /typescript-crawler 

# Fetch submodules (pmforce+persistent-clientside-xss)
RUN git submodule update --init --recursive

# Install dependencies for cxss experiment (exploit generator)
WORKDIR /typescript-crawler/snippets/cxss/persistent-clientside-xss/src 
RUN pip install -r requirements.txt

# Go back to crawler directory
WORKDIR /typescript-crawler 

# Install dependencies of crawler code (npm)
RUN npm install

# Make required shell scripts executable
RUN chmod +x experiment-analysis.sh
RUN chmod +x experiment-stop.sh
RUN chmod +x experiment.sh

RUN chmod +x setup/prepare.sh 
RUN chmod +x setup/spawn.sh 

# Install dependencies for test server (local testing)
WORKDIR /typescript-crawler/snippets/insecure-webpages 
RUN npm install

# Add unprivileged user
RUN useradd -ms /bin/bash typescriptcrawler

# Change ownership of relevant files for crawler to new user
RUN chown -R typescriptcrawler /typescript-crawler 
RUN chown -R typescriptcrawler /typescript-crawler-data 
RUN chown -R typescriptcrawler /foxhound

USER typescriptcrawler

# Update workdir
WORKDIR /typescript-crawler 

# Start entrypoint in non-interactive version, to directly run experiment on docker start
ENTRYPOINT ["/bin/bash", "/typescript-crawler/experiment.sh", "-y"]