#!/bin/bash

export PYTHONPATH=/baf/demo/headers:/baf
cd /baf/demo/analysis
jupyter lab --ip 0.0.0.0 --port 8888
