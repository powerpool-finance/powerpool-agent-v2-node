#!/bin/bash

while true; do
    ts-node app/App.ts "$@"
    EXIT_CODE=$?

    if [ $EXIT_CODE -eq 2 ] || [ $EXIT_CODE -eq 0 ]; then
        echo "Restarting application..."
    elif [ $EXIT_CODE -eq 1 ]; then
        echo "Critical error occurred, stopping..."
        exit 1
    else
        echo "Application stopped with exit code $EXIT_CODE, restarting..."
    fi
done
