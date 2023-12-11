#!/bin/bash
CWD=$(pwd)
TIMESTAMP=$(date '+%Y_%m_%d_%H_%M_%S')

POSTGRES_DB="$EXPERIMENT"___"$TIMESTAMP"
STDOUT_LOG_PATH=/typescript-crawler-data/crawl_$TIMESTAMP/log      # Path for normal log output
STDERR_LOG_PATH=/typescript-crawler-data/crawl_$TIMESTAMP/err      # Path for error log output
DATA_PATH=/typescript-crawler-data/crawl_$TIMESTAMP/data           # Path for crawl artifacts

PGPASSWORD=$POSTGRES_PASSWORD psql -h $POSTGRES_HOST -U $POSTGRES_USER -c "CREATE DATABASE $POSTGRES_DB;";
export POSTGRES_DB=$POSTGRES_DB;

# Make postgres database name available for analysis script
echo "POSTGRES_DB=$POSTGRES_DB" >> .env;

# Prepare database and check disk folders
./setup/prepare.sh $CWD $STDOUT_LOG_PATH $STDERR_LOG_PATH $DATA_PATH --module $EXPERIMENT 

# To start the crawlers using a sample csv file, run. CSV format should be: rank,domain
# [!IMPORTANT] If using this method, make sure to disable starti ng the ZMQ listener by setting ZMQ_ENABLE to false
# ./setup/prepare.sh $CWD $STDOUT_LOG_PATH $STDERR_LOG_PATH $DATA_PATH --module $EXPERIMENT --fill --csv [path-to-your-csv]

# Check if should skip stop between preparing of db and crawler start
if [ "$1" != "-y" ]; then
    read -p "[experiment] Do you want to start the crawl? (yY/nN) " yn

    case $yn in 
    y|Y ) echo "yes";;
    n|N ) exit 1;;
    * ) exit 1;;
    esac
fi

# Check if should start insecure webserver containing sample pages for testing (environment variable START_INSECURE_WEBSERVER)
if [[ "$START_INSECURE_WEBSERVER" == "true" ]]; then 
    node $CWD/snippets/insecure-webpages/server.js &
fi

# Start display & VNC Server for headfull crawling. Connect via IP:5900
echo "[experiment] Starting the Xvfb screen and VNC"
rm -f /tmp/.X99-lock
Xvfb :99 -screen 0 1920x1080x24 -nolisten tcp -nolisten unix &

sleep 1
x11vnc -display :99 -bg -shared -forever -passwd $VNC_PASSWORD -xkb -rfbport 5900 >> $STDOUT_LOG_PATH/x11vnc.log
export DISPLAY=:99 && fluxbox -log $STDOUT_LOG_PATH/fluxbox.log &

# Spawn all workers using spawn.sh script. Each crawler is assigned a local id during startup (incremented by 1 until $CRAWLER_COUNT is reached)
# In total, CRAWLER_COUNT - CRAWLER_START + 1 crawlers are spawned
# [$CRAWLER_START] The first argument: Beginning crawler id
# [$CRAWLER_COUNT] The second argument: Maximum crawler id
# Further arguments: Passed directly to crawler process. Format is defined in `config/parser.ts`
CRAWLER_START=1     # Id of first crawler to start
CRAWLER_COUNT=10    # Number of seperate crawlers to start (max. cap on crawler id, incremented during start)
POLLING_INTERVAL=5  # Interval crawlers look into database for new tasks in seconds

if [[ "$EXPERIMENT" == "cxss" ]]; then 
    BROWSER_EXECUTABLE_PATH=/foxhound/build/obj-tf-release/dist/bin/foxhound    # Location of the browser engine to use with playwright
    # To start cxss, we specify firefox and browser executable path (set to foxhound binary):
    export DISPLAY=:99 && ./setup/spawn.sh $CWD $STDOUT_LOG_PATH $STDERR_LOG_PATH $CRAWLER_START $CRAWLER_COUNT --module $EXPERIMENT --headfull --polling $POLLING_INTERVAL --datapath $DATA_PATH --forever  --firefox  --browser_executable_path $BROWSER_EXECUTABLE_PATH
fi

if [[ "$EXPERIMENT" == "pmsecurity" ]]; then 
    # To start pmsecurity, we just speciy the --chromium browser flag
    export DISPLAY=:99 && ./setup/spawn.sh $CWD $STDOUT_LOG_PATH $STDERR_LOG_PATH $CRAWLER_START $CRAWLER_COUNT --module $EXPERIMENT --headfull --polling $POLLING_INTERVAL --datapath $DATA_PATH --forever  --chromium 
fi 

# Start ZMQ session fetcher
if [[ "$ZMQ_ENABLE" == "true" ]]; then 
    ZMQ_FETCH_INTERVAL=60   # Interval which is waited between calls to ZMQ server for new session in seconds
    if [[ "$DEMO_MODE" == "true" ]]; then 
    echo "[spawn] Starting zmq listener for session fetching in demo mode."
        node --max-old-space-size=16384 $CWD/dist/utils/zmq/zmq-listener.js --crawlers $CRAWLER_COUNT --fetchinterval $ZMQ_FETCH_INTERVAL --demo 2>> $STDERR_LOG_PATH/zmq-listener.log >> $STDOUT_LOG_PATH/zmq-listener.log  &
    else 
    echo "[spawn] Starting zmq listener for session fetching."
        node --max-old-space-size=16384 $CWD/dist/utils/zmq/zmq-listener.js --crawlers $CRAWLER_COUNT --fetchinterval $ZMQ_FETCH_INTERVAL 2>> $STDERR_LOG_PATH/zmq-listener.log >> $STDOUT_LOG_PATH/zmq-listener.log &
    fi
fi

echo "[experiment] Started the experiment"
sleep infinity
