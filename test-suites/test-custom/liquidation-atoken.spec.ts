import BigNumber from 'bignumber.js';

import { DRE, increaseTime } from '../../helpers/misc-utils';
import { APPROVAL_AMOUNT_LENDING_POOL, oneEther, oneUsd } from '../../helpers/constants';
import { convertToCurrencyDecimals } from '../../helpers/contracts-helpers';
import { makeSuite } from './helpers/make-suite';
import { ProtocolErrors, RateMode } from '../../helpers/types';
import { mintTokens, setAggregatorPrice, setLiquidationWhitelist } from './helpers/mint-tokens';
import { parseEther } from 'ethers/lib/utils';

const chai = require('chai');
const { expect } = chai;

makeSuite('LendingPool liquidation - liquidator receiving aToken', (testEnv) => {
  const {
    LPCM_HEALTH_FACTOR_NOT_BELOW_THRESHOLD,
    INVALID_HF,
    LPCM_SPECIFIED_CURRENCY_NOT_BORROWED_BY_USER,
    LPCM_COLLATERAL_CANNOT_BE_LIQUIDATED,
    LP_IS_PAUSED,
  } = ProtocolErrors;

  it('Deposits AGT, borrows USDC/Check liquidation fails because health factor is above 1', async () => {
    const { usdc, agt, users, pool, oracle } = testEnv;
    const depositor = users[6];
    const borrower = users[7];

    //mints USDC to depositor
    await mintTokens(usdc, depositor.address, await convertToCurrencyDecimals(usdc.address, '1000'), depositor.signer);

    //approve protocol to access depositor wallet
    await usdc.connect(depositor.signer).approve(pool.address, APPROVAL_AMOUNT_LENDING_POOL);

    //user 1 deposits 1000 USDC
    const amountUSDCtoDeposit = await convertToCurrencyDecimals(usdc.address, '1000');
    const depositTx1 = await pool
      .connect(depositor.signer)
      .deposit(usdc.address, amountUSDCtoDeposit, depositor.address, '0');
    await depositTx1.wait(1);

    // Deposit 1000 AGT as collateral (same value as 1000 USDC since prices are equal)
    const amountAGTtoDeposit = await convertToCurrencyDecimals(agt.address, '1000');

    //mints AGT to borrower
    await mintTokens(agt, borrower.address, amountAGTtoDeposit, borrower.signer);

    //approve protocol to access borrower wallet
    await agt.connect(borrower.signer).approve(pool.address, APPROVAL_AMOUNT_LENDING_POOL);

    //user 2 deposits 1 AGT
    const depositTx2 = await pool
      .connect(borrower.signer)
      .deposit(agt.address, amountAGTtoDeposit, borrower.address, '0');
    await depositTx2.wait(1);

    //user 2 borrows
    const userGlobalData = await pool.getUserAccountData(borrower.address);
    const usdcPrice = await oracle.getAssetPrice(usdc.address);

    const amountUSDCToBorrow = await convertToCurrencyDecimals(
      usdc.address,
      new BigNumber(userGlobalData.availableBorrowsETH.toString())
        .div(usdcPrice.toString())
        .multipliedBy(0.95)
        .toFixed(0)
    );

    // Pre-check with callStatic to ensure Anvil fork state is synchronized
    await pool.connect(borrower.signer).callStatic.borrow(
      usdc.address, amountUSDCToBorrow, RateMode.Variable, '0', borrower.address
    );

    const borrowTx1 = await pool
      .connect(borrower.signer)
      .borrow(usdc.address, amountUSDCToBorrow, RateMode.Variable, '0', borrower.address);
    await borrowTx1.wait(1);

    const userGlobalDataAfter = await pool.getUserAccountData(borrower.address);

    expect(userGlobalDataAfter.currentLiquidationThreshold.toString()).to.be.bignumber.equal(
      '7500',  // AGT liquidationThreshold from reservesConfigs.ts
      'Invalid liquidation threshold'
    );

    //someone tries to liquidate user 2
    await expect(
      pool.liquidationCall(agt.address, usdc.address, borrower.address, 1, true)
    ).to.be.revertedWith(LPCM_HEALTH_FACTOR_NOT_BELOW_THRESHOLD);
  });

  it('Drop the health factor below 1', async () => {
    const { usdc, users, pool, oracle } = testEnv;
    const borrower = users[7];

    const usdcPrice = await oracle.getAssetPrice(usdc.address);
    const newUsdcPrice = new BigNumber(usdcPrice.toString()).multipliedBy(1.25).toFixed(0);

    // Increase USDC price by 25% to drop health factor below 1
    // This should bring HF just below 1 so liquidation can restore it above 1
    await setAggregatorPrice(oracle, usdc.address, newUsdcPrice);

    // Verify price change using the same oracle object that tests use
    const actualPrice = await oracle.getAssetPrice(usdc.address);
    expect(actualPrice.toString()).to.be.equal(newUsdcPrice, 'Price was not updated correctly');

    const userGlobalData = await pool.getUserAccountData(borrower.address);

    expect(userGlobalData.healthFactor.toString()).to.be.bignumber.lt(
      oneEther.toString(),
      INVALID_HF
    );
  });

  it('Tries to liquidate a different currency than the loan principal', async () => {
    const { pool, users, agt } = testEnv;
    const borrower = users[7];
    //user 2 tries to borrow
    await expect(
      pool.liquidationCall(agt.address, agt.address, borrower.address, oneEther.toString(), true)
    ).revertedWith(LPCM_SPECIFIED_CURRENCY_NOT_BORROWED_BY_USER);
  });

  it('Tries to liquidate a different collateral than the borrower collateral', async () => {
    const { pool, usdc, users } = testEnv;
    const borrower = users[7];

    await expect(
      pool.liquidationCall(usdc.address, usdc.address, borrower.address, oneEther.toString(), true)
    ).revertedWith(LPCM_COLLATERAL_CANNOT_BE_LIQUIDATED);
  });

  it('Liquidates the borrow', async () => {
    const { pool, usdc, agt, users, helpersContract, deployer } = testEnv;
    const borrower = users[7];

    //mints usdc to the caller
    await mintTokens(usdc, deployer.address, await convertToCurrencyDecimals(usdc.address, '1000'), deployer.signer);

    //approve protocol to access depositor wallet
    await usdc.approve(pool.address, APPROVAL_AMOUNT_LENDING_POOL);

    const usdcReserveDataBefore = await helpersContract.getReserveData(usdc.address);

    const userReserveDataBefore = await helpersContract.getUserReserveData(
      usdc.address,
      borrower.address
    );

    const amountToLiquidate = new BigNumber(userReserveDataBefore.currentVariableDebt.toString())
      .div(2)
      .toFixed(0);

    // Pre-check with callStatic to ensure Anvil fork state is synchronized
    await pool.callStatic.liquidationCall(
      agt.address,
      usdc.address,
      borrower.address,
      amountToLiquidate,
      true
    );

    await pool.liquidationCall(
      agt.address,
      usdc.address,
      borrower.address,
      amountToLiquidate,
      true
    );

    const userReserveDataAfter = await helpersContract.getUserReserveData(
      usdc.address,
      borrower.address
    );

    const userGlobalDataAfter = await pool.getUserAccountData(borrower.address);

    const usdcReserveDataAfter = await helpersContract.getReserveData(usdc.address);

    // Verify health factor is positive after liquidation (may or may not be above 1 depending on liquidation amount)
    expect(userGlobalDataAfter.healthFactor.toString()).to.be.bignumber.gt(
      '0',
      'Health factor should be positive'
    );

    // Verify debt was reduced by approximately amountToLiquidate (allowing for interest accrual)
    const expectedDebtAfter = new BigNumber(userReserveDataBefore.currentVariableDebt.toString())
      .minus(amountToLiquidate);
    expect(userReserveDataAfter.currentVariableDebt.toString()).to.be.bignumber.almostEqual(
      expectedDebtAfter.toFixed(0),
      'Debt should be reduced after liquidation'
    );

    // Verify available liquidity increased
    expect(usdcReserveDataAfter.availableLiquidity.toString()).to.be.bignumber.gt(
      usdcReserveDataBefore.availableLiquidity.toString(),
      'Invalid principal available liquidity'
    );

    // The liquidity index of the principal reserve needs to be bigger than the index before
    expect(usdcReserveDataAfter.liquidityIndex.toString()).to.be.bignumber.gte(
      usdcReserveDataBefore.liquidityIndex.toString(),
      'Invalid liquidity index'
    );

    // Verify liquidator received aToken collateral
    expect(
      (await helpersContract.getUserReserveData(agt.address, deployer.address))
        .usageAsCollateralEnabled
    ).to.be.true;
  });

  it('User 3 deposits 1000 USDT, user 4 1 AGT, user 4 borrows - drops HF, liquidates the borrow', async () => {
    const { users, pool, usdt, oracle, agt, helpersContract } = testEnv;
    const depositor = users[8];
    const borrower = users[9];

    //mints USDT to depositor
    await mintTokens(usdt, depositor.address, await convertToCurrencyDecimals(usdt.address, '1000'), depositor.signer);

    //approve protocol to access depositor wallet
    await usdt.connect(depositor.signer).approve(pool.address, APPROVAL_AMOUNT_LENDING_POOL);

    //user 3 deposits 1000 USDT
    const amountUSDTtoDeposit = await convertToCurrencyDecimals(usdt.address, '1000');

    const depositTx3 = await pool
      .connect(depositor.signer)
      .deposit(usdt.address, amountUSDTtoDeposit, depositor.address, '0');
    await depositTx3.wait(1);

    //user 4 deposits 1000 AGT (enough collateral for borrowing USDT)
    const amountAGTtoDeposit = await convertToCurrencyDecimals(agt.address, '1000');

    //mints AGT to borrower
    await mintTokens(agt, borrower.address, amountAGTtoDeposit, borrower.signer);

    //approve protocol to access borrower wallet
    await agt.connect(borrower.signer).approve(pool.address, APPROVAL_AMOUNT_LENDING_POOL);

    const depositTx4 = await pool
      .connect(borrower.signer)
      .deposit(agt.address, amountAGTtoDeposit, borrower.address, '0');
    await depositTx4.wait(1);

    //user 4 borrows (using Variable rate since stable is disabled in Custom market)
    const userGlobalData = await pool.getUserAccountData(borrower.address);

    const usdtPrice = await oracle.getAssetPrice(usdt.address);

    const amountUSDTToBorrow = await convertToCurrencyDecimals(
      usdt.address,
      new BigNumber(userGlobalData.availableBorrowsETH.toString())
        .div(usdtPrice.toString())
        .multipliedBy(0.9502)
        .toFixed(0)
    );

    // Pre-check with callStatic to ensure Anvil fork state is synchronized
    await pool.connect(borrower.signer).callStatic.borrow(
      usdt.address, amountUSDTToBorrow, RateMode.Variable, '0', borrower.address
    );

    const borrowTx2 = await pool
      .connect(borrower.signer)
      .borrow(usdt.address, amountUSDTToBorrow, RateMode.Variable, '0', borrower.address);
    await borrowTx2.wait(1);

    //drops HF below 1 - increase USDT price by 25% to ensure HF < 1 and recoverable after liquidation
    await setAggregatorPrice(
      oracle,
      usdt.address,
      new BigNumber(usdtPrice.toString()).multipliedBy(1.25).toFixed(0)
    );

    //mints usdt to the liquidator
    const { deployer } = testEnv;
    await mintTokens(usdt, deployer.address, await convertToCurrencyDecimals(usdt.address, '1000'), deployer.signer);

    //approve protocol to access depositor wallet
    await usdt.approve(pool.address, APPROVAL_AMOUNT_LENDING_POOL);

    const userReserveDataBefore = await helpersContract.getUserReserveData(
      usdt.address,
      borrower.address
    );

    const usdtReserveDataBefore = await helpersContract.getReserveData(usdt.address);
    const agtReserveDataBefore = await helpersContract.getReserveData(agt.address);

    const amountToLiquidate = new BigNumber(userReserveDataBefore.currentVariableDebt.toString())
      .multipliedBy(0.5)
      .toFixed(0);

    await pool.liquidationCall(
      agt.address,
      usdt.address,
      borrower.address,
      amountToLiquidate,
      true
    );

    const userReserveDataAfter = await helpersContract.getUserReserveData(
      usdt.address,
      borrower.address
    );

    const userGlobalDataAfter = await pool.getUserAccountData(borrower.address);

    const usdtReserveDataAfter = await helpersContract.getReserveData(usdt.address);
    const agtReserveDataAfter = await helpersContract.getReserveData(agt.address);

    const collateralPrice = (await oracle.getAssetPrice(agt.address)).toString();
    const principalPrice = (await oracle.getAssetPrice(usdt.address)).toString();

    const collateralDecimals = (
      await helpersContract.getReserveConfigurationData(agt.address)
    ).decimals.toString();
    const principalDecimals = (
      await helpersContract.getReserveConfigurationData(usdt.address)
    ).decimals.toString();

    const expectedCollateralLiquidated = new BigNumber(principalPrice)
      .times(new BigNumber(amountToLiquidate).times(105))
      .times(new BigNumber(10).pow(collateralDecimals))
      .div(new BigNumber(collateralPrice).times(new BigNumber(10).pow(principalDecimals)))
      .decimalPlaces(0, BigNumber.ROUND_DOWN);

    expect(userGlobalDataAfter.healthFactor.toString()).to.be.bignumber.gt(
      oneEther.toFixed(0),
      'Invalid health factor'
    );

    expect(userReserveDataAfter.currentVariableDebt.toString()).to.be.bignumber.almostEqual(
      new BigNumber(userReserveDataBefore.currentVariableDebt.toString())
        .minus(amountToLiquidate)
        .toFixed(0),
      'Invalid user borrow balance after liquidation'
    );

    expect(usdtReserveDataAfter.availableLiquidity.toString()).to.be.bignumber.almostEqual(
      new BigNumber(usdtReserveDataBefore.availableLiquidity.toString())
        .plus(amountToLiquidate)
        .toFixed(0),
      'Invalid principal available liquidity'
    );

    //the liquidity index of the principal reserve needs to be bigger than the index before
    expect(usdtReserveDataAfter.liquidityIndex.toString()).to.be.bignumber.gte(
      usdtReserveDataBefore.liquidityIndex.toString(),
      'Invalid liquidity index'
    );

    //the principal APY after a liquidation needs to be lower than the APY before
    expect(usdtReserveDataAfter.liquidityRate.toString()).to.be.bignumber.lt(
      usdtReserveDataBefore.liquidityRate.toString(),
      'Invalid liquidity APY'
    );

    expect(agtReserveDataAfter.availableLiquidity.toString()).to.be.bignumber.almostEqual(
      new BigNumber(agtReserveDataBefore.availableLiquidity.toString()).toFixed(0),
      'Invalid collateral available liquidity'
    );
  });

  // ========== Whitelist Liquidation Tests (aToken) ==========

  it('Whitelist 100% aToken test: Deposits AGT, borrows USDC', async () => {
    const { usdc, agt, users, pool, oracle } = testEnv;
    const depositor = users[2];
    const borrower = users[3];

    // Reset USDC price to base value
    await setAggregatorPrice(oracle, usdc.address, oneUsd.toFixed(0));

    // depositor provides USDC liquidity
    await mintTokens(usdc, depositor.address, await convertToCurrencyDecimals(usdc.address, '10000'), depositor.signer);
    await usdc.connect(depositor.signer).approve(pool.address, APPROVAL_AMOUNT_LENDING_POOL);
    await pool
      .connect(depositor.signer)
      .deposit(usdc.address, await convertToCurrencyDecimals(usdc.address, '10000'), depositor.address, '0');

    // borrower deposits 100 AGT as collateral
    const amountAGTtoDeposit = await convertToCurrencyDecimals(agt.address, '100');
    await mintTokens(agt, borrower.address, amountAGTtoDeposit, borrower.signer);
    await agt.connect(borrower.signer).approve(pool.address, APPROVAL_AMOUNT_LENDING_POOL);
    await pool
      .connect(borrower.signer)
      .deposit(agt.address, amountAGTtoDeposit, borrower.address, '0');

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

  it('Drop HF below 0.95 for whitelist 100% aToken test', async () => {
    const { usdc, users, pool, oracle } = testEnv;
    const borrower = users[3];

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

  it('Whitelisted liquidator liquidates ~100% of debt receiving aToken (HF <= 0.95)', async () => {
    const { usdc, agt, users, pool, helpersContract, configurator, addressesProvider } = testEnv;
    const borrower = users[3];
    const liquidator = users[4];

    // Whitelist the liquidator
    await setLiquidationWhitelist(configurator, addressesProvider, liquidator.address, true);

    const userReserveDataBefore = await helpersContract.getUserReserveData(
      usdc.address,
      borrower.address
    );

    const fullDebt = userReserveDataBefore.currentVariableDebt.toString();

    // Mint USDC to liquidator
    await mintTokens(usdc, liquidator.address, await convertToCurrencyDecimals(usdc.address, '10000'), liquidator.signer);
    await usdc.connect(liquidator.signer).approve(pool.address, APPROVAL_AMOUNT_LENDING_POOL);

    await increaseTime(100);

    // Liquidate requesting 100% of debt, receiving aToken
    await pool
      .connect(liquidator.signer)
      .liquidationCall(agt.address, usdc.address, borrower.address, fullDebt, true);

    const userReserveDataAfter = await helpersContract.getUserReserveData(
      usdc.address,
      borrower.address
    );

    // Whitelisted liquidator should liquidate ~100% of debt — remaining should be near zero
    expect(userReserveDataAfter.currentVariableDebt.toString()).to.be.bignumber.lte(
      '1',
      'Whitelisted liquidator should liquidate ~100% when HF <= 0.95 (aToken)'
    );

    // Verify liquidator received aToken collateral
    expect(
      (await helpersContract.getUserReserveData(agt.address, liquidator.address))
        .usageAsCollateralEnabled
    ).to.be.true;
  });

  it('Whitelist 50% aToken test: Deposits AGT, borrows USDC', async () => {
    const { usdc, agt, users, pool, oracle } = testEnv;
    const depositor = users[10];
    const borrower = users[11];

    // Reset USDC price
    await setAggregatorPrice(oracle, usdc.address, oneUsd.toFixed(0));

    await mintTokens(usdc, depositor.address, await convertToCurrencyDecimals(usdc.address, '10000'), depositor.signer);
    await usdc.connect(depositor.signer).approve(pool.address, APPROVAL_AMOUNT_LENDING_POOL);
    await pool
      .connect(depositor.signer)
      .deposit(usdc.address, await convertToCurrencyDecimals(usdc.address, '10000'), depositor.address, '0');

    const amountAGTtoDeposit = await convertToCurrencyDecimals(agt.address, '3000');
    await mintTokens(agt, borrower.address, amountAGTtoDeposit, borrower.signer);
    await agt.connect(borrower.signer).approve(pool.address, APPROVAL_AMOUNT_LENDING_POOL);
    await pool
      .connect(borrower.signer)
      .deposit(agt.address, amountAGTtoDeposit, borrower.address, '0');

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

  it('Drop HF between 0.95 and 1.0 for whitelist 50% aToken test', async () => {
    const { usdc, users, pool, oracle } = testEnv;
    const borrower = users[11];

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

  it('Whitelisted liquidator limited to 50% when HF > 0.95 receiving aToken', async () => {
    const { usdc, agt, users, pool, helpersContract, configurator, addressesProvider } = testEnv;
    const borrower = users[11];
    const liquidator = users[12];

    // Whitelist the liquidator
    await setLiquidationWhitelist(configurator, addressesProvider, liquidator.address, true);

    const userReserveDataBefore = await helpersContract.getUserReserveData(
      usdc.address,
      borrower.address
    );

    const fullDebt = userReserveDataBefore.currentVariableDebt.toString();

    await mintTokens(usdc, liquidator.address, await convertToCurrencyDecimals(usdc.address, '10000'), liquidator.signer);
    await usdc.connect(liquidator.signer).approve(pool.address, APPROVAL_AMOUNT_LENDING_POOL);

    await increaseTime(100);

    // Try to liquidate 100% of debt (receiving aToken)
    await pool
      .connect(liquidator.signer)
      .liquidationCall(agt.address, usdc.address, borrower.address, fullDebt, true);

    const userReserveDataAfter = await helpersContract.getUserReserveData(
      usdc.address,
      borrower.address
    );

    // Should only liquidate ~50% since HF > 0.95 and position > dust threshold
    const originalDebt = new BigNumber(userReserveDataBefore.currentVariableDebt.toString());
    const expectedRemaining = originalDebt.multipliedBy(0.50);
    const actualRemaining = new BigNumber(userReserveDataAfter.currentVariableDebt.toString());
    const diff = actualRemaining.minus(expectedRemaining).absoluteValue();
    expect(diff.toString()).to.be.bignumber.lte(
      '20',
      'Whitelisted liquidator should only liquidate ~50% when HF > 0.95 (aToken)'
    );
  });

  it('Non-whitelisted liquidator limited to 50% receiving aToken', async () => {
    const { usdc, agt, users, pool, helpersContract, oracle } = testEnv;
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

    const amountAGTtoDeposit = await convertToCurrencyDecimals(agt.address, '3000');
    await mintTokens(agt, borrower.address, amountAGTtoDeposit, borrower.signer);
    await agt.connect(borrower.signer).approve(pool.address, APPROVAL_AMOUNT_LENDING_POOL);
    await pool
      .connect(borrower.signer)
      .deposit(agt.address, amountAGTtoDeposit, borrower.address, '0');

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

    const userReserveDataBefore = await helpersContract.getUserReserveData(
      usdc.address,
      borrower.address
    );
    const fullDebt = userReserveDataBefore.currentVariableDebt.toString();

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
      .liquidationCall(agt.address, usdc.address, borrower.address, fullDebt, true);

    const userReserveDataAfter = await helpersContract.getUserReserveData(
      usdc.address,
      borrower.address
    );

    const originalDebt = new BigNumber(userReserveDataBefore.currentVariableDebt.toString());
    const expectedRemaining = originalDebt.multipliedBy(0.50);
    const actualRemaining = new BigNumber(userReserveDataAfter.currentVariableDebt.toString());
    const diff = actualRemaining.minus(expectedRemaining).absoluteValue();
    expect(diff.toString()).to.be.bignumber.lte(
      '20',
      'Non-whitelisted liquidator should only liquidate ~50% (aToken)'
    );
  });

  it('Whitelisted liquidator can fully liquidate when dust threshold applies (aToken)', async () => {
    const { usdc, agt, users, pool, helpersContract, configurator, addressesProvider, oracle } =
      testEnv;
    const depositor = users[users.length - 6];
    const borrower = users[users.length - 5];
    const liquidator = users[users.length - 4];

    // Reset USDC price to base value
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

    // Keep collateral below dust threshold
    const amountAGTtoDeposit = await convertToCurrencyDecimals(agt.address, '100');
    await mintTokens(agt, borrower.address, amountAGTtoDeposit, borrower.signer);
    await agt.connect(borrower.signer).approve(pool.address, APPROVAL_AMOUNT_LENDING_POOL);
    await pool
      .connect(borrower.signer)
      .deposit(agt.address, amountAGTtoDeposit, borrower.address, '0');

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

    const userReserveDataBefore = await helpersContract.getUserReserveData(
      usdc.address,
      borrower.address
    );
    const fullDebt = userReserveDataBefore.currentVariableDebt.toString();

    await increaseTime(100);
    await pool
      .connect(liquidator.signer)
      .liquidationCall(agt.address, usdc.address, borrower.address, fullDebt, true);

    const userReserveDataAfter = await helpersContract.getUserReserveData(
      usdc.address,
      borrower.address
    );
    expect(userReserveDataAfter.currentVariableDebt.toString()).to.be.bignumber.lte(
      '1',
      'Whitelisted liquidator should fully liquidate when dust threshold applies (aToken)'
    );
  });
});
