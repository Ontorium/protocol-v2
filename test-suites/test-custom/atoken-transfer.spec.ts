import { APPROVAL_AMOUNT_LENDING_POOL, MAX_UINT_AMOUNT, ZERO_ADDRESS } from '../../helpers/constants';
import { convertToCurrencyDecimals } from '../../helpers/contracts-helpers';
import { expect } from 'chai';
import { ethers } from 'ethers';
import { RateMode, ProtocolErrors } from '../../helpers/types';
import { makeSuite, TestEnv } from './helpers/make-suite';
import { CommonsConfig } from '../../markets/custom/commons';

const AAVE_REFERRAL = CommonsConfig.ProtocolGlobalParams.AaveReferral;

makeSuite('AToken: Transfer', (testEnv: TestEnv) => {
  const {
    INVALID_FROM_BALANCE_AFTER_TRANSFER,
    INVALID_TO_BALANCE_AFTER_TRANSFER,
    VL_TRANSFER_NOT_ALLOWED,
  } = ProtocolErrors;

  it('User 0 deposits 1000 USDC, transfers to user 1', async () => {
    const { users, pool, usdc, aUSDC } = testEnv;

    await usdc.connect(users[0].signer).mint(await convertToCurrencyDecimals(usdc.address, '1000'));

    await usdc.connect(users[0].signer).approve(pool.address, APPROVAL_AMOUNT_LENDING_POOL);

    //user 0 deposits 1000 USDC
    const amountUSDCtoDeposit = await convertToCurrencyDecimals(usdc.address, '1000');

    await pool
      .connect(users[0].signer)
      .deposit(usdc.address, amountUSDCtoDeposit, users[0].address, '0');

    await aUSDC.connect(users[0].signer).transfer(users[1].address, amountUSDCtoDeposit);

    const name = await aUSDC.name();

    expect(name).to.be.equal('Aave interest bearing USDC');

    const fromBalance = await aUSDC.balanceOf(users[0].address);
    const toBalance = await aUSDC.balanceOf(users[1].address);

    expect(fromBalance.toString()).to.be.equal('0', INVALID_FROM_BALANCE_AFTER_TRANSFER);
    expect(toBalance.toString()).to.be.equal(
      amountUSDCtoDeposit.toString(),
      INVALID_TO_BALANCE_AFTER_TRANSFER
    );
  });

  it('User 0 deposits 100 AGT and user 1 tries to borrow AGT with the received USDC as collateral', async () => {
    const { users, pool, agt, helpersContract } = testEnv;
    const userAddress = await pool.signer.getAddress();

    await agt.connect(users[0].signer).mint(await convertToCurrencyDecimals(agt.address, '100'));

    await agt.connect(users[0].signer).approve(pool.address, APPROVAL_AMOUNT_LENDING_POOL);

    await pool
      .connect(users[0].signer)
      .deposit(agt.address, ethers.utils.parseEther('100'), userAddress, '0');

    // Borrow 50 AGT with 1000 USDC as collateral (same price, 75% LTV = 750 max borrow)
    await pool
      .connect(users[1].signer)
      .borrow(
        agt.address,
        ethers.utils.parseEther('50'),
        RateMode.Variable,
        AAVE_REFERRAL,
        users[1].address
      );

    const userReserveData = await helpersContract.getUserReserveData(
      agt.address,
      users[1].address
    );

    expect(userReserveData.currentVariableDebt.toString()).to.be.eq(ethers.utils.parseEther('50'));
  });

  it('User 1 tries to transfer all the USDC used as collateral back to user 0 (revert expected)', async () => {
    const { users, pool, aUSDC, usdc, agt } = testEnv;

    const aUSDCtoTransfer = await convertToCurrencyDecimals(usdc.address, '1000');

    await expect(
      aUSDC.connect(users[1].signer).transfer(users[0].address, aUSDCtoTransfer),
      VL_TRANSFER_NOT_ALLOWED
    ).to.be.revertedWith(VL_TRANSFER_NOT_ALLOWED);
  });

  it('User 1 tries to transfer a small amount of USDC used as collateral back to user 0', async () => {
    const { users, pool, aUSDC, usdc, agt } = testEnv;

    const aUSDCtoTransfer = await convertToCurrencyDecimals(usdc.address, '100');

    await aUSDC.connect(users[1].signer).transfer(users[0].address, aUSDCtoTransfer);

    const user0Balance = await aUSDC.balanceOf(users[0].address);

    expect(user0Balance.toString()).to.be.eq(aUSDCtoTransfer.toString());
  });
});
