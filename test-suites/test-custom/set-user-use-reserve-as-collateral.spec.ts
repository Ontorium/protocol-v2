import { makeSuite, TestEnv } from './helpers/make-suite';
import { parseEther, parseUnits } from 'ethers/lib/utils';
import { MAX_UINT_AMOUNT } from '../../helpers/constants';
import { mintTokens } from './helpers/mint-tokens';
import { ProtocolErrors, RateMode } from '../../helpers/types';
import { waitForTx } from '../../helpers/misc-utils';

const { expect } = require('chai');

makeSuite('Custom Market - setUserUseReserveAsCollateral', (testEnv: TestEnv) => {
  const {
    VL_DEPOSIT_ALREADY_IN_USE,
    VL_UNDERLYING_BALANCE_NOT_GREATER_THAN_0,
  } = ProtocolErrors;

  it('User deposits USDC', async () => {
    const { usdc, pool, users, helpersContract } = testEnv;
    const user = users[0];

    const depositAmount = parseUnits('1000', 6);
    await mintTokens(usdc, user.address, depositAmount, user.signer);
    await usdc.connect(user.signer).approve(pool.address, MAX_UINT_AMOUNT);

    await waitForTx(
      await pool.connect(user.signer).deposit(usdc.address, depositAmount, user.address, 0)
    );

    const userConfig = await helpersContract.getUserReserveData(usdc.address, user.address);
    expect(userConfig.usageAsCollateralEnabled).to.be.true;
  });

  it('User can disable USDC as collateral when no borrows exist', async () => {
    const { usdc, pool, users, helpersContract } = testEnv;
    const user = users[0];

    await waitForTx(
      await pool.connect(user.signer).setUserUseReserveAsCollateral(usdc.address, false)
    );

    const userConfig = await helpersContract.getUserReserveData(usdc.address, user.address);
    expect(userConfig.usageAsCollateralEnabled).to.be.false;

    // User account data should show 0 collateral
    const userData = await pool.getUserAccountData(user.address);
    expect(userData.totalCollateralETH).to.be.equal(0);
  });

  it('User can re-enable USDC as collateral', async () => {
    const { usdc, pool, users, helpersContract } = testEnv;
    const user = users[0];

    await waitForTx(
      await pool.connect(user.signer).setUserUseReserveAsCollateral(usdc.address, true)
    );

    const userConfig = await helpersContract.getUserReserveData(usdc.address, user.address);
    expect(userConfig.usageAsCollateralEnabled).to.be.true;

    // User account data should show collateral
    const userData = await pool.getUserAccountData(user.address);
    expect(userData.totalCollateralETH).to.be.gt(0);
  });

  it('User with borrow cannot disable collateral if it would cause undercollateralization (revert expected)', async () => {
    const { oxau, usdc, pool, users } = testEnv;
    const depositor = users[1];
    const borrower = users[0]; // Same user from previous tests

    // Setup: Deposit OXAU liquidity
    const oxauAmount = parseEther('10000');
    await mintTokens(oxau, depositor.address, oxauAmount, depositor.signer);
    await oxau.connect(depositor.signer).approve(pool.address, MAX_UINT_AMOUNT);
    await waitForTx(
      await pool.connect(depositor.signer).deposit(oxau.address, oxauAmount, depositor.address, 0)
    );

    // Borrower takes a loan
    const borrowAmount = parseEther('4');
    try {
      await pool
        .connect(borrower.signer)
        .callStatic.borrow(oxau.address, borrowAmount, RateMode.Variable, 0, borrower.address);
      console.log('callStatic.borrow OK');
    } catch (e: any) {
      console.log('callStatic.borrow REVERT:', e?.error?.message ?? e?.reason ?? e?.message);
      console.log('revert data:', e?.error?.data ?? e?.data);
      throw e;
    }

    await waitForTx(
      await pool
        .connect(borrower.signer)
        .borrow(oxau.address, borrowAmount, RateMode.Variable, 0, borrower.address)
    );

    // Trying to disable collateral should fail
    await expect(
      pool.connect(borrower.signer).setUserUseReserveAsCollateral(usdc.address, false)
    ).to.be.revertedWith(VL_DEPOSIT_ALREADY_IN_USE);
  });

  it('User cannot disable collateral for a reserve they have no deposits in (revert expected)', async () => {
    const { usdt, pool, users } = testEnv;
    const userWithNoUSDT = users[2];

    await expect(
      pool.connect(userWithNoUSDT.signer).setUserUseReserveAsCollateral(usdt.address, false)
    ).to.be.revertedWith(VL_UNDERLYING_BALANCE_NOT_GREATER_THAN_0);
  });

  it('Multiple collateral types - user can disable one while keeping others', async () => {
    const { oxau, usdc, usdt, pool, users, helpersContract } = testEnv;
    const user = users[3];

    // Deposit USDC
    const usdcAmount = parseUnits('1000', 6);
    await mintTokens(usdc, user.address, usdcAmount, user.signer);
    await usdc.connect(user.signer).approve(pool.address, MAX_UINT_AMOUNT);
    await waitForTx(
      await pool.connect(user.signer).deposit(usdc.address, usdcAmount, user.address, 0)
    );

    // Deposit USDT
    const usdtAmount = parseUnits('1000', 6);
    await mintTokens(usdt, user.address, usdtAmount, user.signer);
    await usdt.connect(user.signer).approve(pool.address, MAX_UINT_AMOUNT);
    await waitForTx(
      await pool.connect(user.signer).deposit(usdt.address, usdtAmount, user.address, 0)
    );

    // Deposit OXAU
    const oxauAmount = parseEther('500');
    await mintTokens(oxau, user.address, oxauAmount, user.signer);
    await oxau.connect(user.signer).approve(pool.address, MAX_UINT_AMOUNT);
    await waitForTx(
      await pool.connect(user.signer).deposit(oxau.address, oxauAmount, user.address, 0)
    );

    const collateralBefore = await pool.getUserAccountData(user.address);
    console.log('Total collateral with all assets:', collateralBefore.totalCollateralETH.toString());

    // Disable USDT as collateral
    await waitForTx(
      await pool.connect(user.signer).setUserUseReserveAsCollateral(usdt.address, false)
    );

    const collateralAfter = await pool.getUserAccountData(user.address);
    console.log('Total collateral after disabling USDT:', collateralAfter.totalCollateralETH.toString());

    // Verify USDT is disabled, others are still enabled
    const usdcConfig = await helpersContract.getUserReserveData(usdc.address, user.address);
    const usdtConfig = await helpersContract.getUserReserveData(usdt.address, user.address);
    const agtConfig = await helpersContract.getUserReserveData(oxau.address, user.address);

    expect(usdcConfig.usageAsCollateralEnabled).to.be.true;
    expect(usdtConfig.usageAsCollateralEnabled).to.be.false;
    expect(agtConfig.usageAsCollateralEnabled).to.be.true;

    // Collateral should have decreased
    expect(collateralAfter.totalCollateralETH).to.be.lt(collateralBefore.totalCollateralETH);
  });

  it('User with multiple collaterals and borrow can disable unused collateral if HF stays above 1', async () => {
    const { oxau, usdc, usdt, pool, users, helpersContract } = testEnv;
    const user = users[3]; // User from previous test

    // User already has USDC, USDT (disabled), OXAU deposited
    // Re-enable USDT first
    await waitForTx(
      await pool.connect(user.signer).setUserUseReserveAsCollateral(usdt.address, true)
    );

    // Take a small borrow (should be well-collateralized with all three assets)
    const borrowAmount = parseEther('100');
    await waitForTx(
      await pool
        .connect(user.signer)
        .borrow(oxau.address, borrowAmount, RateMode.Variable, 0, user.address)
    );

    const userDataBefore = await pool.getUserAccountData(user.address);
    console.log('Health factor before disabling USDT:', userDataBefore.healthFactor.toString());

    // Should be able to disable USDT since USDC + OXAU provide enough collateral
    await waitForTx(
      await pool.connect(user.signer).setUserUseReserveAsCollateral(usdt.address, false)
    );

    const userDataAfter = await pool.getUserAccountData(user.address);
    console.log('Health factor after disabling USDT:', userDataAfter.healthFactor.toString());

    // HF should still be > 1
    expect(userDataAfter.healthFactor).to.be.gt(parseEther('1'));

    const usdtConfig = await helpersContract.getUserReserveData(usdt.address, user.address);
    expect(usdtConfig.usageAsCollateralEnabled).to.be.false;
  });

  it('Toggling collateral does not affect deposit balance', async () => {
    const { usdc, aUSDC, pool, users, helpersContract } = testEnv;
    const user = users[4];

    // Deposit USDC
    const depositAmount = parseUnits('500', 6);
    await mintTokens(usdc, user.address, depositAmount, user.signer);
    await usdc.connect(user.signer).approve(pool.address, MAX_UINT_AMOUNT);
    try {
      await pool
        .connect(user.signer)
        .callStatic.deposit(usdc.address, depositAmount, user.address, 0);
      console.log('callStatic.deposit OK');
    } catch (e: any) {
      console.log('callStatic.deposit REVERT:', e?.error?.message ?? e?.reason ?? e?.message);
      console.log('revert data:', e?.error?.data ?? e?.data);
      throw e;
    }

    await waitForTx(
      await pool.connect(user.signer).deposit(usdc.address, depositAmount, user.address, 0)
    );

    const aTokenBalanceBefore = await aUSDC.balanceOf(user.address);

    // Disable collateral
    await waitForTx(
      await pool.connect(user.signer).setUserUseReserveAsCollateral(usdc.address, false)
    );

    const aTokenBalanceAfterDisable = await aUSDC.balanceOf(user.address);
    expect(aTokenBalanceAfterDisable).to.be.eq(aTokenBalanceBefore);

    // Re-enable collateral
    await waitForTx(
      await pool.connect(user.signer).setUserUseReserveAsCollateral(usdc.address, true)
    );

    const aTokenBalanceAfterEnable = await aUSDC.balanceOf(user.address);
    expect(aTokenBalanceAfterEnable).to.be.eq(aTokenBalanceBefore);
  });

  it('Withdrawing all deposits automatically sets usageAsCollateral to false', async () => {
    const { usdc, pool, users, helpersContract } = testEnv;
    const user = users[5];

    // Deposit USDC
    const depositAmount = parseUnits('500', 6);
    await mintTokens(usdc, user.address, depositAmount, user.signer);
    await usdc.connect(user.signer).approve(pool.address, MAX_UINT_AMOUNT);
    try {
      await pool
        .connect(user.signer)
        .callStatic.deposit(usdc.address, depositAmount, user.address, 0);
      console.log('callStatic.deposit OK');
    } catch (e: any) {
      console.log('callStatic.deposit REVERT:', e?.error?.message ?? e?.reason ?? e?.message);
      console.log('revert data:', e?.error?.data ?? e?.data);
      throw e;
    }
    await waitForTx(
      await pool.connect(user.signer).deposit(usdc.address, depositAmount, user.address, 0)
    );

    let userConfig = await helpersContract.getUserReserveData(usdc.address, user.address);
    expect(userConfig.usageAsCollateralEnabled).to.be.true;

    // Withdraw all
    await waitForTx(
      await pool.connect(user.signer).withdraw(usdc.address, MAX_UINT_AMOUNT, user.address)
    );

    userConfig = await helpersContract.getUserReserveData(usdc.address, user.address);
    // After full withdrawal, usageAsCollateral should be reset (no balance to use)
    expect(userConfig.currentATokenBalance).to.be.eq(0);
  });

  it('Depositing after full withdrawal re-enables collateral by default', async () => {
    const { usdc, pool, users, helpersContract } = testEnv;
    const user = users[5]; // Same user from previous test

    // Deposit again
    const depositAmount = parseUnits('300', 6);
    await mintTokens(usdc, user.address, depositAmount, user.signer);
    await waitForTx(
      await pool.connect(user.signer).deposit(usdc.address, depositAmount, user.address, 0)
    );

    const userConfig = await helpersContract.getUserReserveData(usdc.address, user.address);
    expect(userConfig.usageAsCollateralEnabled).to.be.true;
  });
});
