#!/bin/bash

# make sure to launch browser guis such that we can see them in VNC
export DISPLAY=:99

# make sure we use the correct config file :)
export PYTHONPATH=/pycrawler/demo/headers:/pycrawler

# go to pycrawler directory
cd /pycrawler/

# we launch a little demo account framework that just returns dummy data
python3 ./demo/demo_session.py -j demoheaders

echo "Experiment demoheaders starting with two crawlers on three sites: example.com, ieee-security.org, arxiv.org"

echo "This might take a while. You can watch the experiment via VNC or the logs in /pycrawler/logs"

# now launch the actual experiment
python3 main.py -m HeadersExperiment -j demoheaders -c 2

echo "Experiment demoheaders completed"
echo "You can inspect the raw results in the database or run the sample analysis file"
