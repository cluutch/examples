import { Account, Cluster, clusterApiUrl, Connection } from "@solana/web3.js";
import {
  OracleJob,
  SWITCHBOARD_DEVNET_PID,
  SWITCHBOARD_MAINNET_PID,
  addFeedJob,
  addFeedParseOptimizedAccount,
  createDataFeed,
  setDataFeedConfigs,
  createFulfillmentManagerAuth
} from "@switchboard-xyz/switchboard-api";
import * as fs from "fs";
import resolve from "resolve-dir";
import yargs from "yargs/yargs";

let argv = yargs(process.argv).options({
  payerFile: {
    type: 'string',
    describe: "Keypair file to pay for transactions.",
    demand: true,
  },
  fulfillmentFile: {
    type: 'string',
    describe: "Keypair file of the fulfillment manager.",
    demand: true,
  },
  apiEndpoint: {
    type: 'string',
    describe: "API endpoint to query from",
    demand: true,
    default: "https://www.binance.us/api/v3/ticker/price?symbol=BTCUSD"
  },
  apiJsonPath: {
    type: 'string',
    describe: "JSON path used to parse desired value from apiEndpoint",
    demand: true,
    default: "$.price"
  },
  cluster: {
    type: "string",
    describe: "devnet, testnet, or mainnet-beta",
    demand: false,
    default: "devnet",
  },
}).parseSync();

function toCluster(cluster: string): Cluster {
  switch (cluster) {
    case "devnet":
    case "testnet":
    case "mainnet-beta": {
      return cluster;
    }
  }
  throw new Error("Invalid cluster provided.");
}

async function main() {
  let cluster = argv.cluster;
  let url = clusterApiUrl(toCluster(cluster), true);
  // let PID = SWITCHBOARD_DEVNET_PID;
  let PID = SWITCHBOARD_MAINNET_PID;
  let connection = new Connection(url, 'processed');
  let payerKeypair = JSON.parse(fs.readFileSync(resolve(argv.payerFile), 'utf-8'));
  let payerAccount = new Account(payerKeypair);
  let fulfillmentManagerKeypair = JSON.parse(fs.readFileSync(resolve(argv.fulfillmentFile), 'utf-8'));
  let fulfillmentManagerAccount = new Account(fulfillmentManagerKeypair);
  const apiEndpoint = resolve(argv.apiEndpoint);
  const apiJsonPath = resolve(argv.apiJsonPath);
  
  console.log("# Creating aggregator...");
  let dataFeedAccount = await createDataFeed(connection, payerAccount, PID);
  console.log(`export FEED_PUBKEY=${dataFeedAccount.publicKey}`);
  console.log("# Creating a parsed optimized mirror of the aggregator (optional)...");
  let poAccount = await addFeedParseOptimizedAccount(connection, payerAccount, dataFeedAccount, 1000);
  console.log(`export OPTIMIZED_RESULT_PUBKEY=${poAccount.publicKey}`);
  console.log(`# Adding job to aggregator for endpoint ${apiEndpoint} and JSON path ${apiJsonPath}...`);
  let jobAccount = await addFeedJob(connection, payerAccount, dataFeedAccount, [
    OracleJob.Task.create({
      httpTask: OracleJob.HttpTask.create({
        url: apiEndpoint
      }),
    }),
    OracleJob.Task.create({
      jsonParseTask: OracleJob.JsonParseTask.create({ path: apiJsonPath }),
    }),
  ]);
  console.log(`export JOB_PUBKEY=${jobAccount.publicKey}`);

  console.log("# Configuring aggregator...");
  await setDataFeedConfigs(connection, payerAccount, dataFeedAccount, {
    "minConfirmations": 1,
    "minUpdateDelaySeconds": 10,
    "fulfillmentManagerPubkey": fulfillmentManagerAccount.publicKey.toBuffer(),
    "lock": false
  });
  console.log(`# Creating authorization account for the data feed. This will be ` +
  `used in part 2b.`);
  let updateAuthAccount = await createFulfillmentManagerAuth(
    connection,
    payerAccount,
    fulfillmentManagerAccount,
    dataFeedAccount.publicKey, {
    "authorizeHeartbeat": false,
    "authorizeUsage": true
  });
  console.log(`export UPDATE_AUTH_KEY=${updateAuthAccount.publicKey}`);
}

main().then(
  () => process.exit(),
  err => {
    console.error("Failed to complete action.");
    console.error(err);
    process.exit(-1);
  },
);
