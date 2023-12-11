#!/bin/bash

PROJECT_ROOT=$1
STDOUT_LOG_PATH=$2
STDERR_LOG_PATH=$3


# Start up all crawlers
for i in `seq $4 $5`; do
    echo "[spawn] Starting crawler with id $i";
    node --max-old-space-size=16384 $PROJECT_ROOT/dist/index.js "${@:6}" 2>> $STDERR_LOG_PATH/crawler$i.log >> $STDOUT_LOG_PATH/crawler$i.log &
    sleep 1
done