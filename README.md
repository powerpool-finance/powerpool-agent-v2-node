# PowerPool Agent V2 Keeper Node

The node monitors onchain events and execute jobs when required.
This node is distributed via docker images.

Detailed instructions on how to setup a Keeper Node
are located here https://github.com/powerpool-finance/powerpool-agent-v2-compose.

### App exit codes

0. Not an actual error, but some condition when it's better to restart an entire app. Used for some event handlers.
1. Critical errors. Should stop the app. For ex. worker address not found, can't resolve RPC, etc.
2. Non-critical errors. Should restart the app. For ex. hanged WS endpoint connection.
