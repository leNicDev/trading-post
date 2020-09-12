//

const fetch = require("node-fetch");

async function request(graphql) {
  var requestOptions = {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: graphql,
  };
  let res = await fetch("https://arweave.dev/graphql", requestOptions);
  return await res.clone().json();
}

async function query({ query, variables }) {
  var graphql = JSON.stringify({
    query,
    variables,
  });
  return await request(graphql);
}

//

const maxInt = 2147483647;

//

async function fixCorrupt(addr) {
  const _txs = (
    await query({
      query: `
      query ($tradingPost: String!) {
        transactions (
          owners: [$tradingPost]
          first: ${maxInt}
        ) {
          edges {
            node {
              id
              quantity {
                ar
              }
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
        tradingPost: addr,
      },
    })
  ).data.transactions.edges;

  let txs = [];
  for (const tx of _txs) {
    if (parseFloat(tx.node.quantity.ar) > 0) {
      // console.log("AR transfer.");
    } else {
      if (tx.node.tags.find((tag) => tag.name === "Type")) {
        // console.log("Confirmation tx.");
      } else {
        const tag = tx.node.tags.find((tag) => tag.name === "Input").value;
        const parsedTag = JSON.parse(tag);
        if (typeof parsedTag === "string") {
          txs.push({
            id: tx.node.id,
            token: tx.node.tags.find((tag) => tag.name === "Contract").value,
            // If you parse the tag again, it will be correct
            input: JSON.parse(parsedTag),
          });
        } else {
          // console.log("Not corrupt.");
        }
      }
    }
  }

  // TODO(@johnletey): Send new txs.
  console.log(txs);
}

fixCorrupt("WNeEQzI24ZKWslZkQT573JZ8bhatwDVx6XVDrrGbUyk");
