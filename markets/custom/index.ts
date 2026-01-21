import { oneRay, ZERO_ADDRESS } from '../../helpers/constants';
import { ICustomConfiguration, eEthereumNetwork, eArbitrumNetwork } from '../../helpers/types';

import { CommonsConfig } from './commons';
import { strategyAGT, strategyUSDC, strategyUSDT } from './reservesConfigs';

// ----------------
// POOL--SPECIFIC PARAMS
// ----------------

export const CustomConfig: ICustomConfiguration = {
  ...CommonsConfig,
  MarketId: 'Custom AGT market',
  ProviderId: 100, // Custom provider ID
  ReservesConfig: {
    AGT: strategyAGT,
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
      AGT: '0x408ae96165741d12f811efeba864f1ba8742cd8c',
      USDC: '0xC3437DA5e936D3449D6F0700A71847305e9357Be',
      USDT: '0x6777ab1c1EBFC40d3442202158bEA959E04AC744',
    },
    [eArbitrumNetwork.arbitrum]: {},
  },
};

export default CustomConfig;
