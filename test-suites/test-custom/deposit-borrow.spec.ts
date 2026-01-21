import { makeSuite, TestEnv } from './helpers/make-suite';
import { parseEther, parseUnits } from 'ethers/lib/utils';
import { ethers } from 'ethers';
import { MAX_UINT_AMOUNT, ZERO_ADDRESS } from '../../helpers/constants';
import { mintTokens } from './helpers/mint-tokens';
import { ProtocolErrors, RateMode } from '../../helpers/types';
import { waitForTx } from '../../helpers/misc-utils';

const { expect } = require('chai');
makeSuite('Custom Market - Deposit & Borrow', (testEnv: TestEnv) => {
  const {
    VL_INVALID_AMOUNT,
    VL_NOT_ENOUGH_AVAILABLE_USER_BALANCE,
    VL_COLLATERAL_BALANCE_IS_0,
    VL_COLLATERAL_CANNOT_COVER_NEW_BORROW
  } = ProtocolErrors;

  // Basic Deposit Tests

  it('User deposits 1000 USDC', async () => {
    const { usdc, pool, users } = testEnv;
    const depositor = users[1];

    const mintAmount = parseUnits('1000', 6);
    await mintTokens(usdc, depositor.address, mintAmount, depositor.signer);

    await usdc.connect(depositor.signer).approve(pool.address, MAX_UINT_AMOUNT);

    await pool
      .connect(depositor.signer)
      .deposit(usdc.address, mintAmount, depositor.address, 0);

    const userData = await pool.getUserAccountData(depositor.address);

    console.log('User account data after USDC deposit:');
    console.log('  Total collateral:', userData.totalCollateralETH.toString());
    console.log('  Available borrows:', userData.availableBorrowsETH.toString());

    expect(userData.totalCollateralETH).to.be.gt(0, 'Should have collateral');
  });

  it('Reverts when trying to deposit 0 amount', async () => {
    const { usdc, pool, users } = testEnv;
    const depositor = users[1];

    await expect(
      pool.connect(depositor.signer).deposit(usdc.address, 0, depositor.address, 0)
    ).to.be.revertedWith(VL_INVALID_AMOUNT);
  });

  it('Reverts when trying to deposit to invalid reserve', async () => {
    const { pool, users } = testEnv;
    const depositor = users[1];

    await expect(
      pool.connect(depositor.signer).deposit(ZERO_ADDRESS, 100, depositor.address, 0)
    ).to.be.reverted;
  });

  // Basic Borrow Tests

  it('User borrows 100 AGT using USDC as collateral', async () => {
    const { agt, pool, users } = testEnv;
    const lender = users[0];
    const borrower  = users[1];

    // Lender deposits AGT to provide liquidity
    const agtDepositAmount = parseEther('1000');
    await mintTokens(agt, lender.address, agtDepositAmount, lender.signer);
    await agt.connect(lender.signer).approve(pool.address, MAX_UINT_AMOUNT);
    await waitForTx(
      await pool.connect(lender.signer).deposit(agt.address, agtDepositAmount, lender.address, 0)
    );

    // Borrower borrows AGT using USDC collateral from previous test
    const borrowAmount = parseEther('100');
    try {
      await pool.connect(borrower.signer).callStatic.borrow(
        agt.address, borrowAmount, RateMode.Variable, 0, borrower.address
      );
      console.log("callStatic.borrow OK");
    } catch (e:any) {
      console.log("callStatic.borrow REVERT:",
        e?.error?.message ?? e?.reason ?? e?.message
      );
      throw e;
    }

    await waitForTx(
      await pool
        .connect(borrower.signer)
        .borrow(agt.address, borrowAmount, RateMode.Variable, 0, borrower.address)
    );

    const agtBalance = await agt.balanceOf(borrower.address);
    expect(agtBalance).to.be.equal(borrowAmount, 'Should have borrowed AGT');

    const userData = await pool.getUserAccountData(borrower.address);
    expect(userData.totalDebtETH).to.be.gt(0, 'Should have debt');
  });

  it('Reverts when trying to borrow 0 amount', async () => {
    const { agt, pool, users } = testEnv;
    const borrower = users[1];

    await expect(
      pool.connect(borrower.signer).borrow(agt.address, 0, RateMode.Variable, 0, borrower.address)
    ).to.be.revertedWith(VL_INVALID_AMOUNT);
  });

  it('Reverts when trying to borrow without collateral', async () => {
    const { agt, pool, users } = testEnv;
    const userWithoutCollateral = users[5];

    const borrowAmount = parseEther('10');

    await expect(
      pool
        .connect(userWithoutCollateral.signer)
        .borrow(agt.address, borrowAmount, RateMode.Variable, 0, userWithoutCollateral.address)
    ).to.be.revertedWith(VL_COLLATERAL_BALANCE_IS_0);
  });

  // Repay Tests

  it('User repays half of AGT debt', async () => {
    const { agt, pool, users, helpersContract } = testEnv;
    const borrower = users[1];

    const userDataBefore = await helpersContract.getUserReserveData(agt.address, borrower.address);
    const debtBefore = userDataBefore.currentVariableDebt;

    const repayAmount = parseEther('50');

    await agt.connect(borrower.signer).approve(pool.address, MAX_UINT_AMOUNT);
    try {
       await pool
        .connect(borrower.signer)
        .callStatic.repay(agt.address, repayAmount, RateMode.Variable, borrower.address)
      console.log("callStatic.repay OK");
    } catch (e:any) {
      console.log("callStatic.repay REVERT:",
        e?.error?.message ?? e?.reason ?? e?.message
      );
      throw e;
    }

    await waitForTx(
      await pool
        .connect(borrower.signer)
        .repay(agt.address, repayAmount, RateMode.Variable, borrower.address)
    );

    const userDataAfter = await helpersContract.getUserReserveData(agt.address, borrower.address);
    const debtAfter = userDataAfter.currentVariableDebt;

    // console.log('Debt before repay:', debtBefore.toString());
    // console.log('Debt after repay:', debtAfter.toString());

    expect(debtAfter).to.be.lt(debtBefore, 'Debt should decrease after repay');
  });

  it('User repays full debt using MAX_UINT_AMOUNT', async () => {
    const { agt, pool, users, helpersContract } = testEnv;
    const borrower = users[1];

    // Mint more AGT to cover interest
    await mintTokens(agt, borrower.address, parseEther('100'), borrower.signer);
    await agt.connect(borrower.signer).approve(pool.address, MAX_UINT_AMOUNT);

    await waitForTx(
      await pool
        .connect(borrower.signer)
        .repay(agt.address, MAX_UINT_AMOUNT, RateMode.Variable, borrower.address)
    );

    const userDataAfter = await helpersContract.getUserReserveData(agt.address, borrower.address);

    expect(userDataAfter.currentVariableDebt).to.be.eq(0, 'Debt should be fully repaid');
  });


  // Withdraw Tests
  it('User withdraws partial deposit', async () => {
    const { usdc, aUSDC, pool, users } = testEnv;
    const user = users[4];

    // First deposit
    const depositAmount = parseUnits('1000', 6);
    await mintTokens(usdc, user.address, depositAmount, user.signer);
    await usdc.connect(user.signer).approve(pool.address, MAX_UINT_AMOUNT);
    await waitForTx(
      await pool.connect(user.signer).deposit(usdc.address, depositAmount, user.address, 0)
    );

    const aTokenBalanceBefore = await aUSDC.balanceOf(user.address);

    // Withdraw half
    const withdrawAmount = parseUnits('500', 6);
    try {
      await pool.connect(user.signer).callStatic.withdraw(usdc.address, withdrawAmount, user.address)
      console.log("callStatic.withdraw OK");
    } catch (e:any) {
      console.log("callStatic.withdraw REVERT:",
        e?.error?.message ?? e?.reason ?? e?.message
      );
      throw e;
    }

    await waitForTx(
      await pool.connect(user.signer).withdraw(usdc.address, withdrawAmount, user.address)
    );

    const aTokenBalanceAfter = await aUSDC.balanceOf(user.address);
    const usdcBalance = await usdc.balanceOf(user.address);

    expect(aTokenBalanceAfter).to.be.lt(aTokenBalanceBefore, 'aToken balance should decrease');
    expect(usdcBalance).to.be.eq(withdrawAmount, 'Should receive withdrawn USDC');
  });

  it('User withdraws full deposit using MAX_UINT_AMOUNT', async () => {
    const { usdc, aUSDC, pool, users } = testEnv;
    const user = users[4];

    const aTokenBalanceBefore = await aUSDC.balanceOf(user.address);
    expect(aTokenBalanceBefore).to.be.gt(0, 'Should have aTokens to withdraw');

    await waitForTx(
      await pool.connect(user.signer).withdraw(usdc.address, MAX_UINT_AMOUNT, user.address)
    );

    const aTokenBalanceAfter = await aUSDC.balanceOf(user.address);

    expect(aTokenBalanceAfter).to.be.eq(0, 'Should have no aTokens after full withdrawal');
  });

  it('Reverts when trying to withdraw more than balance', async () => {
    const { usdc, pool, users } = testEnv;
    const userWithNoDeposit = users[6];

    await expect(
      pool.connect(userWithNoDeposit.signer).withdraw(usdc.address, 1000, userWithNoDeposit.address)
    ).to.be.revertedWith(VL_NOT_ENOUGH_AVAILABLE_USER_BALANCE);
  });

  // Health Factor Tests

  it('Reverts when borrow would make health factor too low', async () => {
    const { agt, usdc, pool, users } = testEnv;
    const user = users[2];

    // Small deposit
    const depositAmount = parseUnits('100', 6);
    await mintTokens(usdc, user.address, depositAmount, user.signer);
    await usdc.connect(user.signer).approve(pool.address, MAX_UINT_AMOUNT);

    try {
      await pool.connect(user.signer).callStatic.deposit(usdc.address, depositAmount, user.address, 0)
      console.log("callStatic.deposit OK");
    } catch (e:any) {
      console.log("callStatic.deposit REVERT:",
        e?.error?.message ?? e?.reason ?? e?.message
      );
      throw e;
    }

    await waitForTx(
      await pool.connect(user.signer).deposit(usdc.address, depositAmount, user.address, 0)
    );

    // Try to borrow too much
    const excessiveBorrowAmount = parseEther('10000');

    await expect(
      pool
        .connect(user.signer)
        .borrow(agt.address, excessiveBorrowAmount, RateMode.Variable, 0, user.address)
    ).to.be.revertedWith(VL_COLLATERAL_CANNOT_COVER_NEW_BORROW);
  });

  // Multiple Asset Tests
  it('User can have multiple collateral types', async () => {
    const { agt, usdc, pool, users } = testEnv;
    const user = users[3];

    // Deposit USDC
    const usdcAmount = parseUnits('500', 6);
    await mintTokens(usdc, user.address, usdcAmount, user.signer);
    await usdc.connect(user.signer).approve(pool.address, MAX_UINT_AMOUNT);

    try {
      await pool.connect(user.signer).callStatic.deposit(usdc.address, usdcAmount, user.address, 0)
      console.log("callStatic.deposit OK");
    } catch (e:any) {
      console.log("callStatic.deposit REVERT:",
        e?.error?.message ?? e?.reason ?? e?.message
      );
      throw e;
    }

    await waitForTx(
      await pool.connect(user.signer).deposit(usdc.address, usdcAmount, user.address, 0)
    );

    // Deposit AGT
    const agtAmount = parseEther('100');
    await mintTokens(agt, user.address, agtAmount, user.signer);
    await agt.connect(user.signer).approve(pool.address, MAX_UINT_AMOUNT);

    try {
      await pool.connect(user.signer).callStatic.deposit(agt.address, agtAmount, user.address, 0)
      console.log("callStatic.deposit OK");
    } catch (e:any) {
      console.log("callStatic.deposit REVERT:",
        e?.error?.message ?? e?.reason ?? e?.message
      );
      throw e;
    }

    await waitForTx(
      await pool.connect(user.signer).deposit(agt.address, agtAmount, user.address, 0)
    );

    const userData = await pool.getUserAccountData(user.address);

    console.log('User with multiple collaterals:');
    console.log('  Total collateral ETH:', userData.totalCollateralETH.toString());
    console.log('  Available borrows ETH:', userData.availableBorrowsETH.toString());

    expect(userData.totalCollateralETH).to.be.gt(0, 'Should have collateral from both assets');
  });
});
