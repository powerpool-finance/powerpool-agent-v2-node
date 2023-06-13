import { parseRawJob } from '../app/Utils.js';
import { assert } from 'chai';

const JOB1 = '0x6308d07800012c0100000000006e000a000000002386f2383cdbcd0000000005';
const JOB2 = '0x000000000000000200000000006e000a0000000000000000000000770da85207';

describe('Utils.parseRawJob()', () => {
  it('should correctly parse JOB1', async () => {
    const parsed = parseRawJob(JOB1);
    assert.equal(parsed.lastExecutionAt, 1661522040);
    assert.equal(parsed.intervalSeconds, 300);
  });

  it('should correctly parse JOB2', async () => {
    const parsed = parseRawJob(JOB2);
    assert.equal(parsed.lastExecutionAt, 0);
    assert.equal(parsed.intervalSeconds, 0);
  });

  it('should throw with a job with an invalid length', async () => {
    assert.throw(() => {
      parseRawJob('0x0200000000006e000a0000000000000000000000770da85207');
    }, 'Utils.parseRawJob(): rawJob has length 52, but expecting the length of 66');
  });
});

export default null;
