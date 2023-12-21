#!/bin/bash

export PYTHONPATH=/pycrawler/demo/headers:/pycrawler
cd /pycrawler/demo/analysis
jupyter lab --ip 0.0.0.0 --port 8888
