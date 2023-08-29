import process from 'child_process';
import path from 'path';
import fs from 'fs';

const splitCharacter = '<##>';

async function executeCommand(dirName, command): Promise<string> {
  return new Promise((resolve, reject) => {
    process.exec(command, { cwd: dirName }, function (err, stdout, stderr) {
      if (stdout === '') return reject('this does not look like a git repo');
      if (stderr) return reject(stderr);
      resolve(stdout);
    });
  });
}

const prettyFormat = ['%h', '%H', '%s', '%f', '%b', '%at', '%ct', '%an', '%ae', '%cn', '%ce', '%N', ''];

const getCommandString = splitCharacter =>
  'git log -1 --pretty=format:"' +
  prettyFormat.join(splitCharacter) +
  '"' +
  ' && git rev-parse --abbrev-ref HEAD' +
  ' && git tag --contains HEAD';

let lastCommit;
function getLastCommit(dirName) {
  if (lastCommit) {
    return lastCommit;
  }

  const gitDataPath = path.resolve(dirName, '../.git-data.json');
  if (fs.existsSync(gitDataPath)) {
    let gitData;
    try {
      gitData = JSON.parse(fs.readFileSync(gitDataPath, { encoding: 'utf8' }));
    } catch (_e) {}
    if (gitData && 'commit' in gitData) {
      return gitData.commit;
    }
  }

  return executeCommand(dirName, getCommandString(splitCharacter))
    .then(res => (lastCommit = res.split(splitCharacter)[1]))
    .catch(() => null);
}

export default getLastCommit;
