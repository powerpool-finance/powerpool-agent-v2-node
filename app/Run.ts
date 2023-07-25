import {App} from "./App";

(async function () {
  console.log(`PowerPool Agent Node version: ${process.env.npm_package_version}`);
  const app = new App();
  await app.start();
})().catch(error => {
  console.error(error);
  console.log('Run.ts: Unexpected error. Stopping the app with a code (1).');
  process.exit(1);
});

process.on('unhandledRejection', function (error: Error, _promise) {
  const msg = `Unhandled Rejection, reason: ${error}`;
  console.log(error.stack);

  if (unhandledExceptionsStrictMode) {
    console.log('Stopping the app with a code (1) since the "unhandledExceptionsStrictMode" is ON.');
    process.exit(1);
  }

  console.log(msg);
});
