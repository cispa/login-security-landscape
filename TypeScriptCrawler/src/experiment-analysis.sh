#!/bin/bash
CWD=$(pwd)

if [[ $EXPERIMENT == "cxss" ]] || [[ $EXPERIMENT == "pmsecurity" ]]; then
    node --max-old-space-size=16384 $CWD/dist/snippets/analysis.js --module $EXPERIMENT
else
    echo "[analysis] Unsupported module name specified for analysis. Supported modules are cxss and pmsecurity."
fi