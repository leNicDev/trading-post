import Arweave from "arweave";
import { JWKPublicInterface } from "arweave/node/lib/wallet";
import Logger from "@utils/logger";
import { relative } from "path";
import * as fs from "fs";
import { Database } from "sqlite";
import { getTimestamp } from "@utils/database";
import { query } from "@utils/gql";
import txsQuery from "../queries/txs.gql";
import CONSTANTS from "../utils/constants.yml";

const { readFile } = fs.promises;

const relativeKeyPath = process.env.KEY_PATH
  ? relative(__dirname, process.env.KEY_PATH)
  : "./arweave.json";

const log = new Logger({
  level: Logger.Levels.debug,
  name: "arweave",
});

export async function init(keyfile?: string) {
  const client = new Arweave({
    host: "arweave.dev",
    port: 443,
    protocol: "https",
    timeout: 20000,
    logging: false,
    logger: (msg: any) => {
      if (new Error().stack?.includes("smartweave")) return;
      log.debug(msg);
    },
  });

  const jwk = await getJwk(keyfile);
  const addr = await client.wallets.jwkToAddress(jwk!);
  const balance = client.ar.winstonToAr(await client.wallets.getBalance(addr));

  log.info(
    "Created Arweave instance:\n\t\t" +
      `addr    = ${addr}\n\t\t` +
      `balance = ${parseFloat(balance).toFixed(3)} AR`
  );

  return { client, addr, jwk };
}

let cachedJwk: JWKPublicInterface | undefined;
export async function getJwk(keyfile?: string) {
  if (!cachedJwk) {
    log.info(`Loading keyfile from: ${keyfile || relativeKeyPath}`);
    const potentialJwk = JSON.parse(
      await readFile(keyfile || relativeKeyPath, { encoding: "utf8" })
    );
    cachedJwk = potentialJwk;
  }
  return cachedJwk;
}

export const latestTxs = async (
  db: Database,
  addr: string,
  latest: {
    block: number;
    txID: string;
  }
): Promise<{
  txs: {
    id: string;
    block: number;
    sender: string;
    type: string;
    table?: string;
    order?: string;
    arAmnt?: number;
    amnt?: number;
    rate?: number;
  }[];
  latest: {
    block: number;
    txID: string;
  };
}> => {
  const timeEntries = await getTimestamp(db);
  const time = timeEntries[timeEntries.length - 1]["createdAt"]
    .toString()
    .slice(0, -3);

  let _txs = (
    await query({
      query: txsQuery,
      variables: {
        recipients: [addr],
        min: latest.block,
        num: CONSTANTS.maxInt,
      },
    })
  ).data.transactions.edges.reverse();

  let index: number = 0;
  for (let i = 0; i < _txs.length; i++) {
    if (_txs[i].node.id === latest.txID) {
      index = i + 1;
      break;
    }
  }
  _txs = _txs.slice(index, _txs.length);

  const txs: {
    id: string;
    block: number;
    sender: string;
    type: string;
    table?: string;
    order?: string;
    arAmnt?: number;
    amnt?: number;
    rate?: number;
  }[] = [];

  for (const tx of _txs) {
    if (tx.node.block.timestamp > time) {
      const type = tx.node.tags.find(
        (tag: { name: string; value: string }) => tag.name === "Type"
      ).value;

      if (type === "Buy") {
        txs.push({
          id: tx.node.id,
          block: tx.node.block.height,
          sender: tx.node.owner.address,
          type,
          table: tx.tags.find(
            (tag: { name: string; value: string }) => tag.name === "Token"
          ).value,
          arAmnt: parseFloat(tx.quantity.ar),
        });
      } else if (type === "Sell") {
        txs.push({
          id: tx.node.id,
          block: tx.node.block.height,
          sender: tx.node.owner.address,
          type,
          table: tx.tags.find(
            (tag: { name: string; value: string }) => tag.name === "Contract"
          ).value,
          amnt: JSON.parse(
            tx.tags.find(
              (tag: { name: string; value: string }) => tag.name === "Input"
            ).value
          ).qty,
          rate: tx.tags.find(
            (tag: { name: string; value: string }) => tag.name === "Rate"
          ).value,
        });
      } else if (type === "Cancel") {
        txs.push({
          id: tx.node.id,
          block: tx.node.block.height,
          sender: tx.node.owner.address,
          type,
          order: tx.tags.find(
            (tag: { name: string; value: string }) => tag.name === "Order"
          ).value,
        });
      } else if (type === "Swap") {
        txs.push({
          id: tx.node.id,
          block: tx.node.block.height,
          sender: tx.node.owner.address,
          type,
          table: tx.tags.find(
            (tag: { name: string; value: string }) => tag.name === "Chain"
          ).value,
          arAmnt: parseFloat(tx.quantity.ar),
          rate: tx.tags.find(
            (tag: { name: string; value: string }) => tag.name === "Rate"
          ).value,
        });
      }
    }
  }

  let newLatest = latest;
  if (txs.length > 0) {
    newLatest = {
      block: txs[txs.length - 1].block,
      txID: txs[txs.length - 1].id,
    };
  }

  return { txs, latest: newLatest };
};

export const getArAddr = async (
  addr: string,
  chain: string
): Promise<string | undefined> => {
  let txs = (
    await query({
      query: `
        query($addr: [String!]!, $chain: [String!]!) {
          transactions(
            tags: [
              { name: "Application", values: "ArLink" }
              { name: "Chain", values: $chain }
              { name: "Wallet", values: $addr }
            ]
            first: 1
          ) {
            edges {
              node {
                owner {
                  address
                }
              }
            }
          }
        }
      `,
      variables: {
        addr,
        chain,
      },
    })
  ).data.transactions.edges;

  if (txs.length === 1) {
    return txs[0].node.owner.address;
  }
};

export const getChainAddr = async (
  addr: string,
  chain: string
): Promise<string | undefined> => {
  let txs = (
    await query({
      query: `
        query($addr: String!, $chain: [String!]!) {
          transactions(
            owners: [$addr]
            tags: [
              { name: "Application", values: "ArLink" }
              { name: "Chain", values: $chain }
            ]
            first: 1
          ) {
            edges {
              node {
                tags {
                  name
                  value
                }
              }
            }
          }
        }
      `,
      variables: {
        addr,
        chain,
      },
    })
  ).data.transactions.edges;

  if (txs.length === 1) {
    const tag = txs[0].node.tags.find(
      (tag: { name: string; value: string }) => tag.name === "Wallet"
    );

    if (tag) {
      return tag.value;
    }
  }
};
