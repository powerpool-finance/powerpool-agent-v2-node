#!/bin/bash

while true; do
    ts-node app/App.ts "$@"
    EXIT_CODE=$?

    if [ $EXIT_CODE -eq 2 ] || [ $EXIT_CODE -eq 0 ]; then
        echo "ShellNodeWrapper: Restarting application..."
    elif [ $EXIT_CODE -eq 1 ]; then
        echo "ShellNodeWrapper: Critical error occurred, stopping..."
        exit 1
    else
        echo "ShellNodeWrapper: Application stopped with exit code $EXIT_CODE, restarting..."
    fi
done
