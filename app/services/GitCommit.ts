import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';

const versionDataFileName = '.version-data.json';

let version, commit, branch;
async function getVersion(dirName, full = false) {
  if (version && commit) {
    return `${version}${full ? '-' + branch : ''}-${commit}`;
  }
  ({ version, commit, branch } = getVersionDataFromJson(dirName));
  if (version && commit) {
    return `${version}${full ? '-' + branch : ''}-${commit}`;
  }
  ({ version, commit, branch } = getVersionAndGitData(dirName + '/../'));
  return `${version}${full ? '-' + branch : ''}-${commit}`;
}

function getVersionDataFromJson(dirName) {
  const gitDataPath = path.resolve(dirName, `./${versionDataFileName}`);
  if (fs.existsSync(gitDataPath)) {
    let gitData;
    try {
      gitData = JSON.parse(fs.readFileSync(gitDataPath, { encoding: 'utf8' }));
    } catch (_e) {}
    if (gitData && 'commit' in gitData) {
      return gitData;
    }
  }
  return {};
}

function getVersionAndGitData(dirName): any {
  const gitData = getGitData();
  gitData.version = JSON.parse(fs.readFileSync(path.resolve(dirName, './package.json')).toString()).version;
  return gitData;
}

function getGitData(): any {
  try {
    return {
      branch: execSync('git rev-parse --abbrev-ref HEAD').toString().trim(),
      commit: execSync('git rev-parse --short HEAD').toString().trim(),
    };
  } catch (e) {
    return {};
  }
}

export { getVersion, getVersionAndGitData, versionDataFileName };
