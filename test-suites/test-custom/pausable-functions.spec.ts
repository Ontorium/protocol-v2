import { makeSuite, TestEnv } from './helpers/make-suite';
import { ProtocolErrors, RateMode } from '../../helpers/types';
import { APPROVAL_AMOUNT_LENDING_POOL, oneEther } from '../../helpers/constants';
import { convertToCurrencyDecimals } from '../../helpers/contracts-helpers';
import { parseEther, parseUnits } from 'ethers/lib/utils';
import { BigNumber } from 'bignumber.js';
import { MockFlashLoanReceiver } from '../../types/MockFlashLoanReceiver';
import { getMockFlashLoanReceiver } from '../../helpers/contracts-getters';
import { mintTokens, getEmergencyAdminSigner, stopImpersonatingEmergencyAdmin, setAggregatorPrice } from './helpers/mint-tokens';
import { DRE, waitForTx } from '../../helpers/misc-utils';

const { expect } = require('chai');

makeSuite('Pausable Pool', (testEnv: TestEnv) => {
  let _mockFlashLoanReceiver: MockFlashLoanReceiver | null = null;

  const {
    LP_IS_PAUSED,
    INVALID_FROM_BALANCE_AFTER_TRANSFER,
    INVALID_TO_BALANCE_AFTER_TRANSFER,
  } = ProtocolErrors;

  before(async () => {
    if (process.env.USE_DEPLOYED) {
      const { addressesProvider } = testEnv;
      // @ts-ignore - DRE.ethers exists at runtime via hardhat-ethers plugin
      const factory = await DRE.ethers.getContractFactory('MockFlashLoanPrivateReceiver');
      const deployed = await factory.deploy(addressesProvider.address);
      await deployed.deployed();
      _mockFlashLoanReceiver = deployed as unknown as MockFlashLoanReceiver;
      console.log('MockFlashLoanPrivateReceiver deployed at:', deployed.address);
    } else {
      _mockFlashLoanReceiver = await getMockFlashLoanReceiver();
    }
  });

  it('User 0 deposits 1000 USDC. Configurator pauses pool. Transfers to user 1 reverts. Configurator unpauses the network and next transfer succeeds', async () => {
    const { users, pool, usdc, aUSDC, configurator, addressesProvider } = testEnv;

    const amountUSDCtoDeposit = await convertToCurrencyDecimals(usdc.address, '1000');

    await mintTokens(usdc, users[0].address, amountUSDCtoDeposit, users[0].signer);

    // user 0 deposits 1000 USDC
    await usdc.connect(users[0].signer).approve(pool.address, APPROVAL_AMOUNT_LENDING_POOL);
    await pool
      .connect(users[0].signer)
      .deposit(usdc.address, amountUSDCtoDeposit, users[0].address, '0');

    const user0Balance = await aUSDC.balanceOf(users[0].address);
    const user1Balance = await aUSDC.balanceOf(users[1].address);

    // Configurator pauses the pool (admin only)
    const adminSigner = await getEmergencyAdminSigner(addressesProvider);
    await configurator.connect(adminSigner).setPoolPause(true)
    
    // User 0 tries the transfer to User 1
    await expect(
      aUSDC.connect(users[0].signer).transfer(users[1].address, amountUSDCtoDeposit)
    ).to.revertedWith(LP_IS_PAUSED);

    const pausedFromBalance = await aUSDC.balanceOf(users[0].address);
    const pausedToBalance = await aUSDC.balanceOf(users[1].address);

    expect(pausedFromBalance).to.be.equal(
      user0Balance.toString(),
      INVALID_TO_BALANCE_AFTER_TRANSFER
    );
    expect(pausedToBalance.toString()).to.be.equal(
      user1Balance.toString(),
      INVALID_FROM_BALANCE_AFTER_TRANSFER
    );

    // Configurator unpauses the pool
    await configurator.connect(adminSigner).setPoolPause(false);
    await stopImpersonatingEmergencyAdmin(addressesProvider);

    // User 0 succeeds transfer to User 1
    await aUSDC.connect(users[0].signer).transfer(users[1].address, amountUSDCtoDeposit);

    const fromBalance = await aUSDC.balanceOf(users[0].address);
    const toBalance = await aUSDC.balanceOf(users[1].address);

    expect(fromBalance.toString()).to.be.equal(
      user0Balance.sub(amountUSDCtoDeposit),
      INVALID_FROM_BALANCE_AFTER_TRANSFER
    );
    expect(toBalance.toString()).to.be.equal(
      user1Balance.add(amountUSDCtoDeposit),
      INVALID_TO_BALANCE_AFTER_TRANSFER
    );
  });

  it('Deposit', async () => {
    const { users, pool, usdc, aUSDC, configurator, addressesProvider } = testEnv;

    const amountUSDCtoDeposit = await convertToCurrencyDecimals(usdc.address, '1000');

    await mintTokens(usdc, users[0].address, amountUSDCtoDeposit, users[0].signer);

    // user 0 deposits 1000 USDC
    await usdc.connect(users[0].signer).approve(pool.address, APPROVAL_AMOUNT_LENDING_POOL);

    // Configurator pauses the pool (admin only)
    const adminSigner = await getEmergencyAdminSigner(addressesProvider);
    await configurator.connect(adminSigner).setPoolPause(true);
    await expect(
      pool.connect(users[0].signer).deposit(usdc.address, amountUSDCtoDeposit, users[0].address, '0')
    ).to.revertedWith(LP_IS_PAUSED);

    // Configurator unpauses the pool
    await configurator.connect(adminSigner).setPoolPause(false);
    await stopImpersonatingEmergencyAdmin(addressesProvider);
  });

  it('Withdraw', async () => {
    const { users, pool, usdc, aUSDC, configurator, addressesProvider } = testEnv;

    const amountUSDCtoDeposit = await convertToCurrencyDecimals(usdc.address, '1000');

    await mintTokens(usdc, users[0].address, amountUSDCtoDeposit, users[0].signer);

    // user 0 deposits 1000 USDC
    await usdc.connect(users[0].signer).approve(pool.address, APPROVAL_AMOUNT_LENDING_POOL);
    await pool
      .connect(users[0].signer)
      .deposit(usdc.address, amountUSDCtoDeposit, users[0].address, '0');

    // Configurator pauses the pool (admin only)
    const adminSigner = await getEmergencyAdminSigner(addressesProvider);
    await configurator.connect(adminSigner).setPoolPause(true);

    // user tries to burn
    await expect(
      pool.connect(users[0].signer).withdraw(usdc.address, amountUSDCtoDeposit, users[0].address)
    ).to.revertedWith(LP_IS_PAUSED);

    // Configurator unpauses the pool
    await configurator.connect(adminSigner).setPoolPause(false);
    await stopImpersonatingEmergencyAdmin(addressesProvider);
  });

  it('Borrow', async () => {
    const { pool, usdc, users, configurator, addressesProvider } = testEnv;

    const user = users[1];
    // Pause the pool (admin only)
    const adminSigner = await getEmergencyAdminSigner(addressesProvider);
    await configurator.connect(adminSigner).setPoolPause(true);

    // Try to execute liquidation
    await expect(
      pool.connect(user.signer).borrow(usdc.address, '1', '2', '0', user.address)
    ).revertedWith(LP_IS_PAUSED);

    // Unpause the pool
    await configurator.connect(adminSigner).setPoolPause(false);
    await stopImpersonatingEmergencyAdmin(addressesProvider);
  });

  it('Repay', async () => {
    const { pool, usdc, users, configurator, addressesProvider } = testEnv;

    const user = users[1];
    // Pause the pool (admin only)
    const adminSigner = await getEmergencyAdminSigner(addressesProvider);
    await configurator.connect(adminSigner).setPoolPause(true);

    // Try to execute liquidation
    await expect(pool.connect(user.signer).repay(usdc.address, '1', '2', user.address)).revertedWith(
      LP_IS_PAUSED
    );

    // Unpause the pool
    await configurator.connect(adminSigner).setPoolPause(false);
    await stopImpersonatingEmergencyAdmin(addressesProvider);
  });

  it('Flash loan', async () => {
    const { usdc, pool, oxau, users, configurator, addressesProvider } = testEnv;

    if (!_mockFlashLoanReceiver) {
      throw new Error('MockFlashLoanReceiver not initialized');
    }

    const caller = users[3];

    const flashAmount = parseEther('50');

    await _mockFlashLoanReceiver.setFailExecutionTransfer(true);

    // Pause pool (admin only)
    const adminSigner = await getEmergencyAdminSigner(addressesProvider);
    await configurator.connect(adminSigner).setPoolPause(true);

    await expect(
      pool
        .connect(caller.signer)
        .flashLoan(
          _mockFlashLoanReceiver.address,
          [oxau.address],
          [flashAmount],
          [2],
          caller.address,
          '0x10',
          '0'
        )
    ).revertedWith(LP_IS_PAUSED);

    // Unpause pool
    await configurator.connect(adminSigner).setPoolPause(false);
    await stopImpersonatingEmergencyAdmin(addressesProvider);
  });

  it('Liquidation call', async () => {
    const { users, pool, usdc, oracle, oxau, configurator, helpersContract, addressesProvider } = testEnv;
    const depositor = users[3];
    const borrower = users[4];

    //mints USDC to depositor
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
        .multipliedBy(0.9502)
        .toFixed(0)
    );

    await pool
      .connect(borrower.signer)
      .borrow(usdc.address, amountUSDCToBorrow, RateMode.Variable, '0', borrower.address);
    
    // Drops HF below 1
    const newPrice = new BigNumber(usdcPrice.toString()).multipliedBy(1.2).toFixed(0);
    await setAggregatorPrice(oracle, usdc.address, newPrice);

    //mints usdc to the liquidator
    const { deployer } = testEnv;
    await mintTokens(usdc, deployer.address, await convertToCurrencyDecimals(usdc.address, '2000'), deployer.signer);
    await usdc.approve(pool.address, APPROVAL_AMOUNT_LENDING_POOL);

    const userReserveDataBefore = await helpersContract.getUserReserveData(
      usdc.address,
      borrower.address
    );

    const amountToLiquidate = new BigNumber(userReserveDataBefore.currentVariableDebt.toString())
      .multipliedBy(0.5)
      .toFixed(0);

    // Pause pool (admin only)
    const adminSigner = await getEmergencyAdminSigner(addressesProvider);
    await configurator.connect(adminSigner).setPoolPause(true);

    // Do liquidation
    await expect(
      pool.liquidationCall(oxau.address, usdc.address, borrower.address, amountToLiquidate, true)
    ).revertedWith(LP_IS_PAUSED);

    // Unpause pool
    await configurator.connect(adminSigner).setPoolPause(false);
    await stopImpersonatingEmergencyAdmin(addressesProvider);
  });

  it('SwapBorrowRateMode should fail because pool is paused', async () => {
    const { pool, oxau, usdc, usdt, users, configurator, addressesProvider } = testEnv;
    const user = users[1];
    const amountOXAUToDeposit = parseEther('100');
    const amountUSDTToDeposit = parseUnits('1000', 6);
    const amountToBorrow = parseUnits('65', 6);

    await mintTokens(oxau, user.address, amountOXAUToDeposit, user.signer);
    await oxau.connect(user.signer).approve(pool.address, APPROVAL_AMOUNT_LENDING_POOL);
    await pool.connect(user.signer).deposit(oxau.address, amountOXAUToDeposit, user.address, '0');

    await mintTokens(usdt, user.address, amountUSDTToDeposit, user.signer);
    await usdt.connect(user.signer).approve(pool.address, APPROVAL_AMOUNT_LENDING_POOL);
    await pool.connect(user.signer).deposit(usdt.address, amountUSDTToDeposit, user.address, '0');

    await pool.connect(user.signer).borrow(usdc.address, amountToBorrow, 2, 0, user.address);

    // Pause pool (admin only)
    const adminSigner = await getEmergencyAdminSigner(addressesProvider);
    await configurator.connect(adminSigner).setPoolPause(true);

    // Try to swap rate mode
    await expect(
      pool.connect(user.signer).swapBorrowRateMode(usdc.address, RateMode.Stable)
    ).revertedWith(LP_IS_PAUSED);

    // Unpause pool
    await configurator.connect(adminSigner).setPoolPause(false);
    await stopImpersonatingEmergencyAdmin(addressesProvider);
  });

  it('RebalanceStableBorrowRate should fail because the pool is paused, even if there is no stable borrow', async () => {
    const { pool, usdc, users, configurator, addressesProvider } = testEnv;
    const user = users[1];
    // Pause pool (admin only)
    const adminSigner = await getEmergencyAdminSigner(addressesProvider);
    await configurator.connect(adminSigner).setPoolPause(true);

    await expect(
      pool.connect(user.signer).rebalanceStableBorrowRate(usdc.address, user.address)
    ).revertedWith(LP_IS_PAUSED);

    // Unpause pool
    await configurator.connect(adminSigner).setPoolPause(false);
    await stopImpersonatingEmergencyAdmin(addressesProvider);
  });

  it('setUserUseReserveAsCollateral', async () => {
    const { pool, oxau, users, configurator, addressesProvider } = testEnv;
    const user = users[1];

    const amountOXAUToDeposit = parseEther('10');
    await mintTokens(oxau, user.address, amountOXAUToDeposit, user.signer);
    await oxau.connect(user.signer).approve(pool.address, APPROVAL_AMOUNT_LENDING_POOL);
    await pool.connect(user.signer).deposit(oxau.address, amountOXAUToDeposit, user.address, '0');

    // Pause pool (admin only)
    const adminSigner = await getEmergencyAdminSigner(addressesProvider);
    await configurator.connect(adminSigner).setPoolPause(true);

    await expect(
      pool.connect(user.signer).setUserUseReserveAsCollateral(oxau.address, false)
    ).revertedWith(LP_IS_PAUSED);

    // Unpause pool
    await configurator.connect(adminSigner).setPoolPause(false);
    await stopImpersonatingEmergencyAdmin(addressesProvider);
  });
});
