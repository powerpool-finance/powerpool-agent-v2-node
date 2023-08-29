#!/bin/sh

while true; do
    node /usr/app/dist/Cli.js "$@"
    EXIT_CODE=$?

    if [ $EXIT_CODE -eq 2 ] || [ $EXIT_CODE -eq 0 ]; then
        echo "ShellNodeWrapper: Exit code $EXIT_CODE. Restarting application..."
    elif [ $EXIT_CODE -eq 1 ]; then
        echo "ShellNodeWrapper: Exit code $EXIT_CODE. Critical error occurred, stopping..."
        exit 1
    else
        echo "ShellNodeWrapper: Application stopped with exit code $EXIT_CODE, restarting..."
    fi
done
