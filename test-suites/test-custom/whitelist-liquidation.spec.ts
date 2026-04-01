import BigNumber from 'bignumber.js';

import { increaseTime } from '../../helpers/misc-utils';
import { APPROVAL_AMOUNT_LENDING_POOL, oneUsd } from '../../helpers/constants';
import { convertToCurrencyDecimals } from '../../helpers/contracts-helpers';
import { makeSuite } from './helpers/make-suite';
import { RateMode } from '../../helpers/types';
import { mintTokens, setAggregatorPrice, setLiquidationWhitelist } from './helpers/mint-tokens';
import { parseEther } from 'ethers/lib/utils';

const chai = require('chai');
const { expect } = chai;

/**
 * Branch coverage tests for _getMaxDebtToLiquidate
 *
 * Decision tree:
 *   1. !whitelist                                          → 50%  (Case 1)
 *   2.  whitelist + HF ≤ 0.95                              → 100% (Case 2)
 *   3.  whitelist + HF > 0.95 + collateralValue < $2000    → 100% (Case 3)
 *   4.  whitelist + HF > 0.95 + collateral ≥ $2000
 *                              + debtValue < $2000         → 100% (Case 4)
 *   5.  whitelist + HF > 0.95 + collateral ≥ $2000
 *                              + debt ≥ $2000              → 50%  (Case 5)
 *   6.  whitelist revoked                                  → 50%  (Case 6)
 */
makeSuite('Whitelist Liquidation: _getMaxDebtToLiquidate branch coverage', (testEnv) => {
  before('BigNumber config', () => {
    BigNumber.config({ DECIMAL_PLACES: 0, ROUNDING_MODE: BigNumber.ROUND_DOWN });
  });

  after('Reset BigNumber config', () => {
    BigNumber.config({ DECIMAL_PLACES: 20, ROUNDING_MODE: BigNumber.ROUND_HALF_UP });
  });

  /**
   * Helper: Verify ~50% liquidation
   * Asserts remaining debt is ~50% of original (1% tolerance)
   */
  const expectFiftyPercentLiquidation = (debtBefore: string, debtAfter: string, message: string) => {
    const before = new BigNumber(debtBefore);
    const after = new BigNumber(debtAfter);
    const expectedRemaining = before.multipliedBy(0.50);
    const tolerance = before.multipliedBy(0.01); // 1%
    const diff = after.minus(expectedRemaining).absoluteValue();
    expect(diff.toString()).to.be.bignumber.lte(tolerance.toFixed(0), message);
  };

  /**
   * Helper: Setup a borrower position (deposit AGT collateral + borrow USDC)
   */
  const setupPosition = async (
    borrowerIndex: number,
    agtAmount: string,
    borrowMultiplier: number = 0.95
  ) => {
    const { usdc, agt, users, pool, oracle } = testEnv;
    const borrower = users[borrowerIndex];

    const amountAGT = await convertToCurrencyDecimals(agt.address, agtAmount);
    await mintTokens(agt, borrower.address, amountAGT, borrower.signer);
    await agt.connect(borrower.signer).approve(pool.address, APPROVAL_AMOUNT_LENDING_POOL);
    await pool.connect(borrower.signer).deposit(agt.address, amountAGT, borrower.address, '0');

    const userData = await pool.getUserAccountData(borrower.address);
    const usdcPrice = await oracle.getAssetPrice(usdc.address);
    const borrowAmount = await convertToCurrencyDecimals(
      usdc.address,
      new BigNumber(userData.availableBorrowsETH.toString())
        .div(usdcPrice.toString())
        .multipliedBy(borrowMultiplier)
        .toFixed(0)
    );
    await pool
      .connect(borrower.signer)
      .borrow(usdc.address, borrowAmount, RateMode.Variable, '0', borrower.address);
  };

  /**
   * Helper: Execute liquidation and return debt before/after
   */
  const executeLiquidation = async (
    borrowerIndex: number,
    liquidatorIndex: number
  ): Promise<{ debtBefore: string; debtAfter: string }> => {
    const { usdc, agt, users, pool, helpersContract } = testEnv;
    const borrower = users[borrowerIndex];
    const liquidator = users[liquidatorIndex];

    const debtBefore = (
      await helpersContract.getUserReserveData(usdc.address, borrower.address)
    ).currentVariableDebt.toString();

    await mintTokens(
      usdc,
      liquidator.address,
      await convertToCurrencyDecimals(usdc.address, '10000'),
      liquidator.signer
    );
    await usdc.connect(liquidator.signer).approve(pool.address, APPROVAL_AMOUNT_LENDING_POOL);

    await increaseTime(100);
    // Pass max uint256 so the contract caps at maxLiquidatableDebt
    // This avoids residual debt from interest accrued between reading and executing
    await pool
      .connect(liquidator.signer)
      .liquidationCall(
        agt.address,
        usdc.address,
        borrower.address,
        APPROVAL_AMOUNT_LENDING_POOL, // uint256 max
        false
      );

    const debtAfter = (
      await helpersContract.getUserReserveData(usdc.address, borrower.address)
    ).currentVariableDebt.toString();

    return { debtBefore, debtAfter };
  };

  // === Shared Setup: USDC liquidity pool ===
  it('Provide USDC liquidity pool', async () => {
    const { usdc, users, pool } = testEnv;
    const depositor = users[0];

    await mintTokens(
      usdc,
      depositor.address,
      await convertToCurrencyDecimals(usdc.address, '50000'),
      depositor.signer
    );
    await usdc.connect(depositor.signer).approve(pool.address, APPROVAL_AMOUNT_LENDING_POOL);
    await pool
      .connect(depositor.signer)
      .deposit(
        usdc.address,
        await convertToCurrencyDecimals(usdc.address, '50000'),
        depositor.address,
        '0'
      );
  });

  // Case 1: Non-whitelisted + HF < 0.95 → 50%
  //   Without whitelist, liquidation is capped at 50% regardless of HF
  it('Case 1 setup: 100 AGT collateral, borrow USDC, drop HF < 0.95', async () => {
    const { usdc, oracle, users, pool } = testEnv;
    await setAggregatorPrice(oracle, usdc.address, oneUsd.toFixed(0));
    await setupPosition(1, '100');

    const usdcPrice = await oracle.getAssetPrice(usdc.address);
    await setAggregatorPrice(
      oracle,
      usdc.address,
      new BigNumber(usdcPrice.toString()).multipliedBy(1.4).toFixed(0)
    );

    const data = await pool.getUserAccountData(users[1].address);
    expect(data.healthFactor.toString()).to.be.bignumber.lt(
      parseEther('0.95').toString(),
      'HF should be < 0.95'
    );
  });

  it('Case 1: Non-whitelisted → 50% despite HF < 0.95', async () => {
    // users[2] is NOT whitelisted
    const { debtBefore, debtAfter } = await executeLiquidation(1, 2);

    expectFiftyPercentLiquidation(
      debtBefore,
      debtAfter,
      'Non-whitelisted should only liquidate 50% even when HF < 0.95'
    );
  });

  // Case 2: Whitelisted + HF ≤ 0.95 → 100%
  it('Case 2 setup: 100 AGT collateral, borrow USDC, drop HF < 0.95', async () => {
    const { usdc, oracle, users, pool } = testEnv;
    await setAggregatorPrice(oracle, usdc.address, oneUsd.toFixed(0));
    await setupPosition(3, '100');

    const usdcPrice = await oracle.getAssetPrice(usdc.address);
    await setAggregatorPrice(
      oracle,
      usdc.address,
      new BigNumber(usdcPrice.toString()).multipliedBy(1.4).toFixed(0)
    );

    const data = await pool.getUserAccountData(users[3].address);
    expect(data.healthFactor.toString()).to.be.bignumber.lt(
      parseEther('0.95').toString(),
      'HF should be < 0.95'
    );
  });

  it('Case 2: Whitelisted + HF ≤ 0.95 → 100% liquidation', async () => {
    const { configurator, addressesProvider, users } = testEnv;
    await setLiquidationWhitelist(configurator, addressesProvider, users[4].address, true);

    const { debtAfter } = await executeLiquidation(3, 4);

    expect(debtAfter).to.be.bignumber.lte(
      '1',
      'Whitelisted + HF ≤ 0.95 should liquidate ~100%'
    );
  });

  // Case 3: Whitelisted + HF > 0.95 + collateral < $2000 → 100%
  //   Collateral value below dust threshold allows full liquidation
  it('Case 3 setup: 100 AGT ($100 collateral < $2000), 0.95 < HF < 1.0', async () => {
    const { usdc, oracle, users, pool } = testEnv;
    await setAggregatorPrice(oracle, usdc.address, oneUsd.toFixed(0));
    await setupPosition(5, '100');

    const usdcPrice = await oracle.getAssetPrice(usdc.address);
    // 1.25x → HF ≈ 0.97
    await setAggregatorPrice(
      oracle,
      usdc.address,
      new BigNumber(usdcPrice.toString()).multipliedBy(1.25).toFixed(0)
    );

    const data = await pool.getUserAccountData(users[5].address);
    expect(data.healthFactor.toString()).to.be.bignumber.lt(
      parseEther('1').toString(),
      'HF should be < 1.0'
    );
    expect(data.healthFactor.toString()).to.be.bignumber.gt(
      parseEther('0.95').toString(),
      'HF should be > 0.95'
    );
  });

  it('Case 3: Whitelisted + collateral < $2000 → 100% liquidation', async () => {
    const { configurator, addressesProvider, users } = testEnv;
    await setLiquidationWhitelist(configurator, addressesProvider, users[6].address, true);

    const { debtAfter } = await executeLiquidation(5, 6);

    expect(debtAfter).to.be.bignumber.lte(
      '1',
      'Whitelisted + collateral dust should liquidate ~100%'
    );
  });

  // Case 4: Whitelisted + HF > 0.95 + collateral ≥ $2000 + debt < $2000 → 100%
  //   Collateral is above threshold but debt is below dust → full liquidation
  //   2500 AGT ($2500) collateral, borrow ~$1543 → after 1.25x debt ~$1929 < $2000
  it('Case 4 setup: 2500 AGT ($2500 collateral ≥ $2000), debt < $2000, 0.95 < HF < 1.0', async () => {
    const { usdc, oracle, users, pool } = testEnv;
    await setAggregatorPrice(oracle, usdc.address, oneUsd.toFixed(0));
    await setupPosition(7, '2500');

    const usdcPrice = await oracle.getAssetPrice(usdc.address);
    // 1.25x → debt ~$1929 (< $2000), collateral $2500 (≥ $2000)
    await setAggregatorPrice(
      oracle,
      usdc.address,
      new BigNumber(usdcPrice.toString()).multipliedBy(1.25).toFixed(0)
    );

    const data = await pool.getUserAccountData(users[7].address);
    expect(data.healthFactor.toString()).to.be.bignumber.lt(
      parseEther('1').toString(),
      'HF should be < 1.0'
    );
    expect(data.healthFactor.toString()).to.be.bignumber.gt(
      parseEther('0.95').toString(),
      'HF should be > 0.95'
    );
  });

  it('Case 4: Whitelisted + debt < $2000 → 100% liquidation', async () => {
    const { configurator, addressesProvider, users } = testEnv;
    await setLiquidationWhitelist(configurator, addressesProvider, users[8].address, true);

    const { debtAfter } = await executeLiquidation(7, 8);

    expect(debtAfter).to.be.bignumber.lte(
      '1',
      'Whitelisted + debt dust should liquidate ~100%'
    );
  });

  // Case 5: Whitelisted + HF > 0.95 + collateral ≥ $2000 + debt ≥ $2000 → 50%
  //   All values above thresholds → capped at 50% even for whitelisted
  //   3000 AGT ($3000) collateral, borrow ~$1852 → after 1.25x debt ~$2316 ≥ $2000
  it('Case 5 setup: 3000 AGT ($3000 collateral ≥ $2000), debt ≥ $2000, 0.95 < HF < 1.0', async () => {
    const { usdc, oracle, users, pool } = testEnv;
    await setAggregatorPrice(oracle, usdc.address, oneUsd.toFixed(0));
    await setupPosition(9, '3000');

    const usdcPrice = await oracle.getAssetPrice(usdc.address);
    // 1.25x → debt ~$2316 (≥ $2000), collateral $3000 (≥ $2000)
    await setAggregatorPrice(
      oracle,
      usdc.address,
      new BigNumber(usdcPrice.toString()).multipliedBy(1.25).toFixed(0)
    );

    const data = await pool.getUserAccountData(users[9].address);
    expect(data.healthFactor.toString()).to.be.bignumber.lt(
      parseEther('1').toString(),
      'HF should be < 1.0'
    );
    expect(data.healthFactor.toString()).to.be.bignumber.gt(
      parseEther('0.95').toString(),
      'HF should be > 0.95'
    );
  });

  it('Case 5: Whitelisted + large position + HF > 0.95 → 50% liquidation', async () => {
    const { configurator, addressesProvider, users } = testEnv;
    await setLiquidationWhitelist(configurator, addressesProvider, users[10].address, true);

    const { debtBefore, debtAfter } = await executeLiquidation(9, 10);

    expectFiftyPercentLiquidation(
      debtBefore,
      debtAfter,
      'Whitelisted + large position + HF > 0.95 should only liquidate 50%'
    );
  });

  // Case 6: Whitelist granted then revoked → 50%
  //   After revocation, liquidation falls back to 50% even when HF < 0.95
  it('Case 6 setup: 100 AGT collateral, borrow USDC, drop HF < 0.95', async () => {
    const { usdc, oracle, users, pool } = testEnv;
    await setAggregatorPrice(oracle, usdc.address, oneUsd.toFixed(0));
    await setupPosition(11, '100');

    const usdcPrice = await oracle.getAssetPrice(usdc.address);
    await setAggregatorPrice(
      oracle,
      usdc.address,
      new BigNumber(usdcPrice.toString()).multipliedBy(1.4).toFixed(0)
    );

    const data = await pool.getUserAccountData(users[11].address);
    expect(data.healthFactor.toString()).to.be.bignumber.lt(
      parseEther('0.95').toString(),
      'HF should be < 0.95'
    );
  });

  it('Case 6: Revoked whitelist → 50% despite HF < 0.95', async () => {
    const { configurator, addressesProvider, users } = testEnv;

    // Grant whitelist then revoke
    await setLiquidationWhitelist(configurator, addressesProvider, users[12].address, true);
    await setLiquidationWhitelist(configurator, addressesProvider, users[12].address, false);

    const { debtBefore, debtAfter } = await executeLiquidation(11, 12);

    expectFiftyPercentLiquidation(
      debtBefore,
      debtAfter,
      'Revoked whitelist should only liquidate 50% even when HF < 0.95'
    );
  });
});
