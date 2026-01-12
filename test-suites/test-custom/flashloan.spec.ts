import BigNumber from 'bignumber.js';

import { TestEnv, makeSuite } from './helpers/make-suite';
import { APPROVAL_AMOUNT_LENDING_POOL, oneRay } from '../../helpers/constants';
import { convertToCurrencyDecimals } from '../../helpers/contracts-helpers';
import { ethers } from 'ethers';
import { MockFlashLoanReceiver } from '../../types/MockFlashLoanReceiver';
import { ProtocolErrors } from '../../helpers/types';
import {
  getMockFlashLoanReceiver,
  getStableDebtToken,
  getVariableDebtToken,
} from '../../helpers/contracts-getters';

const { expect } = require('chai');

makeSuite('LendingPool FlashLoan function', (testEnv: TestEnv) => {
  let _mockFlashLoanReceiver = {} as MockFlashLoanReceiver;
  const {
    VL_COLLATERAL_BALANCE_IS_0,
    TRANSFER_AMOUNT_EXCEEDS_BALANCE,
    LP_INVALID_FLASHLOAN_MODE,
    VL_STABLE_BORROWING_NOT_ENABLED,
    SAFEERC20_LOWLEVEL_CALL,
    LP_INVALID_FLASH_LOAN_EXECUTOR_RETURN,
    LP_BORROW_ALLOWANCE_NOT_ENOUGH,
  } = ProtocolErrors;

  before(async () => {
    _mockFlashLoanReceiver = await getMockFlashLoanReceiver();
  });

  it('Deposits AGT into the reserve', async () => {
    const { pool, agt } = testEnv;
    const userAddress = await pool.signer.getAddress();
    const amountToDeposit = ethers.utils.parseEther('100');

    await agt.mint(amountToDeposit);

    await agt.approve(pool.address, APPROVAL_AMOUNT_LENDING_POOL);

    await pool.deposit(agt.address, amountToDeposit, userAddress, '0');
  });

  it('Takes AGT flashloan with mode = 0, returns the funds correctly', async () => {
    const { pool, helpersContract, agt } = testEnv;

    await pool.flashLoan(
      _mockFlashLoanReceiver.address,
      [agt.address],
      [ethers.utils.parseEther('80')],
      [0],
      _mockFlashLoanReceiver.address,
      '0x10',
      '0'
    );

    const reserveData = await helpersContract.getReserveData(agt.address);

    const currentLiquidityRate = reserveData.liquidityRate;
    const currentLiquidityIndex = reserveData.liquidityIndex;

    const totalLiquidity = new BigNumber(reserveData.availableLiquidity.toString())
      .plus(reserveData.totalStableDebt.toString())
      .plus(reserveData.totalVariableDebt.toString());

    expect(totalLiquidity.toString()).to.be.equal('100072000000000000000');
    expect(currentLiquidityRate.toString()).to.be.equal('0');
    expect(currentLiquidityIndex.toString()).to.be.equal('1000720000000000000000000000');
  });

  it('Takes AGT flashloan, does not return the funds with mode = 0. (revert expected)', async () => {
    const { pool, agt, users } = testEnv;
    const caller = users[1];
    await _mockFlashLoanReceiver.setFailExecutionTransfer(true);

    await expect(
      pool
        .connect(caller.signer)
        .flashLoan(
          _mockFlashLoanReceiver.address,
          [agt.address],
          [ethers.utils.parseEther('80')],
          [0],
          caller.address,
          '0x10',
          '0'
        )
    ).to.be.revertedWith(SAFEERC20_LOWLEVEL_CALL);
  });

  it('Takes AGT flashloan, simulating a receiver as EOA (revert expected)', async () => {
    const { pool, agt, users } = testEnv;
    const caller = users[1];
    await _mockFlashLoanReceiver.setFailExecutionTransfer(true);
    await _mockFlashLoanReceiver.setSimulateEOA(true);

    await expect(
      pool
        .connect(caller.signer)
        .flashLoan(
          _mockFlashLoanReceiver.address,
          [agt.address],
          [ethers.utils.parseEther('80')],
          [0],
          caller.address,
          '0x10',
          '0'
        )
    ).to.be.revertedWith(LP_INVALID_FLASH_LOAN_EXECUTOR_RETURN);
  });

  it('Takes an AGT flashloan with an invalid mode. (revert expected)', async () => {
    const { pool, agt, users } = testEnv;
    const caller = users[1];
    await _mockFlashLoanReceiver.setSimulateEOA(false);
    await _mockFlashLoanReceiver.setFailExecutionTransfer(true);

    await expect(
      pool
        .connect(caller.signer)
        .flashLoan(
          _mockFlashLoanReceiver.address,
          [agt.address],
          [ethers.utils.parseEther('80')],
          [4],
          caller.address,
          '0x10',
          '0'
        )
    ).to.be.reverted;
  });

  it('Caller deposits 1000 USDC as collateral, Takes AGT flashloan with mode = 2, does not return the funds. A variable loan for caller is created', async () => {
    const { usdc, pool, agt, users, helpersContract } = testEnv;

    const caller = users[1];

    await usdc.connect(caller.signer).mint(await convertToCurrencyDecimals(usdc.address, '1000'));

    await usdc.connect(caller.signer).approve(pool.address, APPROVAL_AMOUNT_LENDING_POOL);

    const amountToDeposit = await convertToCurrencyDecimals(usdc.address, '1000');

    await pool.connect(caller.signer).deposit(usdc.address, amountToDeposit, caller.address, '0');

    await _mockFlashLoanReceiver.setFailExecutionTransfer(true);

    // With 1000 USDC collateral (~2 ETH) and 75% LTV, can borrow ~1.5 ETH worth
    // AGT at 0.1 ETH means max ~15 AGT borrow, so use 10 AGT
    await pool
      .connect(caller.signer)
      .flashLoan(
        _mockFlashLoanReceiver.address,
        [agt.address],
        [ethers.utils.parseEther('10')],
        [2],
        caller.address,
        '0x10',
        '0'
      );
    const { variableDebtTokenAddress } = await helpersContract.getReserveTokensAddresses(
      agt.address
    );

    const agtDebtToken = await getVariableDebtToken(variableDebtTokenAddress);

    const callerDebt = await agtDebtToken.balanceOf(caller.address);

    expect(callerDebt.toString()).to.be.equal('10000000000000000000', 'Invalid user debt');
  });

  it('tries to take a flashloan that is bigger than the available liquidity (revert expected)', async () => {
    const { pool, agt, users } = testEnv;
    const caller = users[1];

    await expect(
      pool.connect(caller.signer).flashLoan(
        _mockFlashLoanReceiver.address,
        [agt.address],
        [ethers.utils.parseEther('200')], //bigger than the available liquidity
        [2],
        caller.address,
        '0x10',
        '0'
      ),
      TRANSFER_AMOUNT_EXCEEDS_BALANCE
    ).to.be.revertedWith(SAFEERC20_LOWLEVEL_CALL);
  });

  it('tries to take a flashloan using a non contract address as receiver (revert expected)', async () => {
    const { pool, deployer, agt, users } = testEnv;
    const caller = users[1];

    await expect(
      pool.flashLoan(
        deployer.address,
        [agt.address],
        [ethers.utils.parseEther('100')],
        [2],
        caller.address,
        '0x10',
        '0'
      )
    ).to.be.reverted;
  });

  it('Deposits USDC into the reserve', async () => {
    const { usdc, pool } = testEnv;
    const userAddress = await pool.signer.getAddress();

    await usdc.mint(await convertToCurrencyDecimals(usdc.address, '1000'));

    await usdc.approve(pool.address, APPROVAL_AMOUNT_LENDING_POOL);

    const amountToDeposit = await convertToCurrencyDecimals(usdc.address, '1000');

    await pool.deposit(usdc.address, amountToDeposit, userAddress, '0');
  });

  it('Takes out a 500 USDC flashloan, returns the funds correctly', async () => {
    const { usdc, pool, helpersContract } = testEnv;

    await _mockFlashLoanReceiver.setFailExecutionTransfer(false);

    const reserveDataBefore = await helpersContract.getReserveData(usdc.address);
    const totalLiquidityBefore = reserveDataBefore.availableLiquidity
      .add(reserveDataBefore.totalStableDebt)
      .add(reserveDataBefore.totalVariableDebt);

    const flashloanAmount = await convertToCurrencyDecimals(usdc.address, '500');
    // Premium is 0.09% of flashloan amount = 0.45 USDC
    const expectedPremium = await convertToCurrencyDecimals(usdc.address, '0.45');

    await pool.flashLoan(
      _mockFlashLoanReceiver.address,
      [usdc.address],
      [flashloanAmount],
      [0],
      _mockFlashLoanReceiver.address,
      '0x10',
      '0'
    );

    const reserveDataAfter = await helpersContract.getReserveData(usdc.address);

    const totalLiquidityAfter = reserveDataAfter.availableLiquidity
      .add(reserveDataAfter.totalStableDebt)
      .add(reserveDataAfter.totalVariableDebt);

    // Total liquidity should increase by the premium
    expect(totalLiquidityAfter.sub(totalLiquidityBefore).toString()).to.be.equal(
      expectedPremium.toString(),
      'Invalid total liquidity increase from flashloan premium'
    );
  });

  it('Takes out a 500 USDC flashloan with mode = 0, does not return the funds. (revert expected)', async () => {
    const { usdc, pool, users } = testEnv;
    const caller = users[2];

    const flashloanAmount = await convertToCurrencyDecimals(usdc.address, '500');

    await _mockFlashLoanReceiver.setFailExecutionTransfer(true);

    await expect(
      pool
        .connect(caller.signer)
        .flashLoan(
          _mockFlashLoanReceiver.address,
          [usdc.address],
          [flashloanAmount],
          [2],
          caller.address,
          '0x10',
          '0'
        )
    ).to.be.revertedWith(VL_COLLATERAL_BALANCE_IS_0);
  });

  it('Caller deposits 100 AGT as collateral, Takes a USDC flashloan with mode = 2, does not return the funds. A loan for caller is created', async () => {
    const { usdc, pool, agt, users, helpersContract } = testEnv;

    const caller = users[2];

    await agt.connect(caller.signer).mint(await convertToCurrencyDecimals(agt.address, '100'));

    await agt.connect(caller.signer).approve(pool.address, APPROVAL_AMOUNT_LENDING_POOL);

    const amountToDeposit = await convertToCurrencyDecimals(agt.address, '100');

    await pool.connect(caller.signer).deposit(agt.address, amountToDeposit, caller.address, '0');

    await _mockFlashLoanReceiver.setFailExecutionTransfer(true);

    // With 100 AGT collateral at 1 ETH each and 75% LTV, max borrow is ~75 USDC
    const flashloanAmount = await convertToCurrencyDecimals(usdc.address, '50');

    await pool
      .connect(caller.signer)
      .flashLoan(
        _mockFlashLoanReceiver.address,
        [usdc.address],
        [flashloanAmount],
        [2],
        caller.address,
        '0x10',
        '0'
      );
    const { variableDebtTokenAddress } = await helpersContract.getReserveTokensAddresses(
      usdc.address
    );

    const usdcDebtToken = await getVariableDebtToken(variableDebtTokenAddress);

    const callerDebt = await usdcDebtToken.balanceOf(caller.address);

    expect(callerDebt.toString()).to.be.equal('50000000', 'Invalid user debt');
  });

  it('Caller deposits 1000 USDT as collateral, Takes an AGT flashloan with mode = 0, does not approve the transfer of the funds', async () => {
    const { usdt, pool, agt, users } = testEnv;
    const caller = users[3];

    await usdt.connect(caller.signer).mint(await convertToCurrencyDecimals(usdt.address, '1000'));

    await usdt.connect(caller.signer).approve(pool.address, APPROVAL_AMOUNT_LENDING_POOL);

    const amountToDeposit = await convertToCurrencyDecimals(usdt.address, '1000');

    await pool.connect(caller.signer).deposit(usdt.address, amountToDeposit, caller.address, '0');

    const flashAmount = ethers.utils.parseEther('10');

    await _mockFlashLoanReceiver.setFailExecutionTransfer(false);
    await _mockFlashLoanReceiver.setAmountToApprove(flashAmount.div(2));

    await expect(
      pool
        .connect(caller.signer)
        .flashLoan(
          _mockFlashLoanReceiver.address,
          [agt.address],
          [flashAmount],
          [0],
          caller.address,
          '0x10',
          '0'
        )
    ).to.be.revertedWith(SAFEERC20_LOWLEVEL_CALL);
  });

  it('Caller takes an AGT flashloan with mode = 1, should revert since stable borrowing is disabled', async () => {
    const { usdt, pool, agt, users, helpersContract } = testEnv;

    const caller = users[3];

    const flashAmount = ethers.utils.parseEther('10');

    await _mockFlashLoanReceiver.setFailExecutionTransfer(true);

    await expect(pool
      .connect(caller.signer)
      .flashLoan(
        _mockFlashLoanReceiver.address,
        [agt.address],
        [flashAmount],
        [1],
        caller.address,
        '0x10',
        '0'
      )).to.be.revertedWith(VL_STABLE_BORROWING_NOT_ENABLED);

    const { stableDebtTokenAddress } = await helpersContract.getReserveTokensAddresses(
      agt.address
    );

    const agtDebtToken = await getStableDebtToken(stableDebtTokenAddress);

    const callerDebt = await agtDebtToken.balanceOf(caller.address);

    expect(callerDebt.toString()).to.be.equal('0', 'Invalid user debt');
  });

  it('Caller takes an AGT flashloan with mode = 2', async () => {
    const { usdt, pool, agt, users, helpersContract } = testEnv;

    const caller = users[3];

    const flashAmount = ethers.utils.parseEther('10');

    await _mockFlashLoanReceiver.setFailExecutionTransfer(true);

    await pool
      .connect(caller.signer)
      .flashLoan(
        _mockFlashLoanReceiver.address,
        [agt.address],
        [flashAmount],
        [2],
        caller.address,
        '0x10',
        '0'
      );

    const { variableDebtTokenAddress } = await helpersContract.getReserveTokensAddresses(
      agt.address
    );

    const agtDebtToken = await getVariableDebtToken(variableDebtTokenAddress);

    const callerDebt = await agtDebtToken.balanceOf(caller.address);

    expect(callerDebt.toString()).to.be.equal(ethers.utils.parseEther('10'), 'Invalid user debt');
  });

  it('Caller takes an AGT flashloan with mode = 1 onBehalfOf user without allowance, should revert since stable borrowing is disabled', async () => {
    const { usdt, pool, agt, users, helpersContract } = testEnv;

    const caller = users[5];
    const onBehalfOf = users[4];

    // Deposit 1000 usdt for onBehalfOf user
    await usdt.connect(onBehalfOf.signer).mint(await convertToCurrencyDecimals(usdt.address, '1000'));

    await usdt.connect(onBehalfOf.signer).approve(pool.address, APPROVAL_AMOUNT_LENDING_POOL);

    const amountToDeposit = await convertToCurrencyDecimals(usdt.address, '1000');

    await pool
      .connect(onBehalfOf.signer)
      .deposit(usdt.address, amountToDeposit, onBehalfOf.address, '0');

    const flashAmount = ethers.utils.parseEther('10');

    await _mockFlashLoanReceiver.setFailExecutionTransfer(true);

    await expect(
      pool
        .connect(caller.signer)
        .flashLoan(
          _mockFlashLoanReceiver.address,
          [agt.address],
          [flashAmount],
          [1],
          onBehalfOf.address,
          '0x10',
          '0'
        )
    ).to.be.revertedWith(VL_STABLE_BORROWING_NOT_ENABLED);
  });

  it('Caller takes an AGT flashloan with mode = 2 onBehalfOf user without allowance, should revert since allowance is 0', async () => {
    const { usdt, pool, agt, users, helpersContract } = testEnv;

    const caller = users[5];
    const onBehalfOf = users[4];

    const flashAmount = ethers.utils.parseEther('10');

    await _mockFlashLoanReceiver.setFailExecutionTransfer(true);

    await expect(
      pool
        .connect(caller.signer)
        .flashLoan(
          _mockFlashLoanReceiver.address,
          [agt.address],
          [flashAmount],
          [2],
          onBehalfOf.address,
          '0x10',
          '0'
        )
    ).to.be.revertedWith(LP_BORROW_ALLOWANCE_NOT_ENOUGH);
  });

  it('Caller takes an AGT flashloan with mode = 2 onBehalfOf user with allowance. A loan for onBehalfOf is created.', async () => {
    const { usdt, pool, agt, users, helpersContract } = testEnv;

    const caller = users[5];
    const onBehalfOf = users[4];

    const flashAmount = ethers.utils.parseEther('10');

    const reserveData = await pool.getReserveData(agt.address);

    const variableDebtToken = await getVariableDebtToken(reserveData.variableDebtTokenAddress);

    // Deposited for onBehalfOf user already, delegate borrow allowance
    await variableDebtToken.connect(onBehalfOf.signer).approveDelegation(caller.address, flashAmount);

    await _mockFlashLoanReceiver.setFailExecutionTransfer(true);

    await expect(pool
      .connect(caller.signer)
      .flashLoan(
        _mockFlashLoanReceiver.address,
        [agt.address],
        [flashAmount],
        [2],
        onBehalfOf.address,
        '0x10',
        '0'
      )).to.not.be.reverted;

    const { variableDebtTokenAddress } = await helpersContract.getReserveTokensAddresses(
      agt.address
    );

    const agtDebtToken = await getVariableDebtToken(variableDebtTokenAddress);

    const onBehalfOfDebt = await agtDebtToken.balanceOf(onBehalfOf.address);

    expect(onBehalfOfDebt.toString()).to.be.equal(
      ethers.utils.parseEther('10'),
      'Invalid onBehalfOf user debt'
    );
  });
});
