import { makeSuite, TestEnv } from './helpers/make-suite';
import { strategyOXAU, strategyUSDC, strategyUSDT } from '../../markets/custom/reservesConfigs';

const { expect } = require('chai');

/**
 * Tests to verify that deployed reserve configurations match the expected values
 * from markets/custom/reservesConfigs.ts
 */
makeSuite('Custom Market - Reserve Configuration Validation', (testEnv: TestEnv) => {
  describe('OXAU Reserve Configuration', () => {
    it('Should have correct LTV (65%)', async () => {
      const { oxau, helpersContract } = testEnv;
      const config = await helpersContract.getReserveConfigurationData(oxau.address);
      expect(config.ltv.toString()).to.be.equal(strategyOXAU.baseLTVAsCollateral);
    });

    it('Should have correct liquidation threshold (75%)', async () => {
      const { oxau, helpersContract } = testEnv;
      const config = await helpersContract.getReserveConfigurationData(oxau.address);
      expect(config.liquidationThreshold.toString()).to.be.equal(strategyOXAU.liquidationThreshold);
    });

    it('Should have correct liquidation bonus (5%)', async () => {
      const { oxau, helpersContract } = testEnv;
      const config = await helpersContract.getReserveConfigurationData(oxau.address);
      expect(config.liquidationBonus.toString()).to.be.equal(strategyOXAU.liquidationBonus);
    });

    it('Should have borrowing enabled', async () => {
      const { oxau, helpersContract } = testEnv;
      const config = await helpersContract.getReserveConfigurationData(oxau.address);
      expect(config.borrowingEnabled).to.be.equal(strategyOXAU.borrowingEnabled);
    });

    it('Should have stable borrow rate disabled', async () => {
      const { oxau, helpersContract } = testEnv;
      const config = await helpersContract.getReserveConfigurationData(oxau.address);
      expect(config.stableBorrowRateEnabled).to.be.equal(strategyOXAU.stableBorrowRateEnabled);
    });

    it('Should have correct decimals (18)', async () => {
      const { oxau, helpersContract } = testEnv;
      const config = await helpersContract.getReserveConfigurationData(oxau.address);
      expect(config.decimals.toString()).to.be.equal(strategyOXAU.reserveDecimals);
    });

    it('Should have correct reserve factor (10%)', async () => {
      const { oxau, helpersContract } = testEnv;
      const config = await helpersContract.getReserveConfigurationData(oxau.address);
      expect(config.reserveFactor.toString()).to.be.equal(strategyOXAU.reserveFactor);
    });

    it('Should be active', async () => {
      const { oxau, helpersContract } = testEnv;
      const config = await helpersContract.getReserveConfigurationData(oxau.address);
      expect(config.isActive).to.be.true;
    });

    it('Should not be frozen', async () => {
      const { oxau, helpersContract } = testEnv;
      const config = await helpersContract.getReserveConfigurationData(oxau.address);
      expect(config.isFrozen).to.be.false;
    });
  });

  describe('USDC Reserve Configuration', () => {
    it('Should have correct LTV (75%)', async () => {
      const { usdc, helpersContract } = testEnv;
      const config = await helpersContract.getReserveConfigurationData(usdc.address);
      expect(config.ltv.toString()).to.be.equal(strategyUSDC.baseLTVAsCollateral);
    });

    it('Should have correct liquidation threshold (88%)', async () => {
      const { usdc, helpersContract } = testEnv;
      const config = await helpersContract.getReserveConfigurationData(usdc.address);
      expect(config.liquidationThreshold.toString()).to.be.equal(strategyUSDC.liquidationThreshold);
    });

    it('Should have correct liquidation bonus (4.5%)', async () => {
      const { usdc, helpersContract } = testEnv;
      const config = await helpersContract.getReserveConfigurationData(usdc.address);
      expect(config.liquidationBonus.toString()).to.be.equal(strategyUSDC.liquidationBonus);
    });

    it('Should have borrowing enabled', async () => {
      const { usdc, helpersContract } = testEnv;
      const config = await helpersContract.getReserveConfigurationData(usdc.address);
      expect(config.borrowingEnabled).to.be.equal(strategyUSDC.borrowingEnabled);
    });

    it('Should have stable borrow rate disabled', async () => {
      const { usdc, helpersContract } = testEnv;
      const config = await helpersContract.getReserveConfigurationData(usdc.address);
      expect(config.stableBorrowRateEnabled).to.be.equal(strategyUSDC.stableBorrowRateEnabled);
    });

    it('Should have correct decimals (6)', async () => {
      const { usdc, helpersContract } = testEnv;
      const config = await helpersContract.getReserveConfigurationData(usdc.address);
      expect(config.decimals.toString()).to.be.equal(strategyUSDC.reserveDecimals);
    });

    it('Should have correct reserve factor (10%)', async () => {
      const { usdc, helpersContract } = testEnv;
      const config = await helpersContract.getReserveConfigurationData(usdc.address);
      expect(config.reserveFactor.toString()).to.be.equal(strategyUSDC.reserveFactor);
    });

    it('Should be active', async () => {
      const { usdc, helpersContract } = testEnv;
      const config = await helpersContract.getReserveConfigurationData(usdc.address);
      expect(config.isActive).to.be.true;
    });

    it('Should not be frozen', async () => {
      const { usdc, helpersContract } = testEnv;
      const config = await helpersContract.getReserveConfigurationData(usdc.address);
      expect(config.isFrozen).to.be.false;
    });
  });

  describe('USDT Reserve Configuration', () => {
    it('Should have correct LTV (75%)', async () => {
      const { usdt, helpersContract } = testEnv;
      const config = await helpersContract.getReserveConfigurationData(usdt.address);
      expect(config.ltv.toString()).to.be.equal(strategyUSDT.baseLTVAsCollateral);
    });

    it('Should have correct liquidation threshold (88%)', async () => {
      const { usdt, helpersContract } = testEnv;
      const config = await helpersContract.getReserveConfigurationData(usdt.address);
      expect(config.liquidationThreshold.toString()).to.be.equal(strategyUSDT.liquidationThreshold);
    });

    it('Should have correct liquidation bonus (4.5%)', async () => {
      const { usdt, helpersContract } = testEnv;
      const config = await helpersContract.getReserveConfigurationData(usdt.address);
      expect(config.liquidationBonus.toString()).to.be.equal(strategyUSDT.liquidationBonus);
    });

    it('Should have borrowing enabled', async () => {
      const { usdt, helpersContract } = testEnv;
      const config = await helpersContract.getReserveConfigurationData(usdt.address);
      expect(config.borrowingEnabled).to.be.equal(strategyUSDT.borrowingEnabled);
    });

    it('Should have stable borrow rate disabled', async () => {
      const { usdt, helpersContract } = testEnv;
      const config = await helpersContract.getReserveConfigurationData(usdt.address);
      expect(config.stableBorrowRateEnabled).to.be.equal(strategyUSDT.stableBorrowRateEnabled);
    });

    it('Should have correct decimals (6)', async () => {
      const { usdt, helpersContract } = testEnv;
      const config = await helpersContract.getReserveConfigurationData(usdt.address);
      expect(config.decimals.toString()).to.be.equal(strategyUSDT.reserveDecimals);
    });

    it('Should have correct reserve factor (10%)', async () => {
      const { usdt, helpersContract } = testEnv;
      const config = await helpersContract.getReserveConfigurationData(usdt.address);
      expect(config.reserveFactor.toString()).to.be.equal(strategyUSDT.reserveFactor);
    });

    it('Should be active', async () => {
      const { usdt, helpersContract } = testEnv;
      const config = await helpersContract.getReserveConfigurationData(usdt.address);
      expect(config.isActive).to.be.true;
    });

    it('Should not be frozen', async () => {
      const { usdt, helpersContract } = testEnv;
      const config = await helpersContract.getReserveConfigurationData(usdt.address);
      expect(config.isFrozen).to.be.false;
    });
  });

  describe('Cross-asset Configuration Comparison', () => {
    it('OXAU should have lower LTV than stablecoins', async () => {
      const { oxau, usdc, helpersContract } = testEnv;
      const oxauConfig = await helpersContract.getReserveConfigurationData(oxau.address);
      const usdcConfig = await helpersContract.getReserveConfigurationData(usdc.address);

      expect(oxauConfig.ltv).to.be.lt(usdcConfig.ltv);
    });

    it('OXAU should have lower liquidation threshold than stablecoins', async () => {
      const { oxau, usdc, helpersContract } = testEnv;
      const oxauConfig = await helpersContract.getReserveConfigurationData(oxau.address);
      const usdcConfig = await helpersContract.getReserveConfigurationData(usdc.address);

      expect(oxauConfig.liquidationThreshold).to.be.lt(usdcConfig.liquidationThreshold);
    });

    it('OXAU should have higher liquidation bonus than stablecoins (more volatile)', async () => {
      const { oxau, usdc, helpersContract } = testEnv;
      const oxauConfig = await helpersContract.getReserveConfigurationData(oxau.address);
      const usdcConfig = await helpersContract.getReserveConfigurationData(usdc.address);

      expect(oxauConfig.liquidationBonus).to.be.gt(usdcConfig.liquidationBonus);
    });

    it('USDC and USDT should have identical configurations', async () => {
      const { usdc, usdt, helpersContract } = testEnv;
      const usdcConfig = await helpersContract.getReserveConfigurationData(usdc.address);
      const usdtConfig = await helpersContract.getReserveConfigurationData(usdt.address);

      expect(usdcConfig.ltv).to.be.equal(usdtConfig.ltv);
      expect(usdcConfig.liquidationThreshold).to.be.equal(usdtConfig.liquidationThreshold);
      expect(usdcConfig.liquidationBonus).to.be.equal(usdtConfig.liquidationBonus);
      expect(usdcConfig.decimals).to.be.equal(usdtConfig.decimals);
      expect(usdcConfig.reserveFactor).to.be.equal(usdtConfig.reserveFactor);
    });

    it('All reserves should have stable borrow rate disabled', async () => {
      const { oxau, usdc, usdt, helpersContract } = testEnv;

      const oxauConfig = await helpersContract.getReserveConfigurationData(oxau.address);
      const usdcConfig = await helpersContract.getReserveConfigurationData(usdc.address);
      const usdtConfig = await helpersContract.getReserveConfigurationData(usdt.address);

      expect(oxauConfig.stableBorrowRateEnabled).to.be.false;
      expect(usdcConfig.stableBorrowRateEnabled).to.be.false;
      expect(usdtConfig.stableBorrowRateEnabled).to.be.false;
    });

    it('All reserves should have the same reserve factor', async () => {
      const { oxau, usdc, usdt, helpersContract } = testEnv;

      const agtConfig = await helpersContract.getReserveConfigurationData(oxau.address);
      const usdcConfig = await helpersContract.getReserveConfigurationData(usdc.address);
      const usdtConfig = await helpersContract.getReserveConfigurationData(usdt.address);

      expect(agtConfig.reserveFactor).to.be.equal(usdcConfig.reserveFactor);
      expect(usdcConfig.reserveFactor).to.be.equal(usdtConfig.reserveFactor);
    });
  });

  describe('Reserve Token Addresses', () => {
    it('All reserves should have valid aToken addresses', async () => {
      const { oxau, usdc, usdt, helpersContract } = testEnv;

      const agtTokens = await helpersContract.getReserveTokensAddresses(oxau.address);
      const usdcTokens = await helpersContract.getReserveTokensAddresses(usdc.address);
      const usdtTokens = await helpersContract.getReserveTokensAddresses(usdt.address);

      expect(agtTokens.aTokenAddress).to.not.equal('0x0000000000000000000000000000000000000000');
      expect(usdcTokens.aTokenAddress).to.not.equal('0x0000000000000000000000000000000000000000');
      expect(usdtTokens.aTokenAddress).to.not.equal('0x0000000000000000000000000000000000000000');
    });

    it('All reserves should have valid variable debt token addresses', async () => {
      const { oxau, usdc, usdt, helpersContract } = testEnv;

      const agtTokens = await helpersContract.getReserveTokensAddresses(oxau.address);
      const usdcTokens = await helpersContract.getReserveTokensAddresses(usdc.address);
      const usdtTokens = await helpersContract.getReserveTokensAddresses(usdt.address);

      expect(agtTokens.variableDebtTokenAddress).to.not.equal('0x0000000000000000000000000000000000000000');
      expect(usdcTokens.variableDebtTokenAddress).to.not.equal('0x0000000000000000000000000000000000000000');
      expect(usdtTokens.variableDebtTokenAddress).to.not.equal('0x0000000000000000000000000000000000000000');
    });

    it('All reserves should have valid stable debt token addresses', async () => {
      const { oxau, usdc, usdt, helpersContract } = testEnv;

      const agtTokens = await helpersContract.getReserveTokensAddresses(oxau.address);
      const usdcTokens = await helpersContract.getReserveTokensAddresses(usdc.address);
      const usdtTokens = await helpersContract.getReserveTokensAddresses(usdt.address);

      // Stable debt tokens exist even if stable borrowing is disabled
      expect(agtTokens.stableDebtTokenAddress).to.not.equal('0x0000000000000000000000000000000000000000');
      expect(usdcTokens.stableDebtTokenAddress).to.not.equal('0x0000000000000000000000000000000000000000');
      expect(usdtTokens.stableDebtTokenAddress).to.not.equal('0x0000000000000000000000000000000000000000');
    });
  });
});
