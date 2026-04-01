import { makeSuite, TestEnv } from './helpers/make-suite';
import { parseEther, parseUnits } from 'ethers/lib/utils';
import { MAX_UINT_AMOUNT } from '../../helpers/constants';
import { mintTokens } from './helpers/mint-tokens';
import { ProtocolErrors, RateMode } from '../../helpers/types';
import { waitForTx } from '../../helpers/misc-utils';
import { getVariableDebtToken } from '../../helpers/contracts-getters';

const { expect } = require('chai');

makeSuite('Custom Market - Credit Delegation', (testEnv: TestEnv) => {
  const { LP_BORROW_ALLOWANCE_NOT_ENOUGH } = ProtocolErrors;

  it('Setup: Depositor provides AGT liquidity and delegator deposits USDC collateral', async () => {
    const { agt, usdc, pool, users } = testEnv;
    const depositor = users[0];
    const delegator = users[1];

    // Deposit AGT liquidity
    const agtAmount = parseEther('10000');
    await mintTokens(agt, depositor.address, agtAmount, depositor.signer);
    await agt.connect(depositor.signer).approve(pool.address, MAX_UINT_AMOUNT);
    await waitForTx(
      await pool.connect(depositor.signer).deposit(agt.address, agtAmount, depositor.address, 0)
    );

    // Delegator deposits USDC collateral
    const collateralAmount = parseUnits('5000', 6);
    await mintTokens(usdc, delegator.address, collateralAmount, delegator.signer);
    await usdc.connect(delegator.signer).approve(pool.address, MAX_UINT_AMOUNT);
    await waitForTx(
      await pool.connect(delegator.signer).deposit(usdc.address, collateralAmount, delegator.address, 0)
    );

    // Verify delegator has collateral
    const userData = await pool.getUserAccountData(delegator.address);
    console.log('Delegator collateral ETH:', userData.totalCollateralETH.toString());
    console.log('Delegator available borrows ETH:', userData.availableBorrowsETH.toString());
    expect(userData.totalCollateralETH).to.be.gt(0);
    expect(userData.availableBorrowsETH).to.be.gt(0);
  });

  it('Borrower without delegation cannot borrow on behalf of delegator (revert expected)', async () => {
    const { agt, pool, users } = testEnv;
    const delegator = users[1];
    const borrower = users[2];

    const borrowAmount = parseEther('100');

    await expect(
      pool
        .connect(borrower.signer)
        .borrow(agt.address, borrowAmount, RateMode.Variable, 0, delegator.address)
    ).to.be.revertedWith(LP_BORROW_ALLOWANCE_NOT_ENOUGH);
  });

  it('Delegator approves credit delegation to borrower', async () => {
    const { agt, users, helpersContract } = testEnv;
    const delegator = users[1];
    const borrower = users[2];

    const { variableDebtTokenAddress } = await helpersContract.getReserveTokensAddresses(
      agt.address
    );
    const variableDebtToken = await getVariableDebtToken(variableDebtTokenAddress);

    const delegationAmount = parseEther('500');

    await waitForTx(
      await variableDebtToken
        .connect(delegator.signer)
        .approveDelegation(borrower.address, delegationAmount)
    );

    const borrowAllowance = await variableDebtToken.borrowAllowance(
      delegator.address,
      borrower.address
    );

    expect(borrowAllowance).to.be.eq(delegationAmount);
  });

  it('Borrower can borrow on behalf of delegator after delegation', async () => {
    const { agt, pool, users, helpersContract } = testEnv;
    const delegator = users[1];
    const borrower = users[2];

    const borrowAmount = parseEther('100');

    const borrowerAGTBefore = await agt.balanceOf(borrower.address);

    await waitForTx(
      await pool
        .connect(borrower.signer)
        .borrow(agt.address, borrowAmount, RateMode.Variable, 0, delegator.address)
    );

    const borrowerAGTAfter = await agt.balanceOf(borrower.address);

    // Borrower receives the funds
    expect(borrowerAGTAfter.sub(borrowerAGTBefore)).to.be.eq(borrowAmount);

    // Delegator has the debt
    const delegatorDebt = await helpersContract.getUserReserveData(agt.address, delegator.address);
    expect(delegatorDebt.currentVariableDebt).to.be.gte(borrowAmount);

    // Borrower should have no debt
    const borrowerDebt = await helpersContract.getUserReserveData(agt.address, borrower.address);
    expect(borrowerDebt.currentVariableDebt).to.be.eq(0);
  });

  it('Delegation allowance decreases after borrow', async () => {
    const { agt, users, helpersContract } = testEnv;
    const delegator = users[1];
    const borrower = users[2];

    const { variableDebtTokenAddress } = await helpersContract.getReserveTokensAddresses(
      agt.address
    );
    const variableDebtToken = await getVariableDebtToken(variableDebtTokenAddress);

    const borrowAllowance = await variableDebtToken.borrowAllowance(
      delegator.address,
      borrower.address
    );

    // Initial delegation was 500, borrowed 100, so 400 should remain
    expect(borrowAllowance).to.be.eq(parseEther('400'));
  });

  it('Borrower cannot borrow more than remaining allowance (revert expected)', async () => {
    const { agt, pool, users } = testEnv;
    const delegator = users[1];
    const borrower = users[2];

    const excessiveBorrowAmount = parseEther('500'); // More than 400 remaining

    await expect(
      pool
        .connect(borrower.signer)
        .borrow(agt.address, excessiveBorrowAmount, RateMode.Variable, 0, delegator.address)
    ).to.be.revertedWith(LP_BORROW_ALLOWANCE_NOT_ENOUGH);
  });

  it('Delegator can increase delegation', async () => {
    const { agt, users, helpersContract } = testEnv;
    const delegator = users[1];
    const borrower = users[2];

    const { variableDebtTokenAddress } = await helpersContract.getReserveTokensAddresses(
      agt.address
    );
    const variableDebtToken = await getVariableDebtToken(variableDebtTokenAddress);

    const newDelegationAmount = parseEther('1000');

    await waitForTx(
      await variableDebtToken
        .connect(delegator.signer)
        .approveDelegation(borrower.address, newDelegationAmount)
    );

    const borrowAllowance = await variableDebtToken.borrowAllowance(
      delegator.address,
      borrower.address
    );

    expect(borrowAllowance).to.be.eq(newDelegationAmount);
  });

  it('Delegator can revoke delegation by setting allowance to 0', async () => {
    const { agt, pool, users, helpersContract } = testEnv;
    const delegator = users[1];
    const borrower = users[2];

    const { variableDebtTokenAddress } = await helpersContract.getReserveTokensAddresses(
      agt.address
    );
    const variableDebtToken = await getVariableDebtToken(variableDebtTokenAddress);

    // Revoke delegation
    await waitForTx(
      await variableDebtToken.connect(delegator.signer).approveDelegation(borrower.address, 0)
    );

    const borrowAllowance = await variableDebtToken.borrowAllowance(
      delegator.address,
      borrower.address
    );

    expect(borrowAllowance).to.be.eq(0);

    // Borrower can no longer borrow on behalf of delegator
    await expect(
      pool
        .connect(borrower.signer)
        .borrow(agt.address, parseEther('10'), RateMode.Variable, 0, delegator.address)
    ).to.be.revertedWith(LP_BORROW_ALLOWANCE_NOT_ENOUGH);
  });

  it('Third party can repay delegators debt', async () => {
    const { agt, pool, users, helpersContract } = testEnv;
    // delegator (users[1]) already has debt from previous test (100 AGT borrowed)
    const delegator = users[1];
    const repayer = users[0]; // Use depositor who already has AGT

    const debtBefore = await helpersContract.getUserReserveData(agt.address, delegator.address);
    console.log('Delegator debt before repay:', debtBefore.currentVariableDebt.toString());

    // Repayer mints AGT and repays delegator's debt
    const repayAmount = parseEther('50');
    await mintTokens(agt, repayer.address, repayAmount, repayer.signer);
    await agt.connect(repayer.signer).approve(pool.address, MAX_UINT_AMOUNT);

    await waitForTx(
      await pool
        .connect(repayer.signer)
        .repay(agt.address, repayAmount, RateMode.Variable, delegator.address)
    );

    const debtAfter = await helpersContract.getUserReserveData(agt.address, delegator.address);
    console.log('Delegator debt after repay:', debtAfter.currentVariableDebt.toString());

    expect(debtAfter.currentVariableDebt).to.be.lt(debtBefore.currentVariableDebt);
  });
});
