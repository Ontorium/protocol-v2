import { TestEnv, makeSuite } from './helpers/make-suite';
import { deployDefaultReserveInterestRateStrategy } from '../../helpers/contracts-deployments';

import { APPROVAL_AMOUNT_LENDING_POOL, PERCENTAGE_FACTOR, RAY } from '../../helpers/constants';

import { rateStrategyCustom } from '../../markets/custom/rateStrategies';

import { strategyAGT } from '../../markets/custom/reservesConfigs';
import { AToken, DefaultReserveInterestRateStrategy, MintableERC20 } from '../../types';
import BigNumber from 'bignumber.js';
import '../test-aave/helpers/utils/math';

const { expect } = require('chai');

makeSuite('Interest rate strategy tests', (testEnv: TestEnv) => {
  let strategyInstance: DefaultReserveInterestRateStrategy;
  let agt: MintableERC20;
  let aAGT: AToken;

  before(async () => {
    agt = testEnv.agt;
    aAGT = testEnv.aAGT;

    const { addressesProvider } = testEnv;

    strategyInstance = await deployDefaultReserveInterestRateStrategy(
      [
        addressesProvider.address,
        rateStrategyCustom.optimalUtilizationRate,
        rateStrategyCustom.baseVariableBorrowRate,
        rateStrategyCustom.variableRateSlope1,
        rateStrategyCustom.variableRateSlope2,
        rateStrategyCustom.stableRateSlope1,
        rateStrategyCustom.stableRateSlope2,
      ],
      false
    );
  });

  it('Checks rates at 0% utilization rate, empty reserve', async () => {
    const {
      0: currentLiquidityRate,
      1: currentStableBorrowRate,
      2: currentVariableBorrowRate,
    } = await strategyInstance['calculateInterestRates(address,address,uint256,uint256,uint256,uint256,uint256,uint256)'](
      agt.address,
      aAGT.address,
      0,
      0,
      0,
      0,
      0,
      strategyAGT.reserveFactor
    );

    expect(currentLiquidityRate.toString()).to.be.equal('0', 'Invalid liquidity rate');
    expect(currentStableBorrowRate.toString()).to.be.equal(
      new BigNumber(0.03).times(RAY).toFixed(0),
      'Invalid stable rate'
    );
    expect(currentVariableBorrowRate.toString()).to.be.equal(
      rateStrategyCustom.baseVariableBorrowRate,
      'Invalid variable rate'
    );
  });

  it('Checks rates at 80% utilization rate', async () => {
    const {
      0: currentLiquidityRate,
      1: currentStableBorrowRate,
      2: currentVariableBorrowRate,
    } = await strategyInstance['calculateInterestRates(address,address,uint256,uint256,uint256,uint256,uint256,uint256)'](
      agt.address,
      aAGT.address,
      '200000000000000000',
      '0',
      '0',
      '800000000000000000',
      '0',
      strategyAGT.reserveFactor
    );

    const expectedVariableRate = new BigNumber(rateStrategyCustom.baseVariableBorrowRate).plus(
      rateStrategyCustom.variableRateSlope1
    );

    expect(currentLiquidityRate.toString()).to.be.equal(
      expectedVariableRate
        .times(0.8)
        .percentMul(new BigNumber(PERCENTAGE_FACTOR).minus(strategyAGT.reserveFactor))
        .toFixed(0),
      'Invalid liquidity rate'
    );

    expect(currentVariableBorrowRate.toString()).to.be.equal(
      expectedVariableRate.toFixed(0),
      'Invalid variable rate'
    );

    expect(currentStableBorrowRate.toString()).to.be.equal(
      new BigNumber(0.03).times(RAY).plus(rateStrategyCustom.stableRateSlope1).toFixed(0),
      'Invalid stable rate'
    );
  });

  it('Checks rates at 100% utilization rate', async () => {
    const {
      0: currentLiquidityRate,
      1: currentStableBorrowRate,
      2: currentVariableBorrowRate,
    } = await strategyInstance['calculateInterestRates(address,address,uint256,uint256,uint256,uint256,uint256,uint256)'](
      agt.address,
      aAGT.address,
      '0',
      '0',
      '0',
      '800000000000000000',
      '0',
      strategyAGT.reserveFactor
    );

    const expectedVariableRate = new BigNumber(rateStrategyCustom.baseVariableBorrowRate)
      .plus(rateStrategyCustom.variableRateSlope1)
      .plus(rateStrategyCustom.variableRateSlope2);

    expect(currentLiquidityRate.toString()).to.be.equal(
      expectedVariableRate
        .percentMul(new BigNumber(PERCENTAGE_FACTOR).minus(strategyAGT.reserveFactor))
        .toFixed(0),
      'Invalid liquidity rate'
    );

    expect(currentVariableBorrowRate.toString()).to.be.equal(
      expectedVariableRate.toFixed(0),
      'Invalid variable rate'
    );

    expect(currentStableBorrowRate.toString()).to.be.equal(
      new BigNumber(0.03)
        .times(RAY)
        .plus(rateStrategyCustom.stableRateSlope1)
        .plus(rateStrategyCustom.stableRateSlope2)
        .toFixed(0),
      'Invalid stable rate'
    );
  });

  it('Checks rates at 100% utilization rate, 50% stable debt and 50% variable debt, with a 10% avg stable rate', async () => {
    const {
      0: currentLiquidityRate,
      1: currentStableBorrowRate,
      2: currentVariableBorrowRate,
    } = await strategyInstance['calculateInterestRates(address,address,uint256,uint256,uint256,uint256,uint256,uint256)'](
      agt.address,
      aAGT.address,
      '0',
      '0',
      '400000000000000000',
      '400000000000000000',
      '100000000000000000000000000',
      strategyAGT.reserveFactor
    );

    const expectedVariableRate = new BigNumber(rateStrategyCustom.baseVariableBorrowRate)
      .plus(rateStrategyCustom.variableRateSlope1)
      .plus(rateStrategyCustom.variableRateSlope2);

    const expectedLiquidityRate = new BigNumber(
      currentVariableBorrowRate.add('100000000000000000000000000').div(2).toString()
    )
      .percentMul(new BigNumber(PERCENTAGE_FACTOR).minus(strategyAGT.reserveFactor))
      .toFixed(0);

    expect(currentLiquidityRate.toString()).to.be.equal(
      expectedLiquidityRate,
      'Invalid liquidity rate'
    );

    expect(currentVariableBorrowRate.toString()).to.be.equal(
      expectedVariableRate.toFixed(0),
      'Invalid variable rate'
    );

    expect(currentStableBorrowRate.toString()).to.be.equal(
      new BigNumber(0.03)
        .times(RAY)
        .plus(rateStrategyCustom.stableRateSlope1)
        .plus(rateStrategyCustom.stableRateSlope2)
        .toFixed(0),
      'Invalid stable rate'
    );
  });
});
