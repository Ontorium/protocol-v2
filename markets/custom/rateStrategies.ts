import { IInterestRateStrategyParams } from '../../helpers/types';

// Custom market unified rate strategy (AGT, USDC, USDT)
export const rateStrategyCustom: IInterestRateStrategyParams = {
  name: 'rateStrategyCustom',
  optimalUtilizationRate: '800000000000000000000000000', // 80%
  baseVariableBorrowRate: '0', // 0%
  variableRateSlope1: '40000000000000000000000000', // 4%
  variableRateSlope2: '750000000000000000000000000', // 75%
  stableRateSlope1: '0', // 0%
  stableRateSlope2: '0', // 0%
};
