import BigNumber from 'bignumber.js';

import { DRE, increaseTime } from '../../helpers/misc-utils';
import { APPROVAL_AMOUNT_LENDING_POOL, oneEther } from '../../helpers/constants';
import { convertToCurrencyDecimals } from '../../helpers/contracts-helpers';
import { makeSuite } from './helpers/make-suite';
import { ProtocolErrors, RateMode } from '../../helpers/types';
import { calcExpectedVariableDebtTokenBalance } from '../test-aave/helpers/utils/calculations';
import { getReserveData, getUserData } from '../test-aave/helpers/utils/helpers';

import { parseEther } from 'ethers/lib/utils';

const chai = require('chai');

const { expect } = chai;

makeSuite('LendingPool liquidation - liquidator receiving the underlying asset', (testEnv) => {
  const { INVALID_HF } = ProtocolErrors;

  before('Before LendingPool liquidation: set config', () => {
    BigNumber.config({ DECIMAL_PLACES: 0, ROUNDING_MODE: BigNumber.ROUND_DOWN });
  });

  after('After LendingPool liquidation: reset config', () => {
    BigNumber.config({ DECIMAL_PLACES: 20, ROUNDING_MODE: BigNumber.ROUND_HALF_UP });
  });

  it("It's not possible to liquidate on a non-active collateral or a non active principal", async () => {
    const { configurator, agt, pool, users, usdc } = testEnv;
    const user = users[1];
    await configurator.deactivateReserve(agt.address);

    await expect(
      pool.liquidationCall(agt.address, usdc.address, user.address, parseEther('1000'), false)
    ).to.be.revertedWith('2');

    await configurator.activateReserve(agt.address);

    await configurator.deactivateReserve(usdc.address);

    await expect(
      pool.liquidationCall(agt.address, usdc.address, user.address, parseEther('1000'), false)
    ).to.be.revertedWith('2');

    await configurator.activateReserve(usdc.address);
  });

  it('Deposits AGT, borrows USDC', async () => {
    const { usdc, agt, users, pool, oracle } = testEnv;
    const depositor = users[0];
    const borrower = users[1];

    //mints USDC to depositor - need enough for the borrow based on AGT collateral value
    await usdc.connect(depositor.signer).mint(await convertToCurrencyDecimals(usdc.address, '10000'));

    //approve protocol to access depositor wallet
    await usdc.connect(depositor.signer).approve(pool.address, APPROVAL_AMOUNT_LENDING_POOL);

    //user 0 deposits 10000 USDC to ensure enough liquidity
    const amountUSDCtoDeposit = await convertToCurrencyDecimals(usdc.address, '10000');

    await pool
      .connect(depositor.signer)
      .deposit(usdc.address, amountUSDCtoDeposit, depositor.address, '0');

    //user 1 deposits 100 AGT
    const amountAGTtoDeposit = await convertToCurrencyDecimals(agt.address, '100');

    //mints AGT to borrower
    await agt.connect(borrower.signer).mint(await convertToCurrencyDecimals(agt.address, '100'));

    //approve protocol to access the borrower wallet
    await agt.connect(borrower.signer).approve(pool.address, APPROVAL_AMOUNT_LENDING_POOL);

    await pool
      .connect(borrower.signer)
      .deposit(agt.address, amountAGTtoDeposit, borrower.address, '0');

    //user 1 borrows USDC
    const userGlobalData = await pool.getUserAccountData(borrower.address);
    const usdcPrice = await oracle.getAssetPrice(usdc.address);

    const amountUSDCToBorrow = await convertToCurrencyDecimals(
      usdc.address,
      new BigNumber(userGlobalData.availableBorrowsETH.toString())
        .div(usdcPrice.toString())
        .multipliedBy(0.95)
        .toFixed(0)
    );

    await pool
      .connect(borrower.signer)
      .borrow(usdc.address, amountUSDCToBorrow, RateMode.Variable, '0', borrower.address);

    const userGlobalDataAfter = await pool.getUserAccountData(borrower.address);

    expect(userGlobalDataAfter.currentLiquidationThreshold.toString()).to.be.bignumber.equal(
      '7500',
      INVALID_HF
    );
  });

  it('Drop the health factor below 1', async () => {
    const { usdc, agt, users, pool, oracle } = testEnv;
    const borrower = users[1];

    const usdcPrice = await oracle.getAssetPrice(usdc.address);

    // Use a multiplier (1.25x) to drop HF below 1
    await oracle.setAssetPrice(
      usdc.address,
      new BigNumber(usdcPrice.toString()).multipliedBy(1.25).toFixed(0)
    );

    const userGlobalData = await pool.getUserAccountData(borrower.address);

    expect(userGlobalData.healthFactor.toString()).to.be.bignumber.lt(
      oneEther.toFixed(0),
      INVALID_HF
    );
  });

  it('Liquidates the borrow', async () => {
    const { usdc, agt, users, pool, oracle, helpersContract } = testEnv;
    const liquidator = users[3];
    const borrower = users[1];

    //mints usdc to the liquidator - need enough to cover half the debt
    await usdc.connect(liquidator.signer).mint(await convertToCurrencyDecimals(usdc.address, '5000'));

    //approve protocol to access the liquidator wallet
    await usdc.connect(liquidator.signer).approve(pool.address, APPROVAL_AMOUNT_LENDING_POOL);

    const userReserveDataBefore = await getUserData(
      pool,
      helpersContract,
      usdc.address,
      borrower.address
    );

    const amountToLiquidate = userReserveDataBefore.currentVariableDebt.div(2).toFixed(0);

    await increaseTime(100);

    const tx = await pool
      .connect(liquidator.signer)
      .liquidationCall(agt.address, usdc.address, borrower.address, amountToLiquidate, false);

    const userReserveDataAfter = await getUserData(
      pool,
      helpersContract,
      usdc.address,
      borrower.address
    );

    // Verify debt was reduced by approximately the liquidated amount
    expect(userReserveDataAfter.currentVariableDebt.toString()).to.be.bignumber.almostEqual(
      new BigNumber(userReserveDataBefore.currentVariableDebt.toString())
        .minus(amountToLiquidate)
        .toFixed(0),
      'Invalid user borrow balance after liquidation'
    );
  });

  it('User 3 deposits 10000 USDC, user 4 deposits 100 AGT, user 4 borrows - Loss', async () => {
    const { usdc, agt, users, pool, oracle, helpersContract } = testEnv;
    const depositor = users[3];
    const borrower = users[4];

    // Reset USDC price to original value for this test
    await oracle.setAssetPrice(usdc.address, oneEther.toFixed(0));

    //mints USDC to depositor - need enough for the borrow
    await usdc.connect(depositor.signer).mint(await convertToCurrencyDecimals(usdc.address, '10000'));

    //approve protocol to access depositor wallet
    await usdc.connect(depositor.signer).approve(pool.address, APPROVAL_AMOUNT_LENDING_POOL);

    //user 3 deposits 10000 USDC to ensure enough liquidity
    const amountUSDCtoDeposit = await convertToCurrencyDecimals(usdc.address, '10000');

    await pool
      .connect(depositor.signer)
      .deposit(usdc.address, amountUSDCtoDeposit, depositor.address, '0');

    //user 4 deposits 100 AGT
    const amountAGTtoDeposit = await convertToCurrencyDecimals(agt.address, '100');

    //mints AGT to borrower
    await agt.connect(borrower.signer).mint(amountAGTtoDeposit);

    //approve protocol to access borrower wallet
    await agt.connect(borrower.signer).approve(pool.address, APPROVAL_AMOUNT_LENDING_POOL);

    await pool
      .connect(borrower.signer)
      .deposit(agt.address, amountAGTtoDeposit, borrower.address, '0');

    //user 4 borrows
    const userGlobalData = await pool.getUserAccountData(borrower.address);
    const usdcPrice = await oracle.getAssetPrice(usdc.address);

    const amountUSDCToBorrow = await convertToCurrencyDecimals(
      usdc.address,
      new BigNumber(userGlobalData.availableBorrowsETH.toString())
        .div(usdcPrice.toString())
        .multipliedBy(0.95)
        .toFixed(0)
    );

    await pool
      .connect(borrower.signer)
      .borrow(usdc.address, amountUSDCToBorrow, RateMode.Variable, '0', borrower.address);

    const userGlobalDataAfter = await pool.getUserAccountData(borrower.address);

    expect(userGlobalDataAfter.currentLiquidationThreshold.toString()).to.be.bignumber.equal(
      '7500',
      INVALID_HF
    );
  });

  it('Drop the health factor below 1', async () => {
    const { usdc, users, pool, oracle } = testEnv;
    const borrower = users[4];

    const usdcPrice = await oracle.getAssetPrice(usdc.address);

    // Use a multiplier (1.25x) to drop HF below 1
    await oracle.setAssetPrice(
      usdc.address,
      new BigNumber(usdcPrice.toString()).multipliedBy(1.25).toFixed(0)
    );

    const userGlobalData = await pool.getUserAccountData(borrower.address);

    expect(userGlobalData.healthFactor.toString()).to.be.bignumber.lt(
      oneEther.toFixed(0),
      INVALID_HF
    );
  });

  it('Liquidates the borrow', async () => {
    const { usdc, agt, users, pool, helpersContract } = testEnv;
    const liquidator = users[5];
    const borrower = users[4];

    //mints usdc to the liquidator - need enough to cover half the debt
    await usdc.connect(liquidator.signer).mint(await convertToCurrencyDecimals(usdc.address, '5000'));

    //approve protocol to access the liquidator wallet
    await usdc.connect(liquidator.signer).approve(pool.address, APPROVAL_AMOUNT_LENDING_POOL);

    const userReserveDataBefore = await getUserData(
      pool,
      helpersContract,
      usdc.address,
      borrower.address
    );

    const amountToLiquidate = userReserveDataBefore.currentVariableDebt.div(2).toFixed(0);

    await increaseTime(100);

    await pool
      .connect(liquidator.signer)
      .liquidationCall(agt.address, usdc.address, borrower.address, amountToLiquidate, false);

    const userReserveDataAfter = await getUserData(
      pool,
      helpersContract,
      usdc.address,
      borrower.address
    );

    // Verify debt was reduced by approximately the liquidated amount
    expect(userReserveDataAfter.currentVariableDebt.toString()).to.be.bignumber.almostEqual(
      new BigNumber(userReserveDataBefore.currentVariableDebt.toString())
        .minus(amountToLiquidate)
        .toFixed(0),
      'Invalid user borrow balance after liquidation'
    );
  });
});
