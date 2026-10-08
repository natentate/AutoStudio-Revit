// electron-builder afterPack hook.
//
// Without an Apple Developer ID certificate the app would ship with a broken
// signature (packaging edits Electron's Info.plist), which Apple Silicon Macs
// refuse to launch. Ad-hoc sign the bundle so it runs; when a real certificate
// is configured (CSC_LINK), electron-builder signs it properly afterwards.

const { execFileSync } = require('node:child_process');
const path = require('node:path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin' || process.env.CSC_LINK) return;
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  console.log(`  • ad-hoc signing ${appPath}`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
};
