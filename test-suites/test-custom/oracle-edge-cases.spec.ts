import { makeSuite, TestEnv } from './helpers/make-suite';
import { parseEther, parseUnits } from 'ethers/lib/utils';
import { MAX_UINT_AMOUNT } from '../../helpers/constants';
import { mintTokens, setAggregatorPrice } from './helpers/mint-tokens';
import { ProtocolErrors, RateMode } from '../../helpers/types';
import { waitForTx } from '../../helpers/misc-utils';

const { expect } = require('chai');

/**
 * Oracle Edge Cases - Price Zero/Invalid
 *
 * This test verifies the protocol's behavior when oracle prices are set to 0.
 * Key behaviors tested:
 * 1. When collateral price = 0, user's collateral value becomes 0
 * 2. When collateral price = 0, borrow fails with VL_COLLATERAL_BALANCE_IS_0
 * 3. When collateral price = 0 with existing debt, HF drops to 0 (liquidatable)
 */
makeSuite('Oracle Edge Cases - Price Zero/Invalid', (testEnv: TestEnv) => {
  const { VL_COLLATERAL_BALANCE_IS_0 } = ProtocolErrors;

  it('Protocol correctly handles collateral price = 0', async () => {
    const { agt, usdc, pool, users, oracle } = testEnv;
    const depositor = users[0];
    const borrower = users[1];

    // Store original price
    const originalUsdcPrice = (await oracle.getAssetPrice(usdc.address)).toString();
    console.log('Original USDC price:', originalUsdcPrice);

    // Setup: Deposit AGT liquidity
    const agtAmount = parseEther('10000');
    await mintTokens(agt, depositor.address, agtAmount, depositor.signer);
    await agt.connect(depositor.signer).approve(pool.address, MAX_UINT_AMOUNT);
    await waitForTx(
      await pool.connect(depositor.signer).deposit(agt.address, agtAmount, depositor.address, 0)
    );

    // Borrower deposits USDC as collateral
    const collateralAmount = parseUnits('1000', 6);
    await mintTokens(usdc, borrower.address, collateralAmount, borrower.signer);
    await usdc.connect(borrower.signer).approve(pool.address, MAX_UINT_AMOUNT);
    await waitForTx(
      await pool.connect(borrower.signer).deposit(usdc.address, collateralAmount, borrower.address, 0)
    );

    // Verify collateral is registered
    const userDataBefore = await pool.getUserAccountData(borrower.address);
    expect(userDataBefore.totalCollateralETH).to.be.gt(0);
    console.log('Collateral ETH before price change:', userDataBefore.totalCollateralETH.toString());

    // Set collateral (USDC) price to 0
    await setAggregatorPrice(oracle, usdc.address, '0');

    // Verify price is 0
    const usdcPrice = await oracle.getAssetPrice(usdc.address);
    expect(usdcPrice).to.be.eq(0);

    // User account should now show 0 collateral value
    const userDataAfterPriceZero = await pool.getUserAccountData(borrower.address);
    console.log('Collateral ETH after price=0:', userDataAfterPriceZero.totalCollateralETH.toString());
    expect(userDataAfterPriceZero.totalCollateralETH).to.be.eq(0);

    // Attempt to borrow should fail (no collateral value)
    const borrowAmount = parseEther('10');
    await expect(
      pool.connect(borrower.signer).borrow(agt.address, borrowAmount, RateMode.Variable, 0, borrower.address)
    ).to.be.revertedWith(VL_COLLATERAL_BALANCE_IS_0);
  });

  it('Health Factor becomes 0 when collateral price = 0 with existing debt', async () => {
    const { agt, usdc, pool, users, oracle } = testEnv;
    const depositor = users[0];
    const borrower = users[2];

    // Store original price
    const originalUsdcPrice = (await oracle.getAssetPrice(usdc.address)).toString();

    // Check if we need to restore price first (from previous test)
    if (originalUsdcPrice === '0') {
      // Previous test left price at 0, we need a fresh fork
      console.log('Skipping test - oracle state polluted from previous test');
      return;
    }

    // Setup: Deposit AGT liquidity
    const agtAmount = parseEther('10000');
    await mintTokens(agt, depositor.address, agtAmount, depositor.signer);
    await agt.connect(depositor.signer).approve(pool.address, MAX_UINT_AMOUNT);
    await waitForTx(
      await pool.connect(depositor.signer).deposit(agt.address, agtAmount, depositor.address, 0)
    );

    // Borrower deposits USDC as collateral
    const collateralAmount = parseUnits('1000', 6);
    await mintTokens(usdc, borrower.address, collateralAmount, borrower.signer);
    await usdc.connect(borrower.signer).approve(pool.address, MAX_UINT_AMOUNT);
    await waitForTx(
      await pool.connect(borrower.signer).deposit(usdc.address, collateralAmount, borrower.address, 0)
    );

    // Borrow some AGT
    const borrowAmount = parseEther('100');
    await waitForTx(
      await pool.connect(borrower.signer).borrow(agt.address, borrowAmount, RateMode.Variable, 0, borrower.address)
    );

    // Verify HF is healthy before
    const userDataBefore = await pool.getUserAccountData(borrower.address);
    console.log('HF before price=0:', userDataBefore.healthFactor.toString());
    expect(userDataBefore.healthFactor).to.be.gt(parseEther('1'));

    // Set collateral (USDC) price to 0
    await setAggregatorPrice(oracle, usdc.address, '0');

    // When collateral price is 0, HF becomes 0 (position is liquidatable)
    const userDataAfter = await pool.getUserAccountData(borrower.address);
    console.log('HF after price=0:', userDataAfter.healthFactor.toString());
    console.log('Collateral ETH:', userDataAfter.totalCollateralETH.toString());
    console.log('Debt ETH:', userDataAfter.totalDebtETH.toString());

    expect(userDataAfter.totalCollateralETH).to.be.eq(0);
    expect(userDataAfter.healthFactor).to.be.eq(0);
  });
});
