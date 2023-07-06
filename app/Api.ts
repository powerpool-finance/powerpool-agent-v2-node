import Fastify from 'fastify';
import { BigNumber } from 'ethers';
import { App } from './App.js';
import { toChecksummedAddress } from './Utils.js';

export function initApi(app: App, port: number) {
  const fastify = Fastify({
    logger: false,
  });

  function prettyReply(reply, response) {
    reply.type('application/json').send(
      JSON.stringify(
        response,
        (key, value) => {
          if (typeof value === 'bigint') {
            return value.toString();
          } else if (typeof value === 'object' && value instanceof BigNumber) {
            return value.toString();
          } else {
            return value;
          }
        },
        2,
      ),
    );
  }

  fastify.get('/api/v1', (request, reply) => {
    const response = {
      config: app.getConfig(),
      networks: app.getNetworkList(),
    };
    prettyReply(reply, response);
  });

  fastify.get('/api/v1/networks/:networkName', (request, reply) => {
    const network = app.getNetwork(request.params['networkName']);
    if (!network) {
      reply.code(404).send({ error: 'Network not found' });
    }
    prettyReply(reply, network.getStatusObjectForApi());
  });

  fastify.get('/api/v1/networks/:networkName/:agentAddress', (request, reply) => {
    const agentAddress = request.params['agentAddress'];
    const networkName = request.params['networkName'];
    const checkSummedAgentAddress = toChecksummedAddress(agentAddress);

    if (agentAddress !== checkSummedAgentAddress) {
      reply.redirect(`/api/v1/networks/${networkName}/${checkSummedAgentAddress}`);
    }

    const network = app.getNetwork(networkName);
    if (!network) {
      reply.code(404).send({ error: 'Network not found' });
    }
    const agent = network.getAgent(checkSummedAgentAddress);
    if (!agent) {
      reply.code(404).send({ error: 'Agent not found' });
    }

    prettyReply(reply, agent.getStatusObjectForApi());
  });

  fastify.listen({ port: parseInt(process.env.API_PORT) || port }, (err, address) => {
    console.log(`API Server listening on ${address}`);
    if (err) throw err;
    // Server is now listening on ${address}
  });
}
