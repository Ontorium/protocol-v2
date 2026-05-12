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
import { DRE, waitForTx } from '../../helpers/misc-utils';
import { mintTokens } from './helpers/mint-tokens';

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

  it('Deposits OXAU into the reserve', async () => {
    const { pool, oxau, deployer } = testEnv;
    const userAddress = await pool.signer.getAddress();
    const amountToDeposit = ethers.utils.parseEther('100');

    await mintTokens(oxau, deployer.address, amountToDeposit, deployer.signer);

    await oxau.approve(pool.address, APPROVAL_AMOUNT_LENDING_POOL);

    const tx = await pool.deposit(oxau.address, amountToDeposit, userAddress, '0');
    await tx.wait(1);
  });

  it('Takes OXAU flashloan with mode = 0, returns the funds correctly', async () => {
    const { pool, helpersContract, oxau, deployer } = testEnv;
    
    // Provide tokens to MockFlashLoanReceiver for premium payment
    const flashAmount = ethers.utils.parseEther('80');
    const premiumAmount = flashAmount.mul(9).div(10000); // 0.09% premium
    await mintTokens(oxau, _mockFlashLoanReceiver.address, premiumAmount.mul(2), deployer.signer);

    try {
      await pool.callStatic.flashLoan(
        _mockFlashLoanReceiver.address,
        [oxau.address],
        [ethers.utils.parseEther('80')],
        [0],
        _mockFlashLoanReceiver.address,
        '0x10',
        0
      );
      console.log("callStatic.flashLoan OK");
    } catch (e: any) {
      console.log("callStatic.flashLoan REVERT:",
        e?.error?.message ?? e?.reason ?? e?.message
      );
      console.log("revert data:", e?.error?.data ?? e?.data);
      throw e;
    }


    await waitForTx(
      await pool.flashLoan(
        _mockFlashLoanReceiver.address,
        [oxau.address],
        [ethers.utils.parseEther('80')],
        [0],
        _mockFlashLoanReceiver.address,
        '0x10',
        0
      )
    )

    const reserveData = await helpersContract.getReserveData(oxau.address);

    const currentLiquidityRate = reserveData.liquidityRate;
    const currentLiquidityIndex = reserveData.liquidityIndex;

    const totalLiquidity = new BigNumber(reserveData.availableLiquidity.toString())
      .plus(reserveData.totalStableDebt.toString())
      .plus(reserveData.totalVariableDebt.toString());

    expect(totalLiquidity.toString()).to.be.equal('100072000000000000000');
    expect(currentLiquidityRate.toString()).to.be.equal('0');
    expect(currentLiquidityIndex.toString()).to.be.equal('1000720000000000000000000000');
  });

  it('Takes OXAU flashloan, does not return the funds with mode = 0. (revert expected)', async () => {
    const { pool, oxau, users } = testEnv;
    const caller = users[1];
    await _mockFlashLoanReceiver.setFailExecutionTransfer(true);

    await expect(
      pool
        .connect(caller.signer)
        .flashLoan(
          _mockFlashLoanReceiver.address,
          [oxau.address],
          [ethers.utils.parseEther('80')],
          [0],
          caller.address,
          '0x10',
          '0'
        )
    ).to.be.revertedWith(SAFEERC20_LOWLEVEL_CALL);
  });

  it('Takes OXAU flashloan, simulating a receiver as EOA (revert expected)', async () => {
    const { pool, oxau, users } = testEnv;
    const caller = users[1];
    await _mockFlashLoanReceiver.setFailExecutionTransfer(true);
    await _mockFlashLoanReceiver.setSimulateEOA(true);

    await expect(
      pool
        .connect(caller.signer)
        .flashLoan(
          _mockFlashLoanReceiver.address,
          [oxau.address],
          [ethers.utils.parseEther('80')],
          [0],
          caller.address,
          '0x10',
          '0'
        )
    ).to.be.revertedWith(LP_INVALID_FLASH_LOAN_EXECUTOR_RETURN);
  });

  it('Takes an OXAU flashloan with an invalid mode. (revert expected)', async () => {
    const { pool, oxau, users } = testEnv;
    const caller = users[1];
    await _mockFlashLoanReceiver.setSimulateEOA(false);
    await _mockFlashLoanReceiver.setFailExecutionTransfer(true);

    await expect(
      pool
        .connect(caller.signer)
        .flashLoan(
          _mockFlashLoanReceiver.address,
          [oxau.address],
          [ethers.utils.parseEther('80')],
          [4],
          caller.address,
          '0x10',
          '0'
        )
    ).to.be.reverted;
  });

  it('Caller deposits 1000 USDC as collateral, Takes OXAU flashloan with mode = 2, does not return the funds. A variable loan for caller is created', async () => {
    const { usdc, pool, oxau, users, helpersContract, deployer } = testEnv;

    const caller = users[1];

    await mintTokens(usdc, caller.address, await convertToCurrencyDecimals(usdc.address, '1000'), caller.signer);

    await usdc.connect(caller.signer).approve(pool.address, APPROVAL_AMOUNT_LENDING_POOL);

    const amountToDeposit = await convertToCurrencyDecimals(usdc.address, '1000');

    const depositTx1 = await pool.connect(caller.signer).deposit(usdc.address, amountToDeposit, caller.address, '0');
    await depositTx1.wait(1);

    await _mockFlashLoanReceiver.connect(deployer.signer).setFailExecutionTransfer(true)
    await _mockFlashLoanReceiver.connect(deployer.signer).setAmountToApprove(0)

    try {
      await pool.connect(caller.signer).callStatic.flashLoan(
        _mockFlashLoanReceiver.address,
        [oxau.address],
        [ethers.utils.parseEther('4')],
        [2],
        caller.address,
        '0x10',
        '0'
      );
      console.log("callStatic.flashLoan OK");
    } catch (e: any) {
      console.log("callStatic.flashLoan REVERT:",
        e?.error?.message ?? e?.reason ?? e?.message
      );
      console.log("revert data:", e?.error?.data ?? e?.data);
      throw e;
    }

    // With 1000 USDC collateral at 65% LTV and OXAU priced at 155 USD,
    // a borrow around 4 OXAU stays within the available borrow power.
    await waitForTx(
      await pool
        .connect(caller.signer)
        .flashLoan(
          _mockFlashLoanReceiver.address,
          [oxau.address],
          [ethers.utils.parseEther('4')],
          [2],
          caller.address,
          '0x10',
          '0'
        )
    );
    const { variableDebtTokenAddress } = await helpersContract.getReserveTokensAddresses(
      oxau.address
    );

    const agtDebtToken = await getVariableDebtToken(variableDebtTokenAddress);

    const callerDebt = await agtDebtToken.balanceOf(caller.address);

    expect(callerDebt.toString()).to.be.equal(
      ethers.utils.parseEther('4').toString(),
      'Invalid user debt'
    );
  });

  it('tries to take a flashloan that is bigger than the available liquidity (revert expected)', async () => {
    const { pool, oxau, users } = testEnv;
    const caller = users[1];

    await expect(
      pool.connect(caller.signer).flashLoan(
        _mockFlashLoanReceiver.address,
        [oxau.address],
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
    const { pool, deployer, oxau, users } = testEnv;
    const caller = users[1];

    await expect(
      pool.flashLoan(
        deployer.address,
        [oxau.address],
        [ethers.utils.parseEther('100')],
        [2],
        caller.address,
        '0x10',
        '0'
      )
    ).to.be.reverted;
  });

  it('Deposits USDC into the reserve', async () => {
    const { usdc, pool, deployer } = testEnv;
    const userAddress = await pool.signer.getAddress();

    await mintTokens(usdc, deployer.address, await convertToCurrencyDecimals(usdc.address, '1000'), deployer.signer);

    await usdc.approve(pool.address, APPROVAL_AMOUNT_LENDING_POOL);

    const amountToDeposit = await convertToCurrencyDecimals(usdc.address, '1000');

    const tx = await pool.deposit(usdc.address, amountToDeposit, userAddress, '0');
    await tx.wait(1);
  });

  it('Takes out a 500 USDC flashloan, returns the funds correctly', async () => {
    const { usdc, pool, helpersContract, deployer } = testEnv;

    await _mockFlashLoanReceiver.setFailExecutionTransfer(false);

    // Provide tokens to MockFlashLoanReceiver for premium payment
    const flashAmountForPremium = await convertToCurrencyDecimals(usdc.address, '500');
    const premiumAmount = flashAmountForPremium.mul(9).div(10000); // 0.09% premium
    await mintTokens(usdc, _mockFlashLoanReceiver.address, premiumAmount.mul(2), deployer.signer);

    const reserveDataBefore = await helpersContract.getReserveData(usdc.address);
    const totalLiquidityBefore = reserveDataBefore.availableLiquidity
      .add(reserveDataBefore.totalStableDebt)
      .add(reserveDataBefore.totalVariableDebt);

    const flashloanAmount = await convertToCurrencyDecimals(usdc.address, '500');
    // Premium is 0.09% of flashloan amount = 0.45 USDC
    const expectedPremium = await convertToCurrencyDecimals(usdc.address, '0.45');

    try {
      await pool.callStatic.flashLoan(
        _mockFlashLoanReceiver.address,
        [usdc.address],
        [flashloanAmount],
        [0],
        _mockFlashLoanReceiver.address,
        '0x10',
        '0'
      )
      console.log("callStatic.flashLoan OK");
    } catch (e: any) {
      console.log("callStatic.flashLoan REVERT:",
        e?.error?.message ?? e?.reason ?? e?.message
      );
      console.log("revert data:", e?.error?.data ?? e?.data);
      throw e;
    }

    await waitForTx(
      await pool.flashLoan(
        _mockFlashLoanReceiver.address,
        [usdc.address],
        [flashloanAmount],
        [0],
        _mockFlashLoanReceiver.address,
        '0x10',
        '0'
      )
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

  it('Caller deposits 1000 OXAU as collateral, Takes a USDC flashloan with mode = 2, does not return the funds. A loan for caller is created', async () => {
    const { usdc, pool, oxau, users, helpersContract, deployer } = testEnv;

    const caller = users[8];

    // Ensure USDC liquidity exists in the pool for flashloan
    const reserveData = await helpersContract.getReserveData(usdc.address);
    if (reserveData.availableLiquidity.lt(await convertToCurrencyDecimals(usdc.address, '100'))) {
      // Deposit USDC to provide liquidity
      await mintTokens(usdc, deployer.address, await convertToCurrencyDecimals(usdc.address, '1000'), deployer.signer);
      await usdc.connect(deployer.signer).approve(pool.address, APPROVAL_AMOUNT_LENDING_POOL);
      const liquidityTx = await pool.connect(deployer.signer).deposit(usdc.address, await convertToCurrencyDecimals(usdc.address, '1000'), deployer.address, '0');
      await liquidityTx.wait(1);
    }

    await mintTokens(oxau, caller.address, await convertToCurrencyDecimals(oxau.address, '1000'), caller.signer);

    await oxau.connect(caller.signer).approve(pool.address, APPROVAL_AMOUNT_LENDING_POOL);

    const amountToDeposit = await convertToCurrencyDecimals(oxau.address, '1000');

    // Pre-check deposit with callStatic
    await pool.connect(caller.signer).callStatic.deposit(oxau.address, amountToDeposit, caller.address, '0');
    const depositTx = await pool.connect(caller.signer).deposit(oxau.address, amountToDeposit, caller.address, '0');
    await depositTx.wait(1);

    // Mine a block to ensure state is committed (important for Anvil fork)
    if (process.env.USE_DEPLOYED) {
      const hre = require('hardhat');
      const directProvider = new hre.ethers.providers.JsonRpcProvider(process.env.HARDHAT_NETWORK_URL || 'http://localhost:8545');
      await directProvider.send('evm_mine', []);
    }

    // Verify deposit was successful
    const callerData = await pool.getUserAccountData(caller.address);
    if (callerData.totalCollateralETH.isZero()) {
      throw new Error('Deposit failed: caller has no collateral');
    }

    await _mockFlashLoanReceiver.setFailExecutionTransfer(true);

    // With 1000 OXAU collateral and 65% LTV, max borrow is ~650 ETH worth
    // Use conservative 50 USDC to ensure it works with various oracle prices
    const flashloanAmount = await convertToCurrencyDecimals(usdc.address, '50');

    // Pre-check with callStatic to ensure Anvil fork state is synchronized
    await pool.connect(caller.signer).callStatic.flashLoan(
      _mockFlashLoanReceiver.address,
      [usdc.address],
      [flashloanAmount],
      [2],
      caller.address,
      '0x10',
      '0'
    );

    await waitForTx(
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
        )
    );
    const { variableDebtTokenAddress } = await helpersContract.getReserveTokensAddresses(
      usdc.address
    );

    const usdcDebtToken = await getVariableDebtToken(variableDebtTokenAddress);

    const callerDebt = await usdcDebtToken.balanceOf(caller.address);

    expect(callerDebt.toString()).to.be.equal('50000000', 'Invalid user debt');
  });

  it('Caller deposits 1000 USDT as collateral, Takes an OXAU flashloan with mode = 0, does not approve the transfer of the funds', async () => {
    const { usdt, pool, oxau, users } = testEnv;
    const caller = users[3];

    await mintTokens(usdt, caller.address, await convertToCurrencyDecimals(usdt.address, '1000'), caller.signer);

    await usdt.connect(caller.signer).approve(pool.address, APPROVAL_AMOUNT_LENDING_POOL);

    const amountToDeposit = await convertToCurrencyDecimals(usdt.address, '1000');

    const depositTx2 = await pool.connect(caller.signer).deposit(usdt.address, amountToDeposit, caller.address, '0');
    await depositTx2.wait(1);

    const flashAmount = ethers.utils.parseEther('4');

    await _mockFlashLoanReceiver.setFailExecutionTransfer(false);
    await _mockFlashLoanReceiver.setAmountToApprove(flashAmount.div(2));

    await expect(
      pool
        .connect(caller.signer)
        .flashLoan(
          _mockFlashLoanReceiver.address,
          [oxau.address],
          [flashAmount],
          [0],
          caller.address,
          '0x10',
          '0'
        )
    ).to.be.revertedWith(SAFEERC20_LOWLEVEL_CALL);
  });

  it('Caller takes an OXAU flashloan with mode = 1, should revert since stable borrowing is disabled', async () => {
    const { usdt, pool, oxau, users, helpersContract } = testEnv;

    const caller = users[3];

    const flashAmount = ethers.utils.parseEther('4');

    await _mockFlashLoanReceiver.setFailExecutionTransfer(true);

    await expect(pool
      .connect(caller.signer)
      .flashLoan(
        _mockFlashLoanReceiver.address,
        [oxau.address],
        [flashAmount],
        [1],
        caller.address,
        '0x10',
        '0'
      )).to.be.revertedWith(VL_STABLE_BORROWING_NOT_ENABLED);

    const { stableDebtTokenAddress } = await helpersContract.getReserveTokensAddresses(
      oxau.address
    );

    const agtDebtToken = await getStableDebtToken(stableDebtTokenAddress);

    const callerDebt = await agtDebtToken.balanceOf(caller.address);

    expect(callerDebt.toString()).to.be.equal('0', 'Invalid user debt');
  });

  it('Caller takes an OXAU flashloan with mode = 2', async () => {
    const { usdt, pool, oxau, users, helpersContract } = testEnv;

    const caller = users[3];

    const flashAmount = ethers.utils.parseEther('4');

    await _mockFlashLoanReceiver.setFailExecutionTransfer(true);

    await waitForTx(
      await pool
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
    );
    const { variableDebtTokenAddress } = await helpersContract.getReserveTokensAddresses(
      oxau.address
    );

    const agtDebtToken = await getVariableDebtToken(variableDebtTokenAddress);

    const callerDebt = await agtDebtToken.balanceOf(caller.address);

    expect(callerDebt.toString()).to.be.equal(
      ethers.utils.parseEther('4').toString(),
      'Invalid user debt'
    );
  });

  it('Caller takes an OXAU flashloan with mode = 1 onBehalfOf user without allowance, should revert since stable borrowing is disabled', async () => {
    const { usdt, pool, oxau, users, helpersContract } = testEnv;

    const caller = users[5];
    const onBehalfOf = users[4];

    // Deposit 1000 usdt for onBehalfOf user
    await mintTokens(usdt, onBehalfOf.address, await convertToCurrencyDecimals(usdt.address, '1000'), onBehalfOf.signer);

    await usdt.connect(onBehalfOf.signer).approve(pool.address, APPROVAL_AMOUNT_LENDING_POOL);

    const amountToDeposit = await convertToCurrencyDecimals(usdt.address, '1000');

    const depositTx3 = await pool
      .connect(onBehalfOf.signer)
      .deposit(usdt.address, amountToDeposit, onBehalfOf.address, '0');
    await depositTx3.wait(1);

    const flashAmount = ethers.utils.parseEther('4');

    await _mockFlashLoanReceiver.setFailExecutionTransfer(true);

    await expect(
      pool
        .connect(caller.signer)
        .flashLoan(
          _mockFlashLoanReceiver.address,
          [oxau.address],
          [flashAmount],
          [1],
          onBehalfOf.address,
          '0x10',
          '0'
        )
    ).to.be.revertedWith(VL_STABLE_BORROWING_NOT_ENABLED);
  });

  it('Caller takes an OXAU flashloan with mode = 2 onBehalfOf user without allowance, should revert since allowance is 0', async () => {
    const { usdt, pool, oxau, users, helpersContract } = testEnv;

    const caller = users[5];
    const onBehalfOf = users[4];

    const flashAmount = ethers.utils.parseEther('4');

    await _mockFlashLoanReceiver.setFailExecutionTransfer(true);

    await expect(
      pool
        .connect(caller.signer)
        .flashLoan(
          _mockFlashLoanReceiver.address,
          [oxau.address],
          [flashAmount],
          [2],
          onBehalfOf.address,
          '0x10',
          '0'
        )
    ).to.be.revertedWith(LP_BORROW_ALLOWANCE_NOT_ENOUGH);
  });

  it('Caller takes an OXAU flashloan with mode = 2 onBehalfOf user with allowance. A loan for onBehalfOf is created.', async () => {
    const { usdt, pool, oxau, users, helpersContract } = testEnv;

    const caller = users[5];
    const onBehalfOf = users[4];

    const flashAmount = ethers.utils.parseEther('4');

    const reserveData = await pool.getReserveData(oxau.address);

    const variableDebtToken = await getVariableDebtToken(reserveData.variableDebtTokenAddress);

    // Deposited for onBehalfOf user already, delegate borrow allowance
    await variableDebtToken.connect(onBehalfOf.signer).approveDelegation(caller.address, flashAmount);

    await _mockFlashLoanReceiver.setFailExecutionTransfer(true);

    // Pre-check with callStatic
    await pool
      .connect(caller.signer)
      .callStatic.flashLoan(
        _mockFlashLoanReceiver.address,
        [oxau.address],
        [flashAmount],
        [2],
        onBehalfOf.address,
        '0x10',
        '0'
      );

    // Execute actual transaction
    await waitForTx(
      await pool
        .connect(caller.signer)
        .flashLoan(
          _mockFlashLoanReceiver.address,
          [oxau.address],
          [flashAmount],
          [2],
          onBehalfOf.address,
          '0x10',
          '0'
        )
    );

    const { variableDebtTokenAddress } = await helpersContract.getReserveTokensAddresses(
      oxau.address
    );

    const agtDebtToken = await getVariableDebtToken(variableDebtTokenAddress);

    const onBehalfOfDebt = await agtDebtToken.balanceOf(onBehalfOf.address);

    expect(onBehalfOfDebt.toString()).to.be.equal(
      ethers.utils.parseEther('4').toString(),
      'Invalid onBehalfOf user debt'
    );
  });
});
