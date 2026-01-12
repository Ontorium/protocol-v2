import { makeSuite, TestEnv } from './helpers/make-suite';
import { parseEther, parseUnits } from 'ethers/lib/utils';
import { MAX_UINT_AMOUNT } from '../../helpers/constants';

const { expect } = require('chai');

makeSuite('Custom Market - Deposit & Borrow', (testEnv: TestEnv) => {
  it('User deposits 1000 USDC', async () => {
    const { usdc, pool, users } = testEnv;
    const depositor = users[0];

    // Mint USDC (6 decimals)
    const mintAmount = parseUnits('1000', 6);
    await usdc.connect(depositor.signer).mint(mintAmount);

    // Approve
    await usdc.connect(depositor.signer).approve(pool.address, MAX_UINT_AMOUNT);

    // Deposit
    await pool
      .connect(depositor.signer)
      .deposit(usdc.address, mintAmount, depositor.address, 0);

    const userData = await pool.getUserAccountData(depositor.address);

    console.log('User account data after USDC deposit:');
    console.log('  Total collateral:', userData.totalCollateralETH.toString());
    console.log('  Available borrows:', userData.availableBorrowsETH.toString());

    expect(userData.totalCollateralETH).to.be.gt(0, 'Should have collateral');
  });

  it('User borrows 100 AGT using USDC as collateral', async () => {
    const { agt, usdc, pool, users } = testEnv;
    const borrower = users[0];
    const lender = users[1];

    // First, lender deposits AGT into the pool so there's liquidity to borrow
    const agtDepositAmount = parseEther('1000');
    await agt.connect(lender.signer).mint(agtDepositAmount);
    await agt.connect(lender.signer).approve(pool.address, MAX_UINT_AMOUNT);
    await pool.connect(lender.signer).deposit(agt.address, agtDepositAmount, lender.address, 0);

    // With 1000 USDC as collateral and same price, 75% LTV = 750 max borrow
    const borrowAmount = parseEther('100'); // AGT has 18 decimals

    // Borrow
    await pool
      .connect(borrower.signer)
      .borrow(agt.address, borrowAmount, 2, 0, borrower.address); // mode 2 = variable

    const agtBalance = await agt.balanceOf(borrower.address);

    console.log('AGT balance after borrow:', agtBalance.toString());

    expect(agtBalance).to.be.equal(borrowAmount, 'Should have borrowed AGT');

    const userData = await pool.getUserAccountData(borrower.address);
    console.log('User account data after borrow:');
    console.log('  Total debt:', userData.totalDebtETH.toString());
    console.log('  Health factor:', userData.healthFactor.toString());

    expect(userData.totalDebtETH).to.be.gt(0, 'Should have debt');
  });

  it('User repays half of AGT debt', async () => {
    const { agt, pool, users } = testEnv;
    const borrower = users[0];

    const repayAmount = parseEther('50');

    // Approve
    await agt.connect(borrower.signer).approve(pool.address, MAX_UINT_AMOUNT);

    // Repay
    await pool
      .connect(borrower.signer)
      .repay(agt.address, repayAmount, 2, borrower.address);

    const userData = await pool.getUserAccountData(borrower.address);

    console.log('User account data after repay:');
    console.log('  Total debt:', userData.totalDebtETH.toString());
    console.log('  Health factor:', userData.healthFactor.toString());
  });

  it('User deposits AGT and borrows USDT', async () => {
    const { agt, usdt, pool, users } = testEnv;
    const user = users[2];
    const lender = users[3];

    // First, lender deposits USDT into the pool so there's liquidity to borrow
    const usdtDepositAmount = parseUnits('10000', 6);
    await usdt.connect(lender.signer).mint(usdtDepositAmount);
    await usdt.connect(lender.signer).approve(pool.address, MAX_UINT_AMOUNT);
    await pool.connect(lender.signer).deposit(usdt.address, usdtDepositAmount, lender.address, 0);

    // Mint and deposit AGT
    const agtDepositAmount = parseEther('500');
    await agt.connect(user.signer).mint(agtDepositAmount);
    await agt.connect(user.signer).approve(pool.address, MAX_UINT_AMOUNT);
    await pool
      .connect(user.signer)
      .deposit(agt.address, agtDepositAmount, user.address, 0);

    console.log('User deposited 500 AGT');

    // Borrow USDT
    const usdtBorrowAmount = parseUnits('100', 6);
    await pool
      .connect(user.signer)
      .borrow(usdt.address, usdtBorrowAmount, 2, 0, user.address);

    const usdtBalance = await usdt.balanceOf(user.address);

    console.log('USDT balance after borrow:', usdtBalance.toString());

    expect(usdtBalance).to.be.equal(usdtBorrowAmount, 'Should have borrowed USDT');
  });
});
