import { oneRay, ZERO_ADDRESS } from '../../helpers/constants';
import { ICustomConfiguration, eEthereumNetwork, eArbitrumNetwork } from '../../helpers/types';

import { CommonsConfig } from './commons';
import { strategyOXAU, strategyUSDC, strategyUSDT } from './reservesConfigs';

// ----------------
// POOL--SPECIFIC PARAMS
// ----------------

export const CustomConfig: ICustomConfiguration = {
  ...CommonsConfig,
  MarketId: 'Aqua Arbitrum Market',
  ProviderId: 100, // Custom provider ID
  ReservesConfig: {
    OXAU: strategyOXAU,
    USDC: strategyUSDC,
    USDT: strategyUSDT,
  },
  ReserveAssets: {
    [eEthereumNetwork.buidlerevm]: {},
    [eEthereumNetwork.hardhat]: {},
    [eEthereumNetwork.coverage]: {},
    [eEthereumNetwork.kovan]: {},
    [eEthereumNetwork.ropsten]: {},
    [eEthereumNetwork.main]: {},
    [eEthereumNetwork.tenderly]: {},
    [eEthereumNetwork.goerli]: {},
    [eEthereumNetwork.localhost]: {},
    // Arbitrum Sepolia testnet token addresses
    [eArbitrumNetwork.arbitrumSepolia]: {
      OXAU: '0x0f7b1a647f3bcafb9d2090f6405c5ab43bca637a',
      USDC: '0x9848bb9287ba3f87c8098dbf7533e604030fe912',
      USDT: '0xcf7b084757873062fc7a86320f400380f9358cda',
    },
    [eArbitrumNetwork.arbitrum]: {
      OXAU: '0x1e5cdeac41bcccdaa12f304cb3c89d4e18bda665',
      USDC: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
      USDT: '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9',
    },
  },
};

export default CustomConfig;
