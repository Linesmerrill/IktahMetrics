// electron-builder afterPack hook.
//
// We don't have an Apple Developer ID, so the .app can't be properly signed
// or notarized. But macOS still uses the code signature as part of TCC's
// "is this the same app as last time?" check — so an *ad-hoc* signature
// (computed from the app's contents) gives the bundle a stable identity
// across launches. Without this, the Screen Recording permission grant
// often gets invalidated between launches and the user is re-prompted in
// a loop. With ad-hoc signing, TCC remembers the grant for the lifetime
// of a single installed release.
//
// Each new release has different contents → different ad-hoc signature →
// the user has to re-grant once after an update. That's the best we can
// do without paying for a Developer ID.

const { execSync } = require('node:child_process');
const path = require('node:path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${appName}.app`);

  console.log(`[after-pack] ad-hoc signing ${appPath}`);
  execSync(`codesign --force --deep --sign - "${appPath}"`, { stdio: 'inherit' });
  execSync(`codesign --verify --verbose "${appPath}"`, { stdio: 'inherit' });
};
