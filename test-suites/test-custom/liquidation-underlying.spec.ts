import BigNumber from 'bignumber.js';

import { DRE, increaseTime } from '../../helpers/misc-utils';
import { APPROVAL_AMOUNT_LENDING_POOL, oneEther, oneUsd } from '../../helpers/constants';
import { convertToCurrencyDecimals } from '../../helpers/contracts-helpers';
import { makeSuite } from './helpers/make-suite';
import { ProtocolErrors, RateMode } from '../../helpers/types';
import { calcExpectedVariableDebtTokenBalance } from '../test-aave/helpers/utils/calculations';
import { getReserveData, getUserData } from '../test-aave/helpers/utils/helpers';
import { mintTokens, getAdminSigner, stopImpersonatingAdmin, setAggregatorPrice, setLiquidationWhitelist } from './helpers/mint-tokens';

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
    const { configurator, oxau, pool, users, usdc, addressesProvider } = testEnv;
    const user = users[1];

    // Admin only operations
    const adminSigner = await getAdminSigner(addressesProvider);

    await configurator.connect(adminSigner).deactivateReserve(oxau.address);

    await expect(
      pool.liquidationCall(oxau.address, usdc.address, user.address, parseEther('1000'), false)
    ).to.be.revertedWith('2');

    await configurator.connect(adminSigner).activateReserve(oxau.address);

    await configurator.connect(adminSigner).deactivateReserve(usdc.address);

    await expect(
      pool.liquidationCall(oxau.address, usdc.address, user.address, parseEther('1000'), false)
    ).to.be.revertedWith('2');

    await configurator.connect(adminSigner).activateReserve(usdc.address);
    await stopImpersonatingAdmin(addressesProvider);
  });

  it('Deposits OXAU, borrows USDC', async () => {
    const { usdc, oxau, users, pool, oracle } = testEnv;
    const depositor = users[0];
    const borrower = users[1];

    //mints USDC to depositor - need enough for the borrow based on OXAU collateral value
    await mintTokens(usdc, depositor.address, await convertToCurrencyDecimals(usdc.address, '2000'), depositor.signer);

    //approve protocol to access depositor wallet
    await usdc.connect(depositor.signer).approve(pool.address, APPROVAL_AMOUNT_LENDING_POOL);

    const amountUSDCtoDeposit = await convertToCurrencyDecimals(usdc.address, '2000');

    await pool
      .connect(depositor.signer)
      .deposit(usdc.address, amountUSDCtoDeposit, depositor.address, '0');

    const amountOXAUToDeposit = await convertToCurrencyDecimals(oxau.address, '10');

    //mints OXAU to borrower
    await mintTokens(oxau, borrower.address, await convertToCurrencyDecimals(oxau.address, '100'), borrower.signer);

    //approve protocol to access the borrower wallet
    await oxau.connect(borrower.signer).approve(pool.address, APPROVAL_AMOUNT_LENDING_POOL);

    await pool
      .connect(borrower.signer)
      .deposit(oxau.address, amountOXAUToDeposit, borrower.address, '0');

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
    const { usdc, oxau, users, pool, oracle } = testEnv;
    const borrower = users[1];

    const usdcPrice = await oracle.getAssetPrice(usdc.address);

    // Use a multiplier (1.25x) to drop HF below 1
    await setAggregatorPrice(
      oracle,
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
    const { usdc, oxau, users, pool, oracle, helpersContract } = testEnv;
    const liquidator = users[3];
    const borrower = users[1];

    //mints usdc to the liquidator - need enough to cover half the debt
    await mintTokens(usdc, liquidator.address, await convertToCurrencyDecimals(usdc.address, '2000'), liquidator.signer);

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
      .liquidationCall(oxau.address, usdc.address, borrower.address, amountToLiquidate, false);

    const userReserveDataAfter = await getUserData(
      pool,
      helpersContract,
      usdc.address,
      borrower.address
    );

    const expectedDebtAfter = new BigNumber(userReserveDataBefore.currentVariableDebt.toString())
      .minus(amountToLiquidate);
    const diff = new BigNumber(userReserveDataAfter.currentVariableDebt.toString())
      .minus(expectedDebtAfter)
      .absoluteValue();
    expect(diff.toString()).to.be.bignumber.lte('200', 'Invalid user borrow balance after liquidation');
  });

  it('User 3 deposits 10000 USDC, user 4 deposits 100 OXAU, user 4 borrows - Loss', async () => {
    const { usdc, oxau, users, pool, oracle, helpersContract } = testEnv;
    const depositor = users[6];
    const borrower = users[7];

    // Reset USDC price to original value for this test
    await setAggregatorPrice(oracle, usdc.address, oneUsd.toFixed(0));

    //mints USDC to depositor - need enough for the borrow
    await mintTokens(usdc, depositor.address, await convertToCurrencyDecimals(usdc.address, '2000'), depositor.signer);

    //approve protocol to access depositor wallet
    await usdc.connect(depositor.signer).approve(pool.address, APPROVAL_AMOUNT_LENDING_POOL);

    const amountUSDCtoDeposit = await convertToCurrencyDecimals(usdc.address, '2000');

    await pool
      .connect(depositor.signer)
      .deposit(usdc.address, amountUSDCtoDeposit, depositor.address, '0');

    const amountOXAUToDeposit = await convertToCurrencyDecimals(oxau.address, '10');

    //mints OXAU to borrower
    await mintTokens(oxau, borrower.address, amountOXAUToDeposit, borrower.signer);

    //approve protocol to access borrower wallet
    await oxau.connect(borrower.signer).approve(pool.address, APPROVAL_AMOUNT_LENDING_POOL);

    await pool
      .connect(borrower.signer)
      .deposit(oxau.address, amountOXAUToDeposit, borrower.address, '0');

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

  it('Drop the health factor below 1 (second)', async () => {
    const { usdc, users, pool, oracle } = testEnv;
    const borrower = users[7];

    const usdcPrice = await oracle.getAssetPrice(usdc.address);

    // Use a multiplier (1.25x) to drop HF below 1
    await setAggregatorPrice(
      oracle,
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
    const { usdc, oxau, users, pool, helpersContract } = testEnv;
    const liquidator = users[8];
    const borrower = users[7];

    //mints usdc to the liquidator - need enough to cover half the debt
    await mintTokens(usdc, liquidator.address, await convertToCurrencyDecimals(usdc.address, '2000'), liquidator.signer);

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
      .liquidationCall(oxau.address, usdc.address, borrower.address, amountToLiquidate, false);

    const userReserveDataAfter = await getUserData(
      pool,
      helpersContract,
      usdc.address,
      borrower.address
    );

    const expectedDebtAfter = new BigNumber(userReserveDataBefore.currentVariableDebt.toString())
      .minus(amountToLiquidate);
    const diff = new BigNumber(userReserveDataAfter.currentVariableDebt.toString())
      .minus(expectedDebtAfter)
      .absoluteValue();
    expect(diff.toString()).to.be.bignumber.lte('200', 'Invalid user borrow balance after liquidation');
  });

  // ========== Whitelist Liquidation Tests ==========

  it('Whitelist 100% test: Deposits OXAU, borrows USDC', async () => {
    const { usdc, oxau, users, pool, oracle } = testEnv;
    const depositor = users[2];
    const borrower = users[4];

    // Reset USDC price to base value
    await setAggregatorPrice(oracle, usdc.address, oneUsd.toFixed(0));

    // depositor provides USDC liquidity
    await mintTokens(usdc, depositor.address, await convertToCurrencyDecimals(usdc.address, '10000'), depositor.signer);
    await usdc.connect(depositor.signer).approve(pool.address, APPROVAL_AMOUNT_LENDING_POOL);
    await pool
      .connect(depositor.signer)
      .deposit(usdc.address, await convertToCurrencyDecimals(usdc.address, '10000'), depositor.address, '0');

    const amountOXAUToDeposit = await convertToCurrencyDecimals(oxau.address, '10');
    await mintTokens(oxau, borrower.address, amountOXAUToDeposit, borrower.signer);
    await oxau.connect(borrower.signer).approve(pool.address, APPROVAL_AMOUNT_LENDING_POOL);
    await pool
      .connect(borrower.signer)
      .deposit(oxau.address, amountOXAUToDeposit, borrower.address, '0');

    // borrower borrows 95% of available
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
  });

  it('Drop HF below 0.95 for whitelist 100% test', async () => {
    const { usdc, users, pool, oracle } = testEnv;
    const borrower = users[4];

    const usdcPrice = await oracle.getAssetPrice(usdc.address);

    // 1.4x USDC price increase → HF ≈ 0.87
    await setAggregatorPrice(
      oracle,
      usdc.address,
      new BigNumber(usdcPrice.toString()).multipliedBy(1.4).toFixed(0)
    );

    const userGlobalData = await pool.getUserAccountData(borrower.address);
    expect(userGlobalData.healthFactor.toString()).to.be.bignumber.lt(
      parseEther('0.95').toString(),
      'Health factor should be below 0.95'
    );
  });

  it('Whitelisted liquidator liquidates ~100% of debt when HF <= 0.95', async () => {
    const { usdc, oxau, users, pool, helpersContract, configurator, addressesProvider } = testEnv;
    const borrower = users[4];
    const liquidator = users[5];

    // Whitelist the liquidator
    await setLiquidationWhitelist(configurator, addressesProvider, liquidator.address, true);

    const userReserveDataBefore = await getUserData(
      pool,
      helpersContract,
      usdc.address,
      borrower.address
    );

    const fullDebt = userReserveDataBefore.currentVariableDebt.toFixed(0);

    // Mint USDC to liquidator
    await mintTokens(usdc, liquidator.address, await convertToCurrencyDecimals(usdc.address, '10000'), liquidator.signer);
    await usdc.connect(liquidator.signer).approve(pool.address, APPROVAL_AMOUNT_LENDING_POOL);

    await increaseTime(100);

    // Liquidate requesting 100% of debt
    await pool
      .connect(liquidator.signer)
      .liquidationCall(oxau.address, usdc.address, borrower.address, fullDebt, false);

    const userReserveDataAfter = await getUserData(
      pool,
      helpersContract,
      usdc.address,
      borrower.address
    );

    // Minor residual debt can remain from accrued interest and rounding between read and liquidation.
    expect(userReserveDataAfter.currentVariableDebt.toString()).to.be.bignumber.lte(
      '50000000',
      'Whitelisted liquidator should liquidate ~100% when HF <= 0.95'
    );
  });

  it('Whitelist 50% test: Deposits OXAU, borrows USDC', async () => {
    const { usdc, oxau, users, pool, oracle } = testEnv;
    const depositor = users[9];
    const borrower = users[10];

    // Reset USDC price
    await setAggregatorPrice(oracle, usdc.address, oneUsd.toFixed(0));

    await mintTokens(usdc, depositor.address, await convertToCurrencyDecimals(usdc.address, '10000'), depositor.signer);
    await usdc.connect(depositor.signer).approve(pool.address, APPROVAL_AMOUNT_LENDING_POOL);
    await pool
      .connect(depositor.signer)
      .deposit(usdc.address, await convertToCurrencyDecimals(usdc.address, '10000'), depositor.address, '0');

    const amountOXAUToDeposit = await convertToCurrencyDecimals(oxau.address, '20');
    await mintTokens(oxau, borrower.address, amountOXAUToDeposit, borrower.signer);
    await oxau.connect(borrower.signer).approve(pool.address, APPROVAL_AMOUNT_LENDING_POOL);
    await pool
      .connect(borrower.signer)
      .deposit(oxau.address, amountOXAUToDeposit, borrower.address, '0');

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
  });

  it('Drop HF between 0.95 and 1.0 for whitelist 50% test', async () => {
    const { usdc, users, pool, oracle } = testEnv;
    const borrower = users[10];

    const usdcPrice = await oracle.getAssetPrice(usdc.address);

    // 1.25x USDC price increase → HF ≈ 0.97 (below 1.0 but above 0.95)
    await setAggregatorPrice(
      oracle,
      usdc.address,
      new BigNumber(usdcPrice.toString()).multipliedBy(1.25).toFixed(0)
    );

    const userGlobalData = await pool.getUserAccountData(borrower.address);

    expect(userGlobalData.healthFactor.toString()).to.be.bignumber.lt(
      oneEther.toFixed(0),
      'Health factor should be below 1'
    );
    expect(userGlobalData.healthFactor.toString()).to.be.bignumber.gt(
      parseEther('0.95').toString(),
      'Health factor should be above 0.95'
    );
  });

  it('Whitelisted liquidator limited to 50% when HF > 0.95 and position above dust', async () => {
    const { usdc, oxau, users, pool, helpersContract, configurator, addressesProvider } = testEnv;
    const borrower = users[10];
    const liquidator = users[11];

    // Whitelist the liquidator
    await setLiquidationWhitelist(configurator, addressesProvider, liquidator.address, true);

    const userReserveDataBefore = await getUserData(
      pool,
      helpersContract,
      usdc.address,
      borrower.address
    );

    const fullDebt = userReserveDataBefore.currentVariableDebt.toFixed(0);

    await mintTokens(usdc, liquidator.address, await convertToCurrencyDecimals(usdc.address, '10000'), liquidator.signer);
    await usdc.connect(liquidator.signer).approve(pool.address, APPROVAL_AMOUNT_LENDING_POOL);

    await increaseTime(100);

    // Try to liquidate 100% of debt
    await pool
      .connect(liquidator.signer)
      .liquidationCall(oxau.address, usdc.address, borrower.address, fullDebt, false);

    const userReserveDataAfter = await getUserData(
      pool,
      helpersContract,
      usdc.address,
      borrower.address
    );

    // Should only liquidate ~50% since HF > 0.95 and position > dust threshold
    const expectedRemaining = new BigNumber(userReserveDataBefore.currentVariableDebt.toString())
      .multipliedBy(0.50);
    const actualRemaining = new BigNumber(userReserveDataAfter.currentVariableDebt.toString());
    const diff = actualRemaining.minus(expectedRemaining).absoluteValue();
    expect(diff.toString()).to.be.bignumber.lte(
      '30',
      'Whitelisted liquidator should only liquidate ~50% when HF > 0.95 and position is not dust'
    );
  });

  it('Non-whitelisted liquidator limited to 50% (underlying)', async () => {
    const { usdc, oxau, users, pool, helpersContract, oracle } = testEnv;
    const depositor = users[users.length - 3];
    const borrower = users[users.length - 2];
    const liquidator = users[users.length - 1];

    await setAggregatorPrice(oracle, usdc.address, oneUsd.toFixed(0));

    await mintTokens(
      usdc,
      depositor.address,
      await convertToCurrencyDecimals(usdc.address, '10000'),
      depositor.signer
    );
    await usdc.connect(depositor.signer).approve(pool.address, APPROVAL_AMOUNT_LENDING_POOL);
    await pool
      .connect(depositor.signer)
      .deposit(
        usdc.address,
        await convertToCurrencyDecimals(usdc.address, '10000'),
        depositor.address,
        '0'
      );

    const amountOXAUToDeposit = await convertToCurrencyDecimals(oxau.address, '20');
    await mintTokens(oxau, borrower.address, amountOXAUToDeposit, borrower.signer);
    await oxau.connect(borrower.signer).approve(pool.address, APPROVAL_AMOUNT_LENDING_POOL);
    await pool
      .connect(borrower.signer)
      .deposit(oxau.address, amountOXAUToDeposit, borrower.address, '0');

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

    // Drop HF below 1 but above 0.95
    await setAggregatorPrice(
      oracle,
      usdc.address,
      new BigNumber(usdcPrice.toString()).multipliedBy(1.25).toFixed(0)
    );

    const userReserveDataBefore = await getUserData(
      pool,
      helpersContract,
      usdc.address,
      borrower.address
    );
    const fullDebt = userReserveDataBefore.currentVariableDebt.toFixed(0);

    await mintTokens(
      usdc,
      liquidator.address,
      await convertToCurrencyDecimals(usdc.address, '10000'),
      liquidator.signer
    );
    await usdc.connect(liquidator.signer).approve(pool.address, APPROVAL_AMOUNT_LENDING_POOL);

    await increaseTime(100);

    await pool
      .connect(liquidator.signer)
      .liquidationCall(oxau.address, usdc.address, borrower.address, fullDebt, false);

    const userReserveDataAfter = await getUserData(
      pool,
      helpersContract,
      usdc.address,
      borrower.address
    );

    const expectedRemaining = new BigNumber(userReserveDataBefore.currentVariableDebt.toString())
      .multipliedBy(0.50);
    const actualRemaining = new BigNumber(userReserveDataAfter.currentVariableDebt.toString());
    const diff = actualRemaining.minus(expectedRemaining).absoluteValue();
    expect(diff.toString()).to.be.bignumber.lte(
      '30',
      'Non-whitelisted liquidator should only liquidate ~50% (underlying)'
    );
  });

  it('Whitelisted liquidator can fully liquidate when dust threshold applies (underlying)', async () => {
    const { usdc, oxau, users, pool, helpersContract, configurator, addressesProvider, oracle } =
      testEnv;
    const depositor = users[users.length - 6];
    const borrower = users[users.length - 5];
    const liquidator = users[users.length - 4];

    await setAggregatorPrice(oracle, usdc.address, oneUsd.toFixed(0));

    await mintTokens(
      usdc,
      depositor.address,
      await convertToCurrencyDecimals(usdc.address, '10000'),
      depositor.signer
    );
    await usdc.connect(depositor.signer).approve(pool.address, APPROVAL_AMOUNT_LENDING_POOL);
    await pool
      .connect(depositor.signer)
      .deposit(
        usdc.address,
        await convertToCurrencyDecimals(usdc.address, '10000'),
        depositor.address,
        '0'
      );

    const amountOXAUToDeposit = await convertToCurrencyDecimals(oxau.address, '10');
    await mintTokens(oxau, borrower.address, amountOXAUToDeposit, borrower.signer);
    await oxau.connect(borrower.signer).approve(pool.address, APPROVAL_AMOUNT_LENDING_POOL);
    await pool
      .connect(borrower.signer)
      .deposit(oxau.address, amountOXAUToDeposit, borrower.address, '0');

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

    // Drop HF below 1 (dust still allows full liquidation)
    await setAggregatorPrice(
      oracle,
      usdc.address,
      new BigNumber(usdcPrice.toString()).multipliedBy(1.25).toFixed(0)
    );

    await setLiquidationWhitelist(configurator, addressesProvider, liquidator.address, true);

    await mintTokens(
      usdc,
      liquidator.address,
      await convertToCurrencyDecimals(usdc.address, '10000'),
      liquidator.signer
    );
    await usdc.connect(liquidator.signer).approve(pool.address, APPROVAL_AMOUNT_LENDING_POOL);

    const userReserveDataBefore = await getUserData(
      pool,
      helpersContract,
      usdc.address,
      borrower.address
    );
    const fullDebt = userReserveDataBefore.currentVariableDebt.toFixed(0);

    await increaseTime(100);
    await pool
      .connect(liquidator.signer)
      .liquidationCall(oxau.address, usdc.address, borrower.address, fullDebt, false);

    const userReserveDataAfter = await getUserData(
      pool,
      helpersContract,
      usdc.address,
      borrower.address
    );
    expect(userReserveDataAfter.currentVariableDebt.toString()).to.be.bignumber.lte(
      '20',
      'Whitelisted liquidator should fully liquidate when dust threshold applies (underlying)'
    );
  });
});
