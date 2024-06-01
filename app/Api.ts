import Fastify from 'fastify';
import { BigNumber } from 'ethers';
import { App } from './App.js';
import { toChecksummedAddress, hashOfPubKey, hashOfPrivateKey } from './Utils.js';
import logger from './services/Logger.js';

export async function initApi(app: App, port: number): Promise<() => void> {
  console.log('initApi');
  const EC = (await import('elliptic')).default.ec;
  const elipticCurve = new EC('secp256k1');

  const fastify = Fastify({
    logger: true,
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
    console.log('fastify get /api/v1');
    const response = {
      config: app.getConfig(),
      networks: app.getNetworkList(),
    };
    prettyReply(reply, response);
  });

  function getAgentWithWorkerAddress(workerAddress) {
    const networkList = app.getNetworkList();
    for (const n of networkList) {
      const network = app.getNetwork(n);
      const agents = network.getAgents();
      for (const a of agents) {
        if (a.getWorkerSignerAddress().toLowerCase() === workerAddress.toLowerCase()) {
          return a;
        }
      }
    }
    return null;
  }

  fastify.get('/api/v1/public-key-hash/:address', (request, reply) => {
    const agent = getAgentWithWorkerAddress(request.params['address']);
    const wallet = agent.getWorkerSigner();
    reply.code(200).send({ hash: hashOfPubKey(wallet, elipticCurve) });
  });

  fastify.get('/api/v1/private-key-hash/:address', (request, reply) => {
    const agent = getAgentWithWorkerAddress(request.params['address']);
    const wallet = agent.getWorkerSigner();
    reply.code(200).send({ hash: hashOfPrivateKey(wallet) });
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

  fastify.listen(
    {
      host: process.env.API_HOST || '127.0.0.1',
      port: parseInt(process.env.API_PORT) || port || 8099,
    },
    (err, address) => {
      logger.info(`API Server: Listening on ${address}`);
      if (err) throw err;
      // Server is now listening on ${address}
    },
  );

  return async function stop() {
    return fastify.close();
  };
}
