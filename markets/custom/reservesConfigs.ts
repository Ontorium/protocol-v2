import { eContractid, IReserveParams } from '../../helpers/types';

import { rateStrategyCustom } from './rateStrategies';

// OXAU (Gold-pegged RWA token)
export const strategyOXAU: IReserveParams = {
  strategy: rateStrategyCustom,
  baseLTVAsCollateral: '6500', // 65% LTV
  liquidationThreshold: '7500', // 75%
  liquidationBonus: '10500', // 5%
  borrowingEnabled: true,
  stableBorrowRateEnabled: false,
  reserveDecimals: '18',
  aTokenImpl: eContractid.AToken,
  reserveFactor: '1000', // 10%
};

// USDC (Stablecoin)
export const strategyUSDC: IReserveParams = {
  strategy: rateStrategyCustom,
  baseLTVAsCollateral: '7500', // 75% LTV
  liquidationThreshold: '8800', // 88%
  liquidationBonus: '10450', // 4.5%
  borrowingEnabled: true,
  stableBorrowRateEnabled: false,
  reserveDecimals: '6',
  aTokenImpl: eContractid.AToken,
  reserveFactor: '1000', // 10%
};

// USDT (Stablecoin)
export const strategyUSDT: IReserveParams = {
  strategy: rateStrategyCustom,
  baseLTVAsCollateral: '7500', // 75% LTV
  liquidationThreshold: '8800', // 88%
  liquidationBonus: '10450', // 4.5%
  borrowingEnabled: true,
  stableBorrowRateEnabled: false,
  reserveDecimals: '6',
  aTokenImpl: eContractid.AToken,
  reserveFactor: '1000', // 10%
};
