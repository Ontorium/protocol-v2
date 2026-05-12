import { TestEnv, makeSuite } from './helpers/make-suite';
import { APPROVAL_AMOUNT_LENDING_POOL, PERCENTAGE_FACTOR, RAY } from '../../helpers/constants';

import { rateStrategyCustom } from '../../markets/custom/rateStrategies';

import { strategyOXAU } from '../../markets/custom/reservesConfigs';
import {
  AToken,
  DefaultReserveInterestRateStrategy,
  DefaultReserveInterestRateStrategyFactory,
  MintableERC20,
} from '../../types';
import BigNumber from 'bignumber.js';
import '../test-aave/helpers/utils/math';

const { expect } = require('chai');

makeSuite('Interest rate strategy tests', (testEnv: TestEnv) => {
  let strategyInstance: DefaultReserveInterestRateStrategy;
  let oxau: MintableERC20;
  let aOXAU: AToken;

  before(async () => {
    oxau = testEnv.oxau;
    aOXAU = testEnv.aOXAU;

    // Call LendingPool.getReserveData() directly to get interestRateStrategyAddress
    // (AaveProtocolDataProvider.getReserveData() does not return interestRateStrategyAddress)
    const { pool } = testEnv;
    const reserveData = await pool.getReserveData(oxau.address);
    const strategyAddress = reserveData.interestRateStrategyAddress;

    console.log('=== Loaded Contract Addresses ===');
    console.log('  LendingPool:', pool.address);
    console.log('  OXAU Token:', oxau.address);
    console.log('  aOXAU Token:', aOXAU.address);
    console.log('  InterestRateStrategy:', strategyAddress);
    console.log('=================================');

    strategyInstance = await DefaultReserveInterestRateStrategyFactory.connect(
      strategyAddress,
      testEnv.deployer.signer
    );
  });

  it('Checks rates at 0% utilization rate, empty reserve', async () => {
    const {
      0: currentLiquidityRate,
      1: currentStableBorrowRate,
      2: currentVariableBorrowRate,
    } = await strategyInstance['calculateInterestRates(address,address,uint256,uint256,uint256,uint256,uint256,uint256)'](
      oxau.address,
      aOXAU.address,
      0,
      0,
      0,
      0,
      0,
      strategyOXAU.reserveFactor
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
      oxau.address,
      aOXAU.address,
      '200000000000000000',
      '0',
      '0',
      '800000000000000000',
      '0',
      strategyOXAU.reserveFactor
    );

    const expectedVariableRate = new BigNumber(rateStrategyCustom.baseVariableBorrowRate).plus(
      rateStrategyCustom.variableRateSlope1
    );

    expect(currentLiquidityRate.toString()).to.be.equal(
      expectedVariableRate
        .times(0.8)
        .percentMul(new BigNumber(PERCENTAGE_FACTOR).minus(strategyOXAU.reserveFactor))
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
      oxau.address,
      aOXAU.address,
      '0',
      '0',
      '0',
      '800000000000000000',
      '0',
      strategyOXAU.reserveFactor
    );

    const expectedVariableRate = new BigNumber(rateStrategyCustom.baseVariableBorrowRate)
      .plus(rateStrategyCustom.variableRateSlope1)
      .plus(rateStrategyCustom.variableRateSlope2);

    expect(currentLiquidityRate.toString()).to.be.equal(
      expectedVariableRate
        .percentMul(new BigNumber(PERCENTAGE_FACTOR).minus(strategyOXAU.reserveFactor))
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
      oxau.address,
      aOXAU.address,
      '0',
      '0',
      '400000000000000000',
      '400000000000000000',
      '100000000000000000000000000',
      strategyOXAU.reserveFactor
    );

    const expectedVariableRate = new BigNumber(rateStrategyCustom.baseVariableBorrowRate)
      .plus(rateStrategyCustom.variableRateSlope1)
      .plus(rateStrategyCustom.variableRateSlope2);

    const expectedLiquidityRate = new BigNumber(
      currentVariableBorrowRate.add('100000000000000000000000000').div(2).toString()
    )
      .percentMul(new BigNumber(PERCENTAGE_FACTOR).minus(strategyOXAU.reserveFactor))
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
