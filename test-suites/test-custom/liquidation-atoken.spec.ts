import BigNumber from 'bignumber.js';

import { DRE } from '../../helpers/misc-utils';
import { APPROVAL_AMOUNT_LENDING_POOL, oneEther } from '../../helpers/constants';
import { convertToCurrencyDecimals } from '../../helpers/contracts-helpers';
import { makeSuite } from './helpers/make-suite';
import { ProtocolErrors, RateMode } from '../../helpers/types';
import { calcExpectedVariableDebtTokenBalance } from '../test-aave/helpers/utils/calculations';
import { getUserData, getReserveData } from '../test-aave/helpers/utils/helpers';

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
    const depositor = users[0];
    const borrower = users[1];

    //mints USDC to depositor
    await usdc.connect(depositor.signer).mint(await convertToCurrencyDecimals(usdc.address, '1000'));

    //approve protocol to access depositor wallet
    await usdc.connect(depositor.signer).approve(pool.address, APPROVAL_AMOUNT_LENDING_POOL);

    //user 1 deposits 1000 USDC
    const amountUSDCtoDeposit = await convertToCurrencyDecimals(usdc.address, '1000');
    await pool
      .connect(depositor.signer)
      .deposit(usdc.address, amountUSDCtoDeposit, depositor.address, '0');

    // Deposit 1000 AGT as collateral (same value as 1000 USDC since prices are equal)
    const amountAGTtoDeposit = await convertToCurrencyDecimals(agt.address, '1000');

    //mints AGT to borrower
    await agt.connect(borrower.signer).mint(amountAGTtoDeposit);

    //approve protocol to access borrower wallet
    await agt.connect(borrower.signer).approve(pool.address, APPROVAL_AMOUNT_LENDING_POOL);

    //user 2 deposits 1 AGT
    await pool
      .connect(borrower.signer)
      .deposit(agt.address, amountAGTtoDeposit, borrower.address, '0');

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

    await pool
      .connect(borrower.signer)
      .borrow(usdc.address, amountUSDCToBorrow, RateMode.Variable, '0', borrower.address);

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
    const borrower = users[1];

    const usdcPrice = await oracle.getAssetPrice(usdc.address);

    // Increase USDC price by 25% to drop health factor below 1
    // This should bring HF just below 1 so liquidation can restore it above 1
    await oracle.setAssetPrice(
      usdc.address,
      new BigNumber(usdcPrice.toString()).multipliedBy(1.25).toFixed(0)
    );

    const userGlobalData = await pool.getUserAccountData(borrower.address);

    expect(userGlobalData.healthFactor.toString()).to.be.bignumber.lt(
      oneEther.toString(),
      INVALID_HF
    );
  });

  it('Tries to liquidate a different currency than the loan principal', async () => {
    const { pool, users, agt } = testEnv;
    const borrower = users[1];
    //user 2 tries to borrow
    await expect(
      pool.liquidationCall(agt.address, agt.address, borrower.address, oneEther.toString(), true)
    ).revertedWith(LPCM_SPECIFIED_CURRENCY_NOT_BORROWED_BY_USER);
  });

  it('Tries to liquidate a different collateral than the borrower collateral', async () => {
    const { pool, usdc, users } = testEnv;
    const borrower = users[1];

    await expect(
      pool.liquidationCall(usdc.address, usdc.address, borrower.address, oneEther.toString(), true)
    ).revertedWith(LPCM_COLLATERAL_CANNOT_BE_LIQUIDATED);
  });

  it('Liquidates the borrow', async () => {
    const { pool, usdc, agt, users, oracle, helpersContract, deployer } = testEnv;
    const borrower = users[1];

    //mints usdc to the caller

    await usdc.mint(await convertToCurrencyDecimals(usdc.address, '1000'));

    //approve protocol to access depositor wallet
    await usdc.approve(pool.address, APPROVAL_AMOUNT_LENDING_POOL);

    const usdcReserveDataBefore = await getReserveData(helpersContract, usdc.address);
    const agtReserveDataBefore = await helpersContract.getReserveData(agt.address);

    const userReserveDataBefore = await getUserData(
      pool,
      helpersContract,
      usdc.address,
      borrower.address
    );

    const amountToLiquidate = new BigNumber(userReserveDataBefore.currentVariableDebt.toString())
      .div(2)
      .toFixed(0);

    const tx = await pool.liquidationCall(
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
    const agtReserveDataAfter = await helpersContract.getReserveData(agt.address);

    const collateralPrice = (await oracle.getAssetPrice(agt.address)).toString();
    const principalPrice = (await oracle.getAssetPrice(usdc.address)).toString();

    const collateralDecimals = (
      await helpersContract.getReserveConfigurationData(agt.address)
    ).decimals.toString();
    const principalDecimals = (
      await helpersContract.getReserveConfigurationData(usdc.address)
    ).decimals.toString();

    const expectedCollateralLiquidated = new BigNumber(principalPrice)
      .times(new BigNumber(amountToLiquidate).times(105))
      .times(new BigNumber(10).pow(collateralDecimals))
      .div(new BigNumber(collateralPrice).times(new BigNumber(10).pow(principalDecimals)))
      .decimalPlaces(0, BigNumber.ROUND_DOWN);

    if (!tx.blockNumber) {
      expect(false, 'Invalid block number');
      return;
    }

    const txTimestamp = new BigNumber(
      (await DRE.ethers.provider.getBlock(tx.blockNumber)).timestamp
    );

    const variableDebtBeforeTx = calcExpectedVariableDebtTokenBalance(
      usdcReserveDataBefore,
      userReserveDataBefore,
      txTimestamp
    );

    expect(userGlobalDataAfter.healthFactor.toString()).to.be.bignumber.gt(
      oneEther.toFixed(0),
      'Invalid health factor'
    );

    expect(userReserveDataAfter.currentVariableDebt.toString()).to.be.bignumber.almostEqual(
      new BigNumber(variableDebtBeforeTx).minus(amountToLiquidate).toFixed(0),
      'Invalid user borrow balance after liquidation'
    );

    expect(usdcReserveDataAfter.availableLiquidity.toString()).to.be.bignumber.almostEqual(
      new BigNumber(usdcReserveDataBefore.availableLiquidity.toString())
        .plus(amountToLiquidate)
        .toFixed(0),
      'Invalid principal available liquidity'
    );

    //the liquidity index of the principal reserve needs to be bigger than the index before
    expect(usdcReserveDataAfter.liquidityIndex.toString()).to.be.bignumber.gte(
      usdcReserveDataBefore.liquidityIndex.toString(),
      'Invalid liquidity index'
    );

    //the principal APY after a liquidation needs to be lower than the APY before
    expect(usdcReserveDataAfter.liquidityRate.toString()).to.be.bignumber.lt(
      usdcReserveDataBefore.liquidityRate.toString(),
      'Invalid liquidity APY'
    );

    expect(agtReserveDataAfter.availableLiquidity.toString()).to.be.bignumber.almostEqual(
      new BigNumber(agtReserveDataBefore.availableLiquidity.toString()).toFixed(0),
      'Invalid collateral available liquidity'
    );

    expect(
      (await helpersContract.getUserReserveData(agt.address, deployer.address))
        .usageAsCollateralEnabled
    ).to.be.true;
  });

  it('User 3 deposits 1000 USDT, user 4 1 AGT, user 4 borrows - drops HF, liquidates the borrow', async () => {
    const { users, pool, usdt, oracle, agt, helpersContract } = testEnv;
    const depositor = users[3];
    const borrower = users[4];

    //mints USDT to depositor
    await usdt
      .connect(depositor.signer)
      .mint(await convertToCurrencyDecimals(usdt.address, '1000'));

    //approve protocol to access depositor wallet
    await usdt.connect(depositor.signer).approve(pool.address, APPROVAL_AMOUNT_LENDING_POOL);

    //user 3 deposits 1000 USDT
    const amountUSDTtoDeposit = await convertToCurrencyDecimals(usdt.address, '1000');

    await pool
      .connect(depositor.signer)
      .deposit(usdt.address, amountUSDTtoDeposit, depositor.address, '0');

    //user 4 deposits 1000 AGT (enough collateral for borrowing USDT)
    const amountAGTtoDeposit = await convertToCurrencyDecimals(agt.address, '1000');

    //mints AGT to borrower
    await agt.connect(borrower.signer).mint(amountAGTtoDeposit);

    //approve protocol to access borrower wallet
    await agt.connect(borrower.signer).approve(pool.address, APPROVAL_AMOUNT_LENDING_POOL);

    await pool
      .connect(borrower.signer)
      .deposit(agt.address, amountAGTtoDeposit, borrower.address, '0');

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

    await pool
      .connect(borrower.signer)
      .borrow(usdt.address, amountUSDTToBorrow, RateMode.Variable, '0', borrower.address);

    //drops HF below 1 - increase USDT price by 25% to ensure HF < 1 and recoverable after liquidation

    await oracle.setAssetPrice(
      usdt.address,
      new BigNumber(usdtPrice.toString()).multipliedBy(1.25).toFixed(0)
    );

    //mints usdt to the liquidator

    await usdt.mint(await convertToCurrencyDecimals(usdt.address, '1000'));

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
});
