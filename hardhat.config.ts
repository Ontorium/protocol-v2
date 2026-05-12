import path from 'path';
import fs from 'fs';
import { HardhatUserConfig } from 'hardhat/types';
import {
  eArbitrumNetwork,
  eAvalancheNetwork,
  eEthereumNetwork,
  eNetwork,
  ePolygonNetwork,
  eXDaiNetwork,
} from './helpers/types';
import { BUIDLEREVM_CHAINID, COVERAGE_CHAINID } from './helpers/buidler-constants';
import {
  NETWORKS_RPC_URL,
  NETWORKS_DEFAULT_GAS,
  BLOCK_TO_FORK,
  buildForkConfig,
} from './helper-hardhat-config';

require('dotenv').config();

import '@nomiclabs/hardhat-ethers';
import '@nomiclabs/hardhat-waffle';
import '@nomicfoundation/hardhat-verify';

import 'hardhat-gas-reporter';
import 'hardhat-typechain';
import '@tenderly/hardhat-tenderly';
import 'solidity-coverage';
import { fork } from 'child_process';

const SKIP_LOAD = process.env.SKIP_LOAD === 'true';
const DEFAULT_BLOCK_GAS_LIMIT = 8000000;
const DEFAULT_GAS_MUL = 5;
const HARDFORK = 'istanbul';
const ETHERSCAN_KEY = process.env.ETHERSCAN_KEY || '';
const MNEMONIC_PATH = "m/44'/60'/0'/0";
const DEFAULT_MNEMONIC = 'test test test test test test test test test test test junk';
const MNEMONIC = (process.env.MNEMONIC?.trim() || DEFAULT_MNEMONIC);
const UNLIMITED_BYTECODE_SIZE = process.env.UNLIMITED_BYTECODE_SIZE === 'true';
const GAS_PRICE_GWEI = process.env.GAS_PRICE_GWEI
  ? Math.floor(Number(process.env.GAS_PRICE_GWEI) * 1e9)
  : undefined;

// Prevent to load scripts before compilation and typechain
if (!SKIP_LOAD) {
  ['misc', 'migrations', 'dev', 'full', 'verifications', 'deployments', 'helpers'].forEach(
    (folder) => {
      const tasksPath = path.join(__dirname, 'tasks', folder);
      fs.readdirSync(tasksPath)
        .filter((pth) => pth.includes('.ts'))
        .forEach((task) => {
          require(`${tasksPath}/${task}`);
        });
    }
  );
}

require(`${path.join(__dirname, 'tasks/misc')}/set-bre.ts`);

const IS_DEPLOYED = !!process.env.USE_DEPLOYED;

const LOCALHOST_ACCOUNTS = {
  mnemonic: MNEMONIC,
  path: MNEMONIC_PATH,
  initialIndex: 0,
  count: 20,
};

const getCommonNetworkConfig = (networkName: eNetwork, networkId: number) => {
  const forkOverrideUrl =
    process.env.FORK_TARGET === networkName ? process.env.FORK_RPC_URL : undefined;
  return {
    url: forkOverrideUrl || NETWORKS_RPC_URL[networkName],
    hardfork: HARDFORK,
    blockGasLimit: DEFAULT_BLOCK_GAS_LIMIT,
    gasMultiplier: DEFAULT_GAS_MUL,
    gasPrice: GAS_PRICE_GWEI || (forkOverrideUrl ? 'auto' : NETWORKS_DEFAULT_GAS[networkName]),
    chainId: networkId,
    accounts: {
      mnemonic: MNEMONIC,
      path: MNEMONIC_PATH,
      initialIndex: 0,
      count: 20,
    },
  };
};

let forkMode;

const buidlerConfig: HardhatUserConfig = {
  solidity: {
    version: '0.6.12',
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: 'istanbul',
    },
  },
  typechain: {
    outDir: 'types',
    target: 'ethers-v5',
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_ARBITRUM_KEY || '',
    customChains: [
      {
        network: 'arbitrumSepolia',
        chainId: 421614,
        urls: {
          apiURL: 'https://api-sepolia.arbiscan.io/api',
          browserURL: 'https://sepolia.arbiscan.io/',
        },
      },
    ],
  },
  sourcify: {
    enabled: true,
  },

  gasReporter: {
    enabled: process.env.REPORT_GAS === 'true',
  },
  mocha: {
    timeout: 0,
  },
  tenderly: {
    project: process.env.TENDERLY_PROJECT || '',
    username: process.env.TENDERLY_USERNAME || '',
    forkNetwork: '1', //Network id of the network we want to fork
  },
  networks: {
    coverage: {
      url: 'http://localhost:8555',
      chainId: COVERAGE_CHAINID,
    },
    kovan: getCommonNetworkConfig(eEthereumNetwork.kovan, 42),
    ropsten: getCommonNetworkConfig(eEthereumNetwork.ropsten, 3),
    main: getCommonNetworkConfig(eEthereumNetwork.main, 1),
    tenderly: getCommonNetworkConfig(eEthereumNetwork.tenderly, 3030),
    matic: getCommonNetworkConfig(ePolygonNetwork.matic, 137),
    mumbai: getCommonNetworkConfig(ePolygonNetwork.mumbai, 80001),
    xdai: getCommonNetworkConfig(eXDaiNetwork.xdai, 100),
    avalanche: getCommonNetworkConfig(eAvalancheNetwork.avalanche, 43114),
    fuji: getCommonNetworkConfig(eAvalancheNetwork.fuji, 43113),
    goerli: getCommonNetworkConfig(eEthereumNetwork.goerli, 5),
    arbitrum: getCommonNetworkConfig(eArbitrumNetwork.arbitrum, 42161),
    arbitrumSepolia: getCommonNetworkConfig(eArbitrumNetwork.arbitrumSepolia, 421614),
    hardhat: {
      hardfork: 'cancun',
      blockGasLimit: DEFAULT_BLOCK_GAS_LIMIT,
      gas: DEFAULT_BLOCK_GAS_LIMIT,
      gasPrice: 8000000000,
      allowUnlimitedContractSize: UNLIMITED_BYTECODE_SIZE,
      chainId: process.env.FORK === 'arbitrumSepolia' ? 421614 : BUIDLEREVM_CHAINID,
      throwOnTransactionFailures: true,
      throwOnCallFailures: true,
      accounts: {
        mnemonic: MNEMONIC,
        path: MNEMONIC_PATH,
        initialIndex: 0,
        count: 20,
        accountsBalance: '1000000000000000000000000',
      },
      forking: buildForkConfig(),
      chains: {
        421614: {
          hardforkHistory: {
            berlin: 0,
            london: 0,
            arrowGlacier: 0,
            grayGlacier: 0,
            merge: 0,
            shanghai: 0,
            cancun: 0,
          },
        },
      },
    },
    buidlerevm: {
      hardfork: 'berlin',
      blockGasLimit: 9500000,
      gas: 9500000,
      gasPrice: 8000000000,
      chainId: BUIDLEREVM_CHAINID,
      throwOnTransactionFailures: true,
      throwOnCallFailures: true,
      url: 'http://localhost:8545',
    },
    buidlerevm_docker: {
      hardfork: 'berlin',
      blockGasLimit: 9500000,
      gas: 9500000,
      gasPrice: 8000000000,
      chainId: BUIDLEREVM_CHAINID,
      throwOnTransactionFailures: true,
      throwOnCallFailures: true,
      url: 'http://localhost:8545',
    },
    localhost: {
      url: process.env.HARDHAT_NETWORK_URL || 'http://localhost:8545',
      chainId: IS_DEPLOYED ? 421614 : 31337,
      accounts: LOCALHOST_ACCOUNTS,
    },
    ganache: {
      url: 'http://ganache:8545',
      accounts: {
        mnemonic: 'fox sight canyon orphan hotel grow hedgehog build bless august weather swarm',
        path: "m/44'/60'/0'/0",
        initialIndex: 0,
        count: 20,
      },
    },
  },
};

export default buidlerConfig;
