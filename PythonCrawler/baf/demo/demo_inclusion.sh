#!/bin/bash

# make sure to launch browser guis such that we can see them in VNC
export DISPLAY=:99

# make sure we use the correct config file :)
export PYTHONPATH=/baf/demo/inclusions:/baf

# go to baf directory
cd /baf/

# we launch a little demo account framework that just returns dummy data
python3 ./demo/demo_session.py -j demoinclusions

# now launch the actual experiment
python3 main.py -m InclusionIssues -j demoinclusions -c 1
