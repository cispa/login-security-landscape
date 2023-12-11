#!/bin/bash
PROJECT_ROOT=$1
STDOUT_LOG_PATH=$2
STDERR_LOG_PATH=$3
DATA_PATH=$4

# Build the crawler code
echo "[prepare] Building the crawler code.";
npm run build

# Clear (error) log directories
if [ ! -d "$STDOUT_LOG_PATH" ]; then
  echo "[prepare] STDOUT_LOG_PATH does not exist. Creating new log directory at " $STDOUT_LOG_PATH
  mkdir -p $STDOUT_LOG_PATH
fi

if [ ! -d "$STDERR_LOG_PATH" ]; then
  echo "[prepare] STDERR_LOG_PATH does not exist. Creating new error log directory at " $STDERR_LOG_PATH
  mkdir -p $STDERR_LOG_PATH
fi

if [ ! -d "$DATA_PATH" ]; then
  echo "[prepare] DATA_PATH does not exist. Creating new error log directory at " $DATA_PATH
  mkdir -p $DATA_PATH
fi

if [ ! -z "$(ls -A $STDOUT_LOG_PATH)" ]; then
   echo "[prepare] STDOUT_LOG_PATH not empty"  
   exit 1
fi

if [ ! -z "$(ls -A $STDERR_LOG_PATH)" ]; then
   echo "[prepare] STDERR_LOG_PATH not empty"  
   exit 1
fi

if [ ! -z "$(ls -A $DATA_PATH)" ]; then
   echo "[prepare] DATA_PATH not empty"  
   exit 1
fi

echo "[prepare] Checked log files successfully..."

# Run the setup script
echo "[prepare] Executing the setup script."
node --max-old-space-size=16384 $PROJECT_ROOT/dist/setup/index.js "${@:5}" --datapath $DATA_PATH