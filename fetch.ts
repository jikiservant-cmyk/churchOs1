import { execSync } from 'child_process';

console.log('Downloading repo...');
execSync('curl -sL https://github.com/jikiservant-cmyk/churchOs/archive/refs/heads/main.zip -o main.zip', { stdio: 'inherit' });

console.log('Unzipping...');
execSync('unzip -o main.zip', { stdio: 'inherit' });

console.log('Copying files...');
execSync('cp -rf churchOs-main/* .', { stdio: 'inherit' });

console.log('Cleaning up...');
execSync('rm -rf churchOs-main main.zip fetch.ts', { stdio: 'inherit' });

console.log('Done!');
