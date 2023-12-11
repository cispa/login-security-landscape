#!/bin/bash
CWD=$(pwd)

MODULE=$1

node --max-old-space-size=16384 $CWD/dist/snippets/analysis.js --module $MODULE