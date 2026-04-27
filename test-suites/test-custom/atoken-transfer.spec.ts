import { convertToCurrencyDecimals } from '../../helpers/contracts-helpers';
import { expect } from 'chai';
import { BigNumber, ethers } from 'ethers';
import { DRE, waitForTx } from '../../helpers/misc-utils';
import { RateMode, ProtocolErrors } from '../../helpers/types';
import { makeSuite, TestEnv } from './helpers/make-suite';
import { CommonsConfig } from '../../markets/custom/commons';
import { mintTokens } from './helpers/mint-tokens';

const AAVE_REFERRAL = CommonsConfig.ProtocolGlobalParams.AaveReferral;

async function ensureApproval(
  token: any,
  ownerSigner: any,
  spender: string,
  amount: BigNumber
) {
  const owner = await ownerSigner.getAddress();
  const allowance = await token.allowance(owner, spender);
  if (allowance.gte(amount)) return;

  // Important: some tokens require setting allowance to 0 before updating
  if (!allowance.isZero()) {
    await waitForTx(await token.connect(ownerSigner).approve(spender, 0));
  }
  await waitForTx(await token.connect(ownerSigner).approve(spender, amount));
}

async function ensureFunds(
  testEnv: TestEnv,
  token: any,
  recipient: string,
  recipientSigner: any,
  amount: BigNumber
) {
  const bal = await token.balanceOf(recipient);
  if (bal.gte(amount)) return;

  const missing = amount.sub(bal);
  // 1) Try mint first (works in local, and for mintable tokens even on fork)
  try {
    await mintTokens(token, recipient, missing, recipientSigner);
    return;
  } catch (_) {
    // ignore and fallback
  }

  // 2) Fallback: transfer from deployer (works when anvil is started with your MNEMONIC)
  if (!testEnv.deployer?.signer) throw new Error('MISSING_DEPLOYER_SIGNER');

  const funderSigner = testEnv.deployer.signer;
  const funderAddr = await funderSigner.getAddress();
  const funderBal = await token.balanceOf(funderAddr);
  if (funderBal.lt(missing)) {
    throw new Error(
      `INSUFFICIENT_TOKEN_IN_DEPLOYER funder=${funderAddr} bal=${funderBal.toString()} need=${missing.toString()}`
    );
  }

  await waitForTx(await token.connect(funderSigner).transfer(recipient, missing));
}

makeSuite('AToken: Transfer', (testEnv: TestEnv) => {
  const {
    INVALID_FROM_BALANCE_AFTER_TRANSFER,
    INVALID_TO_BALANCE_AFTER_TRANSFER,
    VL_TRANSFER_NOT_ALLOWED,
  } = ProtocolErrors;

  let depositedAmount: BigNumber;

  it('User 0 deposits 1000 USDC, transfers to user 1', async () => {
    const { users, pool, usdc, aUSDC } = testEnv;

    const user0BalanceBefore = await aUSDC.balanceOf(users[0].address);
    const user1BalanceBefore = await aUSDC.balanceOf(users[1].address);

    depositedAmount = await convertToCurrencyDecimals(usdc.address, '1000');

    // Ensure underlying tokens exist for user0 (mint in local / transfer from deployer in fork)
    await ensureFunds(testEnv, usdc, users[0].address, users[0].signer, depositedAmount);
    // Approve exactly what we need (safe for fork + local)
    await ensureApproval(usdc, users[0].signer, pool.address, depositedAmount);

    await waitForTx(
      await pool
        .connect(users[0].signer)
        .deposit(usdc.address, depositedAmount, users[0].address, '0')
    );

    const user0BalanceAfterDeposit = await aUSDC.balanceOf(users[0].address);
    expect(user0BalanceAfterDeposit.sub(user0BalanceBefore).toString()).to.be.equal(
      depositedAmount.toString(),
      'Deposit amount mismatch'
    );

    try {
      await aUSDC.connect(users[0].signer).callStatic.transfer(users[1].address, depositedAmount)
      console.log("callStatic.transfer OK");
    } catch (e:any) {
      console.log("callStatic.transfer REVERT:",
        e?.error?.message ?? e?.reason ?? e?.message
      );
      throw e;
    }


    await waitForTx(await aUSDC.connect(users[0].signer).transfer(users[1].address, depositedAmount));
    
    const name = await aUSDC.name();
    expect(name).to.be.equal('Aqua Arbitrum Market USDC');

    const fromBalanceAfter = await aUSDC.balanceOf(users[0].address);
    const toBalanceAfter = await aUSDC.balanceOf(users[1].address);

    expect(fromBalanceAfter.toString()).to.be.equal(
      user0BalanceBefore.toString(),
      INVALID_FROM_BALANCE_AFTER_TRANSFER
    );
    expect(toBalanceAfter.sub(user1BalanceBefore).toString()).to.be.equal(
      depositedAmount.toString(),
      INVALID_TO_BALANCE_AFTER_TRANSFER
    );
  });

  it('User 0 deposits 100 OXAU and user 1 borrows OXAU using received USDC as collateral', async () => {
    const { users, pool, oxau, usdc, helpersContract } = testEnv;

    const oxauToDeposit = await convertToCurrencyDecimals(oxau.address, '100');

    // Ensure OXAU liquidity exists (mint in local / transfer from deployer in fork)
    await ensureFunds(testEnv, oxau, users[0].address, users[0].signer, oxauToDeposit);

    await ensureApproval(oxau, users[0].signer, pool.address, oxauToDeposit);

    // Deposit OXAU to create liquidity for borrowing
    await waitForTx(
      await pool
        .connect(users[0].signer)
        .deposit(oxau.address, oxauToDeposit, users[0].address, '0')
    );

    // aTokens received by transfer are not automatically set as collateral
    await waitForTx(
      await pool.connect(users[1].signer).setUserUseReserveAsCollateral(usdc.address, true)
    );

    const userReserveDataBefore = await helpersContract.getUserReserveData(
      oxau.address,
      users[1].address
    );

    // 1000 USDC collateral at 65% LTV supports about 4.1 OXAU at the current 155 USD price.
    const borrowAmt = await convertToCurrencyDecimals(oxau.address, '4');

    await waitForTx(
      await pool
        .connect(users[1].signer)
        .borrow(oxau.address, borrowAmt, RateMode.Variable, AAVE_REFERRAL, users[1].address)
    );

    const userReserveDataAfter = await helpersContract.getUserReserveData(
      oxau.address,
      users[1].address
    );

    expect(
      userReserveDataAfter.currentVariableDebt.gt(userReserveDataBefore.currentVariableDebt)
    ).to.be.true;
  });

  it('User 1 tries to transfer all the USDC used as collateral back to user 0 (revert expected)', async () => {
    const { users, aUSDC } = testEnv;

    const user1Balance = await aUSDC.balanceOf(users[1].address);

    await expect(
      aUSDC.connect(users[1].signer).transfer(users[0].address, user1Balance)
    ).to.be.revertedWith(VL_TRANSFER_NOT_ALLOWED);
  });

  it('User 1 transfers a small amount of aUSDC back to user 0', async () => {
    const { users, aUSDC, usdc } = testEnv;

    const user0BalanceBefore = await aUSDC.balanceOf(users[0].address);
    const aUSDCtoTransfer = await convertToCurrencyDecimals(usdc.address, '100');

    await waitForTx(
      await aUSDC.connect(users[1].signer).transfer(users[0].address, aUSDCtoTransfer)
    );

    const user0BalanceAfter = await aUSDC.balanceOf(users[0].address);
    expect(user0BalanceAfter.sub(user0BalanceBefore).toString()).to.be.eq(aUSDCtoTransfer.toString());
  });
});
