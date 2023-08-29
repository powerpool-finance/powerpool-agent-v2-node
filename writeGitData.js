import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE_NAME = './dist/.git-data.json';

function getGitInfo() {
  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD').toString().trim();
    const commit = execSync('git rev-parse --short HEAD').toString().trim();

    return { branch, commit };
  } catch (error) {
    console.error('Error fetching git info:', error);
    return { branch: '', commit: '' };
  }
}

let gitInfo = getGitInfo();
fs.writeFileSync(path.resolve(__dirname, FILE_NAME), JSON.stringify(gitInfo, null, 2));
