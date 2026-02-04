/**
 * Mempool.space REST API endpoint catalog for the playground.
 * See https://mempool.space/docs/api/rest
 */

export interface EndpointParam {
  name: string;
  placeholder: string;
  /** When set, used as placeholder when network is testnet. */
  placeholderTestnet?: string;
  optional?: boolean;
}

export interface PlaygroundEndpoint {
  id: string;
  label: string;
  method: 'GET' | 'POST';
  pathTemplate: string;
  description: string;
  pathParams?: EndpointParam[];
  queryParams?: EndpointParam[];
  /** For POST: hint for body (e.g. "Raw transaction hex"); bodyIsRawHex means send as text/plain. */
  postBodyHint?: string;
  bodyIsRawHex?: boolean;
}

export interface PlaygroundSection {
  id: string;
  title: string;
  endpoints: PlaygroundEndpoint[];
}

export const MEMPOOL_PLAYGROUND_SECTIONS: PlaygroundSection[] = [
  {
    id: 'general',
    title: 'General',
    endpoints: [
      {
        id: 'price',
        label: 'GET Price',
        method: 'GET',
        pathTemplate: '/api/v1/prices',
        description:
          'Returns bitcoin latest price denominated in main currencies.',
      },
    ],
  },
  {
    id: 'addresses',
    title: 'Addresses',
    endpoints: [
      {
        id: 'address',
        label: 'GET Address',
        method: 'GET',
        pathTemplate: '/api/address/:address',
        description:
          'Returns details about an address (chain_stats, mempool_stats).',
        pathParams: [
          { name: 'address', placeholder: '1wiz18xYmhRX6xStj2b9t1rwWX4GKUgpv', placeholderTestnet: 'tb1q7kn55vf3mm40v2grq84nd2sax2u8r6j0q5n4qm' },
        ],
      },
      {
        id: 'address-txs',
        label: 'GET Address Transactions',
        method: 'GET',
        pathTemplate: '/api/address/:address/txs',
        description:
          'Transaction history for the address, newest first. Up to 50 mempool + 25 confirmed. Use after_txid for more.',
        pathParams: [
          { name: 'address', placeholder: '1wiz18xYmhRX6xStj2b9t1rwWX4GKUgpv', placeholderTestnet: 'tb1q7kn55vf3mm40v2grq84nd2sax2u8r6j0q5n4qm' },
        ],
        queryParams: [
          { name: 'after_txid', placeholder: 'txid', placeholderTestnet: 'testnet txid', optional: true },
        ],
      },
      {
        id: 'address-txs-chain',
        label: 'GET Address Transactions Chain',
        method: 'GET',
        pathTemplate: '/api/address/:address/txs/chain',
        description: 'Confirmed transaction history, 25 per page. Use after_txid for more.',
        pathParams: [
          { name: 'address', placeholder: '1wiz18xYmhRX6xStj2b9t1rwWX4GKUgpv', placeholderTestnet: 'tb1q7kn55vf3mm40v2grq84nd2sax2u8r6j0q5n4qm' },
        ],
        queryParams: [
          { name: 'after_txid', placeholder: 'txid', placeholderTestnet: 'testnet txid', optional: true },
        ],
      },
      {
        id: 'address-txs-mempool',
        label: 'GET Address Transactions Mempool',
        method: 'GET',
        pathTemplate: '/api/address/:address/txs/mempool',
        description: 'Unconfirmed transaction history for the address, up to 50.',
        pathParams: [
          { name: 'address', placeholder: '1wiz18xYmhRX6xStj2b9t1rwWX4GKUgpv', placeholderTestnet: 'tb1q7kn55vf3mm40v2grq84nd2sax2u8r6j0q5n4qm' },
        ],
      },
      {
        id: 'address-utxo',
        label: 'GET Address UTXO',
        method: 'GET',
        pathTemplate: '/api/address/:address/utxo',
        description: 'Unspent outputs for the address (txid, vout, value, status).',
        pathParams: [
          { name: 'address', placeholder: '1KFHE7w8BhaENAswwryaoccDb6qcT6DbYY', placeholderTestnet: 'tb1q7kn55vf3mm40v2grq84nd2sax2u8r6j0q5n4qm' },
        ],
      },
      {
        id: 'address-validation',
        label: 'GET Address Validation',
        method: 'GET',
        pathTemplate: '/api/v1/validate-address/:address',
        description: 'Returns whether an address is valid (isvalid, scriptPubKey, isscript, iswitness).',
        pathParams: [
          { name: 'address', placeholder: '1KFHE7w8BhaENAswwryaoccDb6qcT6DbYY', placeholderTestnet: 'tb1q7kn55vf3mm40v2grq84nd2sax2u8r6j0q5n4qm' },
        ],
      },
    ],
  },
  {
    id: 'blocks',
    title: 'Blocks',
    endpoints: [
      {
        id: 'block',
        label: 'GET Block',
        method: 'GET',
        pathTemplate: '/api/block/:hash',
        description: 'Returns details about a block.',
        pathParams: [
          {
            name: 'hash',
            placeholder: '000000000000000015dc777b3ff2611091336355d3f0ee9766a2cf3be8e4b1ce',
            placeholderTestnet: '00000000000000a024e01738d1f2d279c2a2d4f3c4b5a6c7d8e9f0a1b2c3d4e5f6a',
          },
        ],
      },
      {
        id: 'block-v1',
        label: 'GET Block (v1)',
        method: 'GET',
        pathTemplate: '/api/v1/block/:hash',
        description: "Returns block details using Mempool's Node.js backend (includes extras).",
        pathParams: [
          {
            name: 'hash',
            placeholder: '000000000000000015dc777b3ff2611091336355d3f0ee9766a2cf3be8e4b1ce',
            placeholderTestnet: '00000000000000a024e01738d1f2d279c2a2d4f3c4b5a6c7d8e9f0a1b2c3d4e5f6a',
          },
        ],
      },
      {
        id: 'block-height',
        label: 'GET Block Height',
        method: 'GET',
        pathTemplate: '/api/block-height/:height',
        description: 'Returns the hash of the block at the given height.',
        pathParams: [{ name: 'height', placeholder: '615615', placeholderTestnet: '2500000' }],
      },
      {
        id: 'block-tip-height',
        label: 'GET Block Tip Height',
        method: 'GET',
        pathTemplate: '/api/blocks/tip/height',
        description: 'Returns the height of the last block.',
      },
      {
        id: 'block-tip-hash',
        label: 'GET Block Tip Hash',
        method: 'GET',
        pathTemplate: '/api/blocks/tip/hash',
        description: 'Returns the hash of the last block.',
      },
      {
        id: 'block-txids',
        label: 'GET Block Transaction IDs',
        method: 'GET',
        pathTemplate: '/api/block/:hash/txids',
        description: 'Returns a list of all txids in the block.',
        pathParams: [
          {
            name: 'hash',
            placeholder: '000000000000000015dc777b3ff2611091336355d3f0ee9766a2cf3be8e4b1ce',
            placeholderTestnet: '00000000000000a024e01738d1f2d279c2a2d4f3c4b5a6c7d8e9f0a1b2c3d4e5f6a',
          },
        ],
      },
      {
        id: 'block-txs',
        label: 'GET Block Transactions',
        method: 'GET',
        pathTemplate: '/api/block/:hash/txs',
        description: 'Transactions in the block (up to 25 from start_index).',
        pathParams: [
          {
            name: 'hash',
            placeholder: '000000000000000015dc777b3ff2611091336355d3f0ee9766a2cf3be8e4b1ce',
            placeholderTestnet: '00000000000000a024e01738d1f2d279c2a2d4f3c4b5a6c7d8e9f0a1b2c3d4e5f6a',
          },
        ],
        queryParams: [{ name: 'start_index', placeholder: '0', optional: true }],
      },
    ],
  },
  {
    id: 'fees',
    title: 'Fees',
    endpoints: [
      {
        id: 'recommended-fees',
        label: 'GET Recommended Fees',
        method: 'GET',
        pathTemplate: '/api/v1/fees/recommended',
        description: 'Returns currently suggested fees for new transactions.',
      },
    ],
  },
  {
    id: 'transactions',
    title: 'Transactions',
    endpoints: [
      {
        id: 'tx',
        label: 'GET Transaction',
        method: 'GET',
        pathTemplate: '/api/tx/:txid',
        description: 'Returns details about a transaction (txid, version, vin, vout, status).',
        pathParams: [
          {
            name: 'txid',
            placeholder: '15e10745f15593a899cef391191bdd3d7c12412cc4696b7bcb669d0feadc8521',
            placeholderTestnet: 'a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456',
          },
        ],
      },
      {
        id: 'tx-hex',
        label: 'GET Transaction Hex',
        method: 'GET',
        pathTemplate: '/api/tx/:txid/hex',
        description: 'Returns the transaction serialized as hex.',
        pathParams: [
          {
            name: 'txid',
            placeholder: '15e10745f15593a899cef391191bdd3d7c12412cc4696b7bcb669d0feadc8521',
            placeholderTestnet: 'a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456',
          },
        ],
      },
      {
        id: 'tx-status',
        label: 'GET Transaction Status',
        method: 'GET',
        pathTemplate: '/api/tx/:txid/status',
        description: 'Returns confirmation status (confirmed, block_height, block_hash).',
        pathParams: [
          {
            name: 'txid',
            placeholder: '15e10745f15593a899cef391191bdd3d7c12412cc4696b7bcb669d0feadc8521',
            placeholderTestnet: 'a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456',
          },
        ],
      },
      {
        id: 'post-tx',
        label: 'POST Transaction',
        method: 'POST',
        pathTemplate: '/api/tx',
        description: 'Broadcast a raw transaction to the network. Body: transaction hex. Returns txid on success.',
        postBodyHint: 'Raw transaction hex',
        bodyIsRawHex: true,
      },
    ],
  },
];
