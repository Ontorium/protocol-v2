import { oneRay, ZERO_ADDRESS } from '../../helpers/constants';
import { ICustomConfiguration, eEthereumNetwork } from '../../helpers/types';

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
  },
};

export default CustomConfig;
