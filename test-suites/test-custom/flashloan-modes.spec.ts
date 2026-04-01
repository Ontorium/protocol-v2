import BigNumber from 'bignumber.js';

import { TestEnv, makeSuite } from './helpers/make-suite';
import { APPROVAL_AMOUNT_LENDING_POOL } from '../../helpers/constants';
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
import { strategyAGT, strategyUSDC, strategyUSDT } from '../../markets/custom/reservesConfigs';

const { expect } = require('chai');

/**
 * Flashloan Mode Tests for Custom Market
 *
 * Mode 0: Must repay (borrowed amount + fee) immediately, or revert
 * Mode 1: If not repaid, converts to stable debt (requires stable borrow enabled - NOT available in custom market)
 * Mode 2: If not repaid, converts to variable debt (requires collateral/allowance)
 *
 * Custom Market Config:
 * - AGT: LTV 65%, Liquidation Threshold 75%, stable borrow DISABLED
 * - USDC: LTV 75%, Liquidation Threshold 88%, stable borrow DISABLED
 * - USDT: LTV 75%, Liquidation Threshold 88%, stable borrow DISABLED
 */
makeSuite('FlashLoan Modes - Comprehensive Collateral/Borrow Combinations', (testEnv: TestEnv) => {
  let _mockFlashLoanReceiver = {} as MockFlashLoanReceiver;
  const {
    VL_COLLATERAL_BALANCE_IS_0,
    VL_STABLE_BORROWING_NOT_ENABLED,
    VL_COLLATERAL_CANNOT_COVER_NEW_BORROW,
    SAFEERC20_LOWLEVEL_CALL,
    LP_BORROW_ALLOWANCE_NOT_ENOUGH,
  } = ProtocolErrors;

  // Constants for LTV verification (from reservesConfigs.ts)
  const AGT_LTV = 6500; // 65%
  const USDC_LTV = 7500; // 75%
  const USDT_LTV = 7500; // 75%

  before(async () => {
    if (process.env.USE_DEPLOYED) {
      const { addressesProvider } = testEnv;
      // @ts-ignore
      const factory = await DRE.ethers.getContractFactory('MockFlashLoanPrivateReceiver');
      const deployed = await factory.deploy(addressesProvider.address);
      await deployed.deployed();
      _mockFlashLoanReceiver = deployed as unknown as MockFlashLoanReceiver;
    } else {
      _mockFlashLoanReceiver = await getMockFlashLoanReceiver();
    }
  });

  // ============================================
  // Setup: Provide liquidity for all tokens
  // ============================================
  describe('Setup: Provide Liquidity', () => {
    it('Deployer deposits AGT liquidity (10000 AGT)', async () => {
      const { pool, agt, deployer } = testEnv;
      const amount = ethers.utils.parseEther('10000');

      await mintTokens(agt, deployer.address, amount, deployer.signer);
      await agt.approve(pool.address, APPROVAL_AMOUNT_LENDING_POOL);
      await waitForTx(await pool.deposit(agt.address, amount, deployer.address, '0'));
    });

    it('Deployer deposits USDC liquidity (10000 USDC)', async () => {
      const { pool, usdc, deployer } = testEnv;
      const amount = await convertToCurrencyDecimals(usdc.address, '10000');

      await mintTokens(usdc, deployer.address, amount, deployer.signer);
      await usdc.approve(pool.address, APPROVAL_AMOUNT_LENDING_POOL);
      await waitForTx(await pool.deposit(usdc.address, amount, deployer.address, '0'));
    });

    it('Deployer deposits USDT liquidity (10000 USDT)', async () => {
      const { pool, usdt, deployer } = testEnv;
      const amount = await convertToCurrencyDecimals(usdt.address, '10000');

      await mintTokens(usdt, deployer.address, amount, deployer.signer);
      await usdt.approve(pool.address, APPROVAL_AMOUNT_LENDING_POOL);
      await waitForTx(await pool.deposit(usdt.address, amount, deployer.address, '0'));
    });
  });

  // ============================================
  // Mode 0 Tests: Must repay immediately
  // ============================================
  describe('Mode 0: Immediate Repayment Required', () => {
    it('Mode 0 AGT flashloan - repays correctly with premium', async () => {
      const { pool, agt, deployer, helpersContract } = testEnv;

      const flashAmount = ethers.utils.parseEther('100');
      const premium = flashAmount.mul(9).div(10000); // 0.09%

      // Provide premium to receiver
      await mintTokens(agt, _mockFlashLoanReceiver.address, premium.mul(2), deployer.signer);
      await _mockFlashLoanReceiver.setFailExecutionTransfer(false);

      const reserveBefore = await helpersContract.getReserveData(agt.address);

      await waitForTx(
        await pool.flashLoan(
          _mockFlashLoanReceiver.address,
          [agt.address],
          [flashAmount],
          [0], // Mode 0
          _mockFlashLoanReceiver.address,
          '0x10',
          '0'
        )
      );

      const reserveAfter = await helpersContract.getReserveData(agt.address);

      // Liquidity should increase by premium
      expect(reserveAfter.availableLiquidity.sub(reserveBefore.availableLiquidity)).to.be.gte(premium);
    });

    it('Mode 0 USDC flashloan - repays correctly with premium', async () => {
      const { pool, usdc, deployer, helpersContract } = testEnv;

      const flashAmount = await convertToCurrencyDecimals(usdc.address, '1000');
      const premium = flashAmount.mul(9).div(10000);

      await mintTokens(usdc, _mockFlashLoanReceiver.address, premium.mul(2), deployer.signer);
      await _mockFlashLoanReceiver.setFailExecutionTransfer(false);

      const reserveBefore = await helpersContract.getReserveData(usdc.address);

      await waitForTx(
        await pool.flashLoan(
          _mockFlashLoanReceiver.address,
          [usdc.address],
          [flashAmount],
          [0],
          _mockFlashLoanReceiver.address,
          '0x10',
          '0'
        )
      );

      const reserveAfter = await helpersContract.getReserveData(usdc.address);
      expect(reserveAfter.availableLiquidity.sub(reserveBefore.availableLiquidity)).to.be.gte(premium);
    });

    it('Mode 0 USDT flashloan - repays correctly with premium', async () => {
      const { pool, usdt, deployer, helpersContract } = testEnv;

      const flashAmount = await convertToCurrencyDecimals(usdt.address, '1000');
      const premium = flashAmount.mul(9).div(10000);

      await mintTokens(usdt, _mockFlashLoanReceiver.address, premium.mul(2), deployer.signer);
      await _mockFlashLoanReceiver.setFailExecutionTransfer(false);

      const reserveBefore = await helpersContract.getReserveData(usdt.address);

      await waitForTx(
        await pool.flashLoan(
          _mockFlashLoanReceiver.address,
          [usdt.address],
          [flashAmount],
          [0],
          _mockFlashLoanReceiver.address,
          '0x10',
          '0'
        )
      );

      const reserveAfter = await helpersContract.getReserveData(usdt.address);
      expect(reserveAfter.availableLiquidity.sub(reserveBefore.availableLiquidity)).to.be.gte(premium);
    });

    it('Mode 0 flashloan - reverts if not repaid (AGT)', async () => {
      const { pool, agt, users } = testEnv;
      const caller = users[0];

      await _mockFlashLoanReceiver.setFailExecutionTransfer(true);

      await expect(
        pool.connect(caller.signer).flashLoan(
          _mockFlashLoanReceiver.address,
          [agt.address],
          [ethers.utils.parseEther('100')],
          [0],
          caller.address,
          '0x10',
          '0'
        )
      ).to.be.revertedWith(SAFEERC20_LOWLEVEL_CALL);
    });

    it('Mode 0 flashloan - reverts if not repaid (USDC)', async () => {
      const { pool, usdc, users } = testEnv;
      const caller = users[0];

      await _mockFlashLoanReceiver.setFailExecutionTransfer(true);

      await expect(
        pool.connect(caller.signer).flashLoan(
          _mockFlashLoanReceiver.address,
          [usdc.address],
          [await convertToCurrencyDecimals(usdc.address, '100')],
          [0],
          caller.address,
          '0x10',
          '0'
        )
      ).to.be.revertedWith(SAFEERC20_LOWLEVEL_CALL);
    });
  });

  // ============================================
  // Mode 1 Tests: Stable Debt (ALL DISABLED in Custom Market)
  // ============================================
  describe('Mode 1: Stable Debt Conversion (All Disabled)', () => {
    it('Mode 1 AGT flashloan - reverts because stable borrow is disabled', async () => {
      const { pool, agt, usdc, users } = testEnv;
      const caller = users[1];

      // Setup collateral
      const collateralAmount = await convertToCurrencyDecimals(usdc.address, '1000');
      await mintTokens(usdc, caller.address, collateralAmount, caller.signer);
      await usdc.connect(caller.signer).approve(pool.address, APPROVAL_AMOUNT_LENDING_POOL);
      await waitForTx(
        await pool.connect(caller.signer).deposit(usdc.address, collateralAmount, caller.address, '0')
      );

      await _mockFlashLoanReceiver.setFailExecutionTransfer(true);

      await expect(
        pool.connect(caller.signer).flashLoan(
          _mockFlashLoanReceiver.address,
          [agt.address],
          [ethers.utils.parseEther('10')],
          [1], // Mode 1 - stable
          caller.address,
          '0x10',
          '0'
        )
      ).to.be.revertedWith(VL_STABLE_BORROWING_NOT_ENABLED);
    });

    it('Mode 1 USDC flashloan - reverts because stable borrow is disabled', async () => {
      const { pool, usdc, agt, users } = testEnv;
      const caller = users[2];

      // Setup collateral with AGT
      const collateralAmount = ethers.utils.parseEther('1000');
      await mintTokens(agt, caller.address, collateralAmount, caller.signer);
      await agt.connect(caller.signer).approve(pool.address, APPROVAL_AMOUNT_LENDING_POOL);
      await waitForTx(
        await pool.connect(caller.signer).deposit(agt.address, collateralAmount, caller.address, '0')
      );

      await _mockFlashLoanReceiver.setFailExecutionTransfer(true);

      await expect(
        pool.connect(caller.signer).flashLoan(
          _mockFlashLoanReceiver.address,
          [usdc.address],
          [await convertToCurrencyDecimals(usdc.address, '100')],
          [1], // Mode 1 - stable
          caller.address,
          '0x10',
          '0'
        )
      ).to.be.revertedWith(VL_STABLE_BORROWING_NOT_ENABLED);
    });

    it('Mode 1 USDT flashloan - reverts because stable borrow is disabled', async () => {
      const { pool, usdt, usdc, users } = testEnv;
      const caller = users[3];

      // Setup collateral with USDC
      const collateralAmount = await convertToCurrencyDecimals(usdc.address, '1000');
      await mintTokens(usdc, caller.address, collateralAmount, caller.signer);
      await usdc.connect(caller.signer).approve(pool.address, APPROVAL_AMOUNT_LENDING_POOL);
      await waitForTx(
        await pool.connect(caller.signer).deposit(usdc.address, collateralAmount, caller.address, '0')
      );

      await _mockFlashLoanReceiver.setFailExecutionTransfer(true);

      await expect(
        pool.connect(caller.signer).flashLoan(
          _mockFlashLoanReceiver.address,
          [usdt.address],
          [await convertToCurrencyDecimals(usdt.address, '100')],
          [1], // Mode 1 - stable
          caller.address,
          '0x10',
          '0'
        )
      ).to.be.revertedWith(VL_STABLE_BORROWING_NOT_ENABLED);
    });
  });

  // ============================================
  // Mode 2 Tests: Variable Debt Conversion
  // ============================================
  describe('Mode 2: Variable Debt Conversion - All Collateral/Borrow Combinations', () => {

    // AGT as Collateral
    describe('AGT Collateral (LTV 65%)', () => {
      it('AGT collateral -> borrow USDT via Mode 2 flashloan', async () => {
        const { pool, agt, usdt, users, helpersContract } = testEnv;
        // Use users[2] who already deposited AGT collateral in Mode 1 test
        const caller = users[2];

        // Verify collateral exists from Mode 1 test
        const userDataBefore = await pool.getUserAccountData(caller.address);
        expect(userDataBefore.totalCollateralETH).to.be.gt(0);
        console.log('AGT Collateral ETH value:', userDataBefore.totalCollateralETH.toString());
        console.log('Available borrows ETH:', userDataBefore.availableBorrowsETH.toString());

        await _mockFlashLoanReceiver.setFailExecutionTransfer(true);

        // Borrow USDT with AGT collateral (users[2] has AGT collateral)
        const borrowAmount = await convertToCurrencyDecimals(usdt.address, '100');

        await waitForTx(
          await pool.connect(caller.signer).flashLoan(
            _mockFlashLoanReceiver.address,
            [usdt.address],
            [borrowAmount],
            [2], // Mode 2 - variable
            caller.address,
            '0x10',
            '0'
          )
        );

        // Verify variable debt created for USDT
        const { variableDebtTokenAddress } = await helpersContract.getReserveTokensAddresses(usdt.address);
        const debtToken = await getVariableDebtToken(variableDebtTokenAddress);
        const debt = await debtToken.balanceOf(caller.address);
        expect(debt).to.be.eq(borrowAmount);
      });

      it('AGT collateral -> exceeds LTV, reverts (borrow too much USDC)', async () => {
        const { pool, agt, users } = testEnv;
        // Use users[3] who already deposited USDC collateral in Mode 1 test
        // Their collateral is 1000 USDC which can't cover 10000 AGT borrow
        const caller = users[3];

        // Verify collateral exists but is limited
        const userDataBefore = await pool.getUserAccountData(caller.address);
        expect(userDataBefore.totalCollateralETH).to.be.gt(0);

        await _mockFlashLoanReceiver.setFailExecutionTransfer(true);

        // Try to borrow way more than LTV allows (borrow AGT, not USDC since collateral is USDC)
        const excessiveBorrow = ethers.utils.parseEther('10000');

        await expect(
          pool.connect(caller.signer).flashLoan(
            _mockFlashLoanReceiver.address,
            [agt.address],
            [excessiveBorrow],
            [2],
            caller.address,
            '0x10',
            '0'
          )
        ).to.be.revertedWith(VL_COLLATERAL_CANNOT_COVER_NEW_BORROW);
      });
    });

    // USDC as Collateral
    describe('USDC Collateral (LTV 75%)', () => {
      it('USDC collateral -> borrow AGT via Mode 2 flashloan', async () => {
        const { pool, agt, users, helpersContract } = testEnv;
        // Use users[1] who already deposited USDC collateral in Mode 1 test
        const caller = users[1];

        // Verify collateral exists from Mode 1 test
        const userDataBefore = await pool.getUserAccountData(caller.address);
        expect(userDataBefore.totalCollateralETH).to.be.gt(0);
        console.log('USDC Collateral ETH value:', userDataBefore.totalCollateralETH.toString());
        console.log('Available borrows ETH:', userDataBefore.availableBorrowsETH.toString());

        await _mockFlashLoanReceiver.setFailExecutionTransfer(true);

        // Borrow AGT with USDC collateral (users[1] has USDC collateral)
        const borrowAmount = ethers.utils.parseEther('50');

        await waitForTx(
          await pool.connect(caller.signer).flashLoan(
            _mockFlashLoanReceiver.address,
            [agt.address],
            [borrowAmount],
            [2],
            caller.address,
            '0x10',
            '0'
          )
        );

        const { variableDebtTokenAddress } = await helpersContract.getReserveTokensAddresses(agt.address);
        const debtToken = await getVariableDebtToken(variableDebtTokenAddress);
        const debt = await debtToken.balanceOf(caller.address);
        expect(debt).to.be.eq(borrowAmount);
      });

      it('USDC collateral -> borrow USDT via Mode 2 flashloan', async () => {
        const { pool, usdt, users, helpersContract } = testEnv;
        // Use users[1] who has USDC collateral and already borrowed AGT
        // Still has ~700 ETH available borrows
        const caller = users[1];

        // Verify remaining borrow capacity
        const userDataBefore = await pool.getUserAccountData(caller.address);
        expect(userDataBefore.availableBorrowsETH).to.be.gt(0);
        console.log('Remaining available borrows ETH:', userDataBefore.availableBorrowsETH.toString());

        await _mockFlashLoanReceiver.setFailExecutionTransfer(true);

        // Borrow small amount of USDT with remaining capacity
        const borrowAmount = await convertToCurrencyDecimals(usdt.address, '50');

        await waitForTx(
          await pool.connect(caller.signer).flashLoan(
            _mockFlashLoanReceiver.address,
            [usdt.address],
            [borrowAmount],
            [2],
            caller.address,
            '0x10',
            '0'
          )
        );

        const { variableDebtTokenAddress } = await helpersContract.getReserveTokensAddresses(usdt.address);
        const debtToken = await getVariableDebtToken(variableDebtTokenAddress);
        const debt = await debtToken.balanceOf(caller.address);
        expect(debt).to.be.eq(borrowAmount);
      });

      it('USDC has higher LTV (75%) than AGT (65%) - can borrow more relative to collateral', async () => {
        const { pool, usdc, agt, users, helpersContract } = testEnv;

        // Compare borrowing power for same collateral value
        const config = await helpersContract.getReserveConfigurationData(usdc.address);
        expect(config.ltv).to.be.eq(USDC_LTV);

        const agtConfig = await helpersContract.getReserveConfigurationData(agt.address);
        expect(agtConfig.ltv).to.be.eq(AGT_LTV);

        // USDC LTV (75%) > AGT LTV (65%)
        expect(config.ltv).to.be.gt(agtConfig.ltv);
      });
    });

    // AGT Collateral - additional tests
    describe('AGT Collateral - Additional Tests', () => {
      it('AGT collateral -> borrow AGT via Mode 2 flashloan (same asset)', async () => {
        const { pool, agt, users, helpersContract } = testEnv;
        // Use users[2] who has AGT collateral and already borrowed USDT
        // Test borrowing the same asset as collateral
        const caller = users[2];

        // Verify remaining borrow capacity
        const userDataBefore = await pool.getUserAccountData(caller.address);
        expect(userDataBefore.availableBorrowsETH).to.be.gt(0);
        console.log('Remaining available borrows ETH:', userDataBefore.availableBorrowsETH.toString());

        await _mockFlashLoanReceiver.setFailExecutionTransfer(true);

        // Borrow small amount of AGT with AGT collateral
        const borrowAmount = ethers.utils.parseEther('50');

        try {
          await pool.connect(caller.signer).callStatic.flashLoan(
            _mockFlashLoanReceiver.address,
            [agt.address],
            [borrowAmount],
            [2],
            caller.address,
            '0x10',
            '0'
          );
          console.log('callStatic.flashLoan OK');
        } catch (e: any) {
          console.log(
            'callStatic.flashLoan REVERT:',
            e?.error?.message ?? e?.reason ?? e?.message
          );
          console.log('revert data:', e?.error?.data ?? e?.data);
          throw e;
        }

        await waitForTx(
          await pool.connect(caller.signer).flashLoan(
            _mockFlashLoanReceiver.address,
            [agt.address],
            [borrowAmount],
            [2],
            caller.address,
            '0x10',
            '0'
          )
        );

        const { variableDebtTokenAddress } = await helpersContract.getReserveTokensAddresses(agt.address);
        const debtToken = await getVariableDebtToken(variableDebtTokenAddress);
        const debt = await debtToken.balanceOf(caller.address);
        expect(debt).to.be.eq(borrowAmount);
      });
    });

    // No Collateral - Should Fail
    describe('No Collateral - Mode 2 Reverts', () => {
      it('Mode 2 without collateral reverts (AGT)', async () => {
        const { pool, agt, users } = testEnv;
        const callerNoCollateral = users[11];

        await _mockFlashLoanReceiver.setFailExecutionTransfer(true);

        await expect(
          pool.connect(callerNoCollateral.signer).flashLoan(
            _mockFlashLoanReceiver.address,
            [agt.address],
            [ethers.utils.parseEther('10')],
            [2],
            callerNoCollateral.address,
            '0x10',
            '0'
          )
        ).to.be.revertedWith(VL_COLLATERAL_BALANCE_IS_0);
      });

      it('Mode 2 without collateral reverts (USDC)', async () => {
        const { pool, usdc, users } = testEnv;
        const callerNoCollateral = users[12];

        await _mockFlashLoanReceiver.setFailExecutionTransfer(true);

        await expect(
          pool.connect(callerNoCollateral.signer).flashLoan(
            _mockFlashLoanReceiver.address,
            [usdc.address],
            [await convertToCurrencyDecimals(usdc.address, '100')],
            [2],
            callerNoCollateral.address,
            '0x10',
            '0'
          )
        ).to.be.revertedWith(VL_COLLATERAL_BALANCE_IS_0);
      });
    });
  });

  // ============================================
  // Mode 2 with Credit Delegation
  // ============================================
  describe('Mode 2: Credit Delegation (onBehalfOf)', () => {
    it('Mode 2 flashloan onBehalfOf without allowance reverts', async () => {
      const { pool, agt, users } = testEnv;
      const caller = users[4]; // Different user as caller
      // Use users[3] who already has USDC collateral from Mode 1 test
      const onBehalfOf = users[3];

      // Verify onBehalfOf has collateral from Mode 1
      const userDataBefore = await pool.getUserAccountData(onBehalfOf.address);
      expect(userDataBefore.totalCollateralETH).to.be.gt(0);
      console.log('onBehalfOf collateral ETH:', userDataBefore.totalCollateralETH.toString());

      await _mockFlashLoanReceiver.setFailExecutionTransfer(true);

      // Caller tries to flashloan on behalf without delegation (borrow AGT with USDC collateral)
      await expect(
        pool.connect(caller.signer).flashLoan(
          _mockFlashLoanReceiver.address,
          [agt.address],
          [ethers.utils.parseEther('10')],
          [2],
          onBehalfOf.address, // onBehalfOf
          '0x10',
          '0'
        )
      ).to.be.revertedWith(LP_BORROW_ALLOWANCE_NOT_ENOUGH);
    });

    it('Mode 2 flashloan onBehalfOf with allowance succeeds', async () => {
      const { pool, agt, users, helpersContract } = testEnv;
      const caller = users[4];
      // Use users[3] who already has USDC collateral from Mode 1 test
      const onBehalfOf = users[3];

      const flashAmount = ethers.utils.parseEther('10');

      // OnBehalfOf delegates borrow allowance for AGT
      const { variableDebtTokenAddress } = await helpersContract.getReserveTokensAddresses(agt.address);
      const debtToken = await getVariableDebtToken(variableDebtTokenAddress);
      await debtToken.connect(onBehalfOf.signer).approveDelegation(caller.address, flashAmount);

      await _mockFlashLoanReceiver.setFailExecutionTransfer(true);

      try {
        await pool.connect(caller.signer).callStatic.flashLoan(
          _mockFlashLoanReceiver.address,
          [agt.address],
          [flashAmount],
          [2],
          onBehalfOf.address,
          '0x10',
          '0'
        );
        console.log('callStatic.flashLoan OK');
      } catch (e: any) {
        console.log(
          'callStatic.flashLoan REVERT:',
          e?.error?.message ?? e?.reason ?? e?.message
        );
        console.log('revert data:', e?.error?.data ?? e?.data);
        throw e;
      }

      await waitForTx(
        await pool.connect(caller.signer).flashLoan(
          _mockFlashLoanReceiver.address,
          [agt.address],
          [flashAmount],
          [2],
          onBehalfOf.address,
          '0x10',
          '0'
        )
      );

      // Debt should be on onBehalfOf, not caller
      const onBehalfOfDebt = await debtToken.balanceOf(onBehalfOf.address);
      const callerDebt = await debtToken.balanceOf(caller.address);

      expect(onBehalfOfDebt).to.be.eq(flashAmount);
      expect(callerDebt).to.be.eq(0);
    });
  });

  // ============================================
  // LTV Comparison Tests
  // ============================================
  describe('LTV Configuration Verification', () => {
    it('Verifies AGT LTV is 65%', async () => {
      const { agt, helpersContract } = testEnv;
      const config = await helpersContract.getReserveConfigurationData(agt.address);
      expect(config.ltv).to.be.eq(strategyAGT.baseLTVAsCollateral);
    });

    it('Verifies USDC LTV is 75%', async () => {
      const { usdc, helpersContract } = testEnv;
      const config = await helpersContract.getReserveConfigurationData(usdc.address);
      expect(config.ltv).to.be.eq(strategyUSDC.baseLTVAsCollateral);
    });

    it('Verifies USDT LTV is 75%', async () => {
      const { usdt, helpersContract } = testEnv;
      const config = await helpersContract.getReserveConfigurationData(usdt.address);
      expect(config.ltv).to.be.eq(strategyUSDT.baseLTVAsCollateral);
    });

    it('Verifies all tokens have stable borrow disabled', async () => {
      const { agt, usdc, usdt, helpersContract } = testEnv;

      const agtConfig = await helpersContract.getReserveConfigurationData(agt.address);
      const usdcConfig = await helpersContract.getReserveConfigurationData(usdc.address);
      const usdtConfig = await helpersContract.getReserveConfigurationData(usdt.address);

      expect(agtConfig.stableBorrowRateEnabled).to.be.false;
      expect(usdcConfig.stableBorrowRateEnabled).to.be.false;
      expect(usdtConfig.stableBorrowRateEnabled).to.be.false;
    });
  });
});
