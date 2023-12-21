#!/bin/bash
CWD=$(pwd)
 
echo "[kill] Killing crawler management processes";
kill $(pgrep -f node\ --max-old-space-size=16384\ $CWD/dist/index.js);

echo "[kill] Killing individual crawler processes";
kill $(pgrep -f node\ --max-old-space-size=16384\ $CWD/dist/crawler/visit.js);

echo "[kill] Killing zmq listener process";
kill $(pgrep -f node\ --max-old-space-size=16384\ $CWD/dist/utils/zmq/zmq-listener.js);

if [[ $EXPERIMENT == "pmsecurity" ]]; then
    echo "[kill] Killing processes belonging to pmsecurity"
    kill $(pgrep -f python3\ ./snippets/pmxss/python/ConstraintSolver.py);
elif [[ $EXPERIMENT == "cxss" ]]
then
    echo "[kill] Killing processes belonging to cxss"
    kill $(pgrep foxhound);
    kill $(pgrep -f snippets/cxss/exploit-generator/src/main_filearg.py);
else
    echo "[kill] No module specific processess killed"
fi