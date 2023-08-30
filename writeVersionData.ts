import {getVersionAndGitData, versionDataFileName} from './app/services/GitCommit.js';

import {fileURLToPath} from "url";
import {dirname} from "path";
import {writeFileSync} from "fs";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

(async () => {
  const versionAndGitData = await getVersionAndGitData(__dirname);
  const subDir = process.env.DIR ? `${process.env.DIR}/` : '';
  writeFileSync(subDir + versionDataFileName, JSON.stringify(versionAndGitData));
  console.log(versionAndGitData, 'successfully set to', subDir + versionDataFileName, 'file');
})();
