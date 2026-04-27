import { makeSuite, TestEnv } from './helpers/make-suite';
import { parseEther, parseUnits } from 'ethers/lib/utils';
import { MAX_UINT_AMOUNT, RAY } from '../../helpers/constants';
import { mintTokens } from './helpers/mint-tokens';
import { RateMode } from '../../helpers/types';
import { waitForTx, increaseTime } from '../../helpers/misc-utils';

const { expect } = require('chai');

makeSuite('Custom Market - Borrow/Repay Interest Accrual', (testEnv: TestEnv) => {
  const ONE_YEAR = 31536000; // seconds in a year

  it('Setup: Depositor provides OXAU liquidity', async () => {
    const { oxau, pool, users } = testEnv;
    const depositor = users[0];

    const depositAmount = parseEther('50000'); // Large liquidity pool
    await mintTokens(oxau, depositor.address, depositAmount, depositor.signer);
    await oxau.connect(depositor.signer).approve(pool.address, MAX_UINT_AMOUNT);

    await waitForTx(
      await pool.connect(depositor.signer).deposit(oxau.address, depositAmount, depositor.address, 0)
    );

    const reserveData = await testEnv.helpersContract.getReserveData(oxau.address);
    console.log('OXAU liquidity available:', reserveData.availableLiquidity.toString());
    expect(reserveData.availableLiquidity).to.be.gte(depositAmount);
  });

  it('Borrower deposits USDC collateral', async () => {
    const { usdc, pool, users } = testEnv;
    const borrower = users[1];

    // Deposit large collateral
    const collateralAmount = parseUnits('10000', 6); // 10,000 USDC
    await mintTokens(usdc, borrower.address, collateralAmount, borrower.signer);
    await usdc.connect(borrower.signer).approve(pool.address, MAX_UINT_AMOUNT);
    await waitForTx(
      await pool.connect(borrower.signer).deposit(usdc.address, collateralAmount, borrower.address, 0)
    );

    // Check user account data
    const userData = await pool.getUserAccountData(borrower.address);
    console.log('Collateral ETH:', userData.totalCollateralETH.toString());
    console.log('Available borrows ETH:', userData.availableBorrowsETH.toString());
    console.log('LTV:', userData.ltv.toString());

    expect(userData.totalCollateralETH).to.be.gt(0);
    expect(userData.availableBorrowsETH).to.be.gt(0);
  });

  it('Borrower borrows OXAU', async () => {
    const { oxau, pool, users, helpersContract } = testEnv;
    const borrower = users[1];

    // 10,000 USDC collateral at 65% LTV supports about 41 OXAU at 155 USD.
    const borrowAmount = parseEther('40');
    await waitForTx(
      await pool
        .connect(borrower.signer)
        .borrow(oxau.address, borrowAmount, RateMode.Variable, 0, borrower.address)
    );

    const userReserveData = await helpersContract.getUserReserveData(oxau.address, borrower.address);
    console.log('Variable debt after borrow:', userReserveData.currentVariableDebt.toString());
    expect(userReserveData.currentVariableDebt).to.be.gte(borrowAmount);
  });

  it('Variable debt increases over time due to interest', async () => {
    const { oxau, users, helpersContract } = testEnv;
    const borrower = users[1];

    const debtBefore = await helpersContract.getUserReserveData(oxau.address, borrower.address);
    const debtBeforeAmount = debtBefore.currentVariableDebt;
    console.log('Debt before time advance:', debtBeforeAmount.toString());

    // Advance time by 1 year
    await increaseTime(ONE_YEAR);

    // After time advance, debt should increase when we query it
    // Note: getUserReserveData calculates the current debt with accrued interest
    const debtAfter = await helpersContract.getUserReserveData(oxau.address, borrower.address);
    const debtAfterAmount = debtAfter.currentVariableDebt;
    console.log('Debt after 1 year:', debtAfterAmount.toString());

    // Debt should have increased due to interest
    expect(debtAfterAmount).to.be.gt(debtBeforeAmount);
  });

  it('Partial repay reduces debt correctly', async () => {
    const { oxau, pool, users, helpersContract } = testEnv;
    const borrower = users[1];

    const debtBefore = await helpersContract.getUserReserveData(oxau.address, borrower.address);
    console.log('Debt before partial repay:', debtBefore.currentVariableDebt.toString());

    const repayAmount = parseEther('10');

    // Mint OXAU to cover repayment
    await mintTokens(oxau, borrower.address, repayAmount, borrower.signer);
    await oxau.connect(borrower.signer).approve(pool.address, MAX_UINT_AMOUNT);

    await waitForTx(
      await pool
        .connect(borrower.signer)
        .repay(oxau.address, repayAmount, RateMode.Variable, borrower.address)
    );

    const debtAfter = await helpersContract.getUserReserveData(oxau.address, borrower.address);
    console.log('Debt after partial repay:', debtAfter.currentVariableDebt.toString());

    // Debt should decrease
    expect(debtAfter.currentVariableDebt).to.be.lt(debtBefore.currentVariableDebt);
  });

  it('Full repay with MAX_UINT clears all debt including accrued interest', async () => {
    const { oxau, pool, users, helpersContract } = testEnv;
    const borrower = users[1];

    const debtBefore = await helpersContract.getUserReserveData(oxau.address, borrower.address);
    console.log('Debt before full repay:', debtBefore.currentVariableDebt.toString());

    // Mint enough OXAU to cover all debt + interest
    await mintTokens(oxau, borrower.address, parseEther('50'), borrower.signer);
    await oxau.connect(borrower.signer).approve(pool.address, MAX_UINT_AMOUNT);

    await waitForTx(
      await pool
        .connect(borrower.signer)
        .repay(oxau.address, MAX_UINT_AMOUNT, RateMode.Variable, borrower.address)
    );

    const debtAfter = await helpersContract.getUserReserveData(oxau.address, borrower.address);
    console.log('Debt after full repay:', debtAfter.currentVariableDebt.toString());

    expect(debtAfter.currentVariableDebt).to.be.eq(0);
  });

  it('Depositor earns interest from borrowers', async () => {
    const { oxau, aOXAU, pool, users } = testEnv;
    // Use users[1] who already has USDC collateral deposited
    const borrower = users[1];

    // First check the initial aToken balance of depositor (users[0])
    const depositor = users[0];
    const aTokenBalanceBefore = await aOXAU.balanceOf(depositor.address);
    console.log('aToken balance before:', aTokenBalanceBefore.toString());

    // Borrower borrows OXAU (users[1] already has 10,000 USDC collateral)
    const borrowAmount = parseEther('20');
    await waitForTx(
      await pool
        .connect(borrower.signer)
        .borrow(oxau.address, borrowAmount, RateMode.Variable, 0, borrower.address)
    );

    // Advance time
    await increaseTime(ONE_YEAR);

    // Trigger interest update by doing a small repay
    await mintTokens(oxau, borrower.address, parseEther('20'), borrower.signer);
    await oxau.connect(borrower.signer).approve(pool.address, MAX_UINT_AMOUNT);
    await waitForTx(
      await pool.connect(borrower.signer).repay(oxau.address, parseEther('2'), RateMode.Variable, borrower.address)
    );

    const aTokenBalanceAfter = await aOXAU.balanceOf(depositor.address);
    console.log('aToken balance after:', aTokenBalanceAfter.toString());

    // aToken balance should increase due to earned interest
    expect(aTokenBalanceAfter).to.be.gt(aTokenBalanceBefore);
  });

  it('Reserve liquidity index increases over time with borrows', async () => {
    const { oxau, pool, users, helpersContract } = testEnv;
    // Use users[1] who already has collateral and debt
    const borrower = users[1];

    // Check current state
    const reserveDataBefore = await helpersContract.getReserveData(oxau.address);
    const indexBefore = reserveDataBefore.liquidityIndex;
    console.log('Liquidity index before:', indexBefore.toString());
    console.log('Available liquidity:', reserveDataBefore.availableLiquidity.toString());

    // Advance time (shorter period)
    await increaseTime(ONE_YEAR / 12); // 1 month

    // Trigger index update by doing a small repay
    await mintTokens(oxau, borrower.address, parseEther('5'), borrower.signer);
    await oxau.connect(borrower.signer).approve(pool.address, MAX_UINT_AMOUNT);
    await waitForTx(
      await pool.connect(borrower.signer).repay(oxau.address, parseEther('1'), RateMode.Variable, borrower.address)
    );

    const reserveDataAfter = await helpersContract.getReserveData(oxau.address);
    const indexAfter = reserveDataAfter.liquidityIndex;
    console.log('Liquidity index after:', indexAfter.toString());

    expect(indexAfter).to.be.gt(indexBefore);
  });

  it('Variable borrow index is at least RAY', async () => {
    const { oxau, helpersContract } = testEnv;

    const reserveData = await helpersContract.getReserveData(oxau.address);

    console.log('Variable borrow rate:', reserveData.variableBorrowRate.toString());
    console.log('Variable borrow index:', reserveData.variableBorrowIndex.toString());

    // Variable borrow index should be >= RAY (1e27) as it starts at RAY
    expect(reserveData.variableBorrowIndex).to.be.gte(RAY);
  });
});
