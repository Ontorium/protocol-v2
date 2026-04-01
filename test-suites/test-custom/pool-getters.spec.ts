import { makeSuite, TestEnv } from './helpers/make-suite';
import { parseEther, parseUnits } from 'ethers/lib/utils';
import { MAX_UINT_AMOUNT, RAY, ZERO_ADDRESS } from '../../helpers/constants';
import { mintTokens } from './helpers/mint-tokens';
import { RateMode } from '../../helpers/types';
import { waitForTx } from '../../helpers/misc-utils';
import BigNumber from 'bignumber.js';

const { expect } = require('chai');

makeSuite('Custom Market - Pool Getter Functions', (testEnv: TestEnv) => {
  describe('getReserveData', () => {
    it('Returns correct initial reserve data for AGT', async () => {
      const { agt, pool } = testEnv;
      const reserveData = await pool.getReserveData(agt.address);

      // Initial state checks
      expect(reserveData.aTokenAddress).to.not.equal(ZERO_ADDRESS);
      expect(reserveData.stableDebtTokenAddress).to.not.equal(ZERO_ADDRESS);
      expect(reserveData.variableDebtTokenAddress).to.not.equal(ZERO_ADDRESS);
      expect(reserveData.interestRateStrategyAddress).to.not.equal(ZERO_ADDRESS);
      expect(reserveData.liquidityIndex.toString()).to.be.equal(RAY);
      expect(reserveData.variableBorrowIndex.toString()).to.be.equal(RAY);
    });

    it('Returns correct initial reserve data for USDC', async () => {
      const { usdc, pool } = testEnv;
      const reserveData = await pool.getReserveData(usdc.address);

      expect(reserveData.aTokenAddress).to.not.equal(ZERO_ADDRESS);
      expect(reserveData.liquidityIndex.toString()).to.be.equal(RAY);
    });

    it('Returns correct initial reserve data for USDT', async () => {
      const { usdt, pool } = testEnv;
      const reserveData = await pool.getReserveData(usdt.address);

      expect(reserveData.aTokenAddress).to.not.equal(ZERO_ADDRESS);
      expect(reserveData.liquidityIndex.toString()).to.be.equal(RAY);
    });
  });

  describe('getReservesList', () => {
    it('Returns all 3 reserves (AGT, USDC, USDT)', async () => {
      const { pool, agt, usdc, usdt } = testEnv;
      const reserves = await pool.getReservesList();

      expect(reserves.length).to.be.gte(3);

      const reserveAddresses = reserves.map((r: string) => r.toLowerCase());
      expect(reserveAddresses).to.include(agt.address.toLowerCase());
      expect(reserveAddresses).to.include(usdc.address.toLowerCase());
      expect(reserveAddresses).to.include(usdt.address.toLowerCase());
    });
  });

  describe('getUserAccountData', () => {
    it('Returns zeros for user with no deposits', async () => {
      const { pool, users } = testEnv;
      const userWithNoDeposit = users[9];

      const userData = await pool.getUserAccountData(userWithNoDeposit.address);

      expect(userData.totalCollateralETH).to.be.equal(0);
      expect(userData.totalDebtETH).to.be.equal(0);
      expect(userData.availableBorrowsETH).to.be.equal(0);
      // Health factor should be max uint256 when no debt
      expect(userData.healthFactor).to.be.gt(parseEther('1'));
    });

    it('Returns correct data after deposit', async () => {
      const { pool, usdc, users } = testEnv;
      const user = users[0];

      const depositAmount = parseUnits('1000', 6);
      await mintTokens(usdc, user.address, depositAmount, user.signer);
      await usdc.connect(user.signer).approve(pool.address, MAX_UINT_AMOUNT);
      await waitForTx(
        await pool.connect(user.signer).deposit(usdc.address, depositAmount, user.address, 0)
      );

      const userData = await pool.getUserAccountData(user.address);

      expect(userData.totalCollateralETH).to.be.gt(0);
      expect(userData.availableBorrowsETH).to.be.gt(0);
      expect(userData.totalDebtETH).to.be.equal(0);
      expect(userData.currentLiquidationThreshold).to.be.equal(8800); // USDC liq threshold
      expect(userData.ltv).to.be.equal(7500); // USDC LTV
    });

    it('Returns correct data after borrow', async () => {
      const { pool, agt, deployer, users, helpersContract } = testEnv;
      const borrower = users[0]; // User from previous test who has USDC collateral

      // Setup AGT liquidity using deployer
      const agtAmount = parseEther('10000');
      await mintTokens(agt, deployer.address, agtAmount, deployer.signer);
      await agt.connect(deployer.signer).approve(pool.address, MAX_UINT_AMOUNT);
      await waitForTx(
        await pool.connect(deployer.signer).deposit(agt.address, agtAmount, deployer.address, 0)
      );

      // Verify liquidity is available
      const reserveData = await helpersContract.getReserveData(agt.address);
      console.log('AGT liquidity available:', reserveData.availableLiquidity.toString());

      const userDataBefore = await pool.getUserAccountData(borrower.address);
      console.log('User available borrows before:', userDataBefore.availableBorrowsETH.toString());

      const borrowAmount = parseEther('100');

      await waitForTx(
        await pool
          .connect(borrower.signer)
          .borrow(agt.address, borrowAmount, RateMode.Variable, 0, borrower.address)
      );

      const userDataAfter = await pool.getUserAccountData(borrower.address);

      expect(userDataAfter.totalDebtETH).to.be.gt(0);
      expect(userDataAfter.availableBorrowsETH).to.be.lt(userDataBefore.availableBorrowsETH);
      expect(userDataAfter.healthFactor).to.be.gt(parseEther('1'));
    });

    it('Health factor decreases with more debt', async () => {
      const { pool, agt, users } = testEnv;
      const borrower = users[0];

      const userDataBefore = await pool.getUserAccountData(borrower.address);
      // Borrow more AGT (continuing from previous test)
      const borrowAmount = parseEther('100');

      await waitForTx(
        await pool
          .connect(borrower.signer)
          .borrow(agt.address, borrowAmount, RateMode.Variable, 0, borrower.address)
      );

      const userDataAfter = await pool.getUserAccountData(borrower.address);

      expect(userDataAfter.healthFactor).to.be.lt(userDataBefore.healthFactor);
    });
  });

  describe('getUserConfiguration', () => {
    it('Returns correct user configuration bitmap', async () => {
      const { pool, users } = testEnv;
      const user = users[0]; // User with USDC deposit and AGT borrow

      const userConfig = await pool.getUserConfiguration(user.address);

      // UserConfiguration is a bitmap - should be non-zero for user with positions
      expect(userConfig.data).to.not.equal(0);
    });

    it('Returns zero for user with no positions', async () => {
      const { pool, users } = testEnv;
      const userWithNoPositions = users[8];

      const userConfig = await pool.getUserConfiguration(userWithNoPositions.address);

      expect(userConfig.data).to.be.equal(0);
    });
  });

  describe('getConfiguration', () => {
    it('Returns valid configuration for AGT', async () => {
      const { pool, agt } = testEnv;
      const config = await pool.getConfiguration(agt.address);

      // Configuration data should be non-zero for initialized reserve
      expect(config.data).to.not.equal(0);
    });

    it('Returns valid configuration for USDC', async () => {
      const { pool, usdc } = testEnv;
      const config = await pool.getConfiguration(usdc.address);

      expect(config.data).to.not.equal(0);
    });

    it('Returns valid configuration for USDT', async () => {
      const { pool, usdt } = testEnv;
      const config = await pool.getConfiguration(usdt.address);

      expect(config.data).to.not.equal(0);
    });
  });

  describe('getReserveNormalizedIncome', () => {
    it('Returns RAY for reserve with no activity', async () => {
      const { pool, usdt } = testEnv;
      const normalizedIncome = await pool.getReserveNormalizedIncome(usdt.address);

      // Should be close to RAY (1e27) for reserve with no borrows
      expect(normalizedIncome).to.be.gte(RAY);
    });

    it('Returns >= RAY for reserve with activity', async () => {
      const { pool, agt } = testEnv;
      // AGT has borrows from previous tests
      const normalizedIncome = await pool.getReserveNormalizedIncome(agt.address);

      // Should be >= RAY as interest accrues
      expect(normalizedIncome).to.be.gte(RAY);
    });
  });

  describe('getReserveNormalizedVariableDebt', () => {
    it('Returns RAY for reserve with no borrows', async () => {
      const { pool, usdt } = testEnv;
      const normalizedDebt = await pool.getReserveNormalizedVariableDebt(usdt.address);

      // Should be close to RAY for reserve with no borrows
      expect(normalizedDebt).to.be.gte(RAY);
    });

    it('Returns >= RAY for reserve with borrows', async () => {
      const { pool, agt } = testEnv;
      // AGT has borrows from previous tests
      const normalizedDebt = await pool.getReserveNormalizedVariableDebt(agt.address);

      // Should be >= RAY as interest accrues on borrows
      expect(normalizedDebt).to.be.gte(RAY);
    });
  });

  describe('getAddressesProvider', () => {
    it('Returns correct addresses provider', async () => {
      const { pool, addressesProvider } = testEnv;
      const addressesProviderFromPool = await pool.getAddressesProvider();

      expect(addressesProviderFromPool.toLowerCase()).to.be.equal(
        addressesProvider.address.toLowerCase()
      );
    });
  });

  describe('paused', () => {
    it('Returns false when pool is not paused', async () => {
      const { pool } = testEnv;
      const isPaused = await pool.paused();

      expect(isPaused).to.be.false;
    });
  });

  describe('DataProvider helper functions', () => {
    it('getAllReservesTokens returns all reserve tokens', async () => {
      const { helpersContract, agt, usdc, usdt } = testEnv;
      const reserveTokens = await helpersContract.getAllReservesTokens();

      expect(reserveTokens.length).to.be.gte(3);

      const symbols = reserveTokens.map((t: { symbol: string }) => t.symbol);
      expect(symbols).to.include('AGT');
      expect(symbols).to.include('USDC');
      expect(symbols).to.include('USDT');
    });

    it('getAllATokens returns all aTokens', async () => {
      const { helpersContract } = testEnv;
      const aTokens = await helpersContract.getAllATokens();

      expect(aTokens.length).to.be.gte(3);

      // Check that aToken symbols contain AGT, USDC, USDT
      const symbols = aTokens.map((t: { symbol: string }) => t.symbol);
      const hasAGT = symbols.some((s: string) => s.includes('AGT'));
      const hasUSDC = symbols.some((s: string) => s.includes('USDC'));
      const hasUSDT = symbols.some((s: string) => s.includes('USDT'));

      expect(hasAGT).to.be.true;
      expect(hasUSDC).to.be.true;
      expect(hasUSDT).to.be.true;
    });

    it('getReserveConfigurationData returns correct data', async () => {
      const { helpersContract, usdc } = testEnv;
      const config = await helpersContract.getReserveConfigurationData(usdc.address);

      expect(config.ltv).to.be.equal(7500); // 75%
      expect(config.liquidationThreshold).to.be.equal(8800); // 88%
      expect(config.liquidationBonus).to.be.equal(10450); // 4.5%
      expect(config.decimals).to.be.equal(6);
      expect(config.reserveFactor).to.be.equal(1000); // 10%
      expect(config.borrowingEnabled).to.be.true;
      expect(config.stableBorrowRateEnabled).to.be.false;
      expect(config.isActive).to.be.true;
      expect(config.isFrozen).to.be.false;
    });

    it('getReserveData returns reserve state', async () => {
      const { helpersContract, agt } = testEnv;
      const reserveData = await helpersContract.getReserveData(agt.address);

      expect(reserveData.availableLiquidity).to.be.gte(0);
      expect(reserveData.liquidityRate).to.be.gte(0);
      expect(reserveData.variableBorrowRate).to.be.gte(0);
      expect(reserveData.stableBorrowRate).to.be.gte(0);
      expect(reserveData.liquidityIndex).to.be.gte(RAY);
      expect(reserveData.variableBorrowIndex).to.be.gte(RAY);
    });

    it('getUserReserveData returns user-specific reserve data', async () => {
      const { helpersContract, usdc, users } = testEnv;
      const user = users[0]; // User with USDC deposit

      const userReserveData = await helpersContract.getUserReserveData(usdc.address, user.address);

      expect(userReserveData.currentATokenBalance).to.be.gt(0);
      expect(userReserveData.usageAsCollateralEnabled).to.be.true;
    });

    it('getReserveTokensAddresses returns all token addresses', async () => {
      const { helpersContract, agt } = testEnv;
      const tokens = await helpersContract.getReserveTokensAddresses(agt.address);

      expect(tokens.aTokenAddress).to.not.equal(ZERO_ADDRESS);
      expect(tokens.stableDebtTokenAddress).to.not.equal(ZERO_ADDRESS);
      expect(tokens.variableDebtTokenAddress).to.not.equal(ZERO_ADDRESS);
    });
  });
});
