import BigNumber from 'bignumber.js';
import hre from 'hardhat';
import { parseEther } from 'ethers/lib/utils';

import { APPROVAL_AMOUNT_LENDING_POOL, oneEther, ZERO_ADDRESS } from '../../helpers/constants';
import { convertToCurrencyDecimals } from '../../helpers/contracts-helpers';
import { RateMode } from '../../helpers/types';
import { increaseTime, waitForTx } from '../../helpers/misc-utils';
import { makeSuite, TestEnv } from './helpers/make-suite';
import {
  getAddressesProviderOwnerSigner,
  getOracleOwnerSigner,
  mintTokens,
  setAggregatorPrice,
  stopImpersonatingAddressesProviderOwner,
  stopImpersonatingOracleOwner,
} from './helpers/mint-tokens';

const { expect } = require('chai');

const REENTRANT_CALL = 'REENTRANT_CALL';
const ORACLE_PRICE_STALE = '81';
const LP_PRICE_ORACLE_SENTINEL_CHECK_FAILED = '82';
const STABILIZATION_WINDOW = 3600;

const deploySequencerUptimeFeed = async (answer: number, startedAt: number) => {
  const factory = await hre.ethers.getContractFactory('MockSequencerUptimeFeed');
  const feed = await factory.deploy(answer, startedAt);
  await feed.deployed();
  return feed;
};

const deployMockAggregator = async (answer: string | number, decimals: number = 8) => {
  const factory = await hre.ethers.getContractFactory('MockAggregator');
  const aggregator = await factory.deploy(answer, decimals);
  await aggregator.deployed();
  return aggregator;
};

const setPriceOracleSentinel = async (testEnv: TestEnv, sentinelAddress: string) => {
  const ownerSigner = await getAddressesProviderOwnerSigner(testEnv.addressesProvider);
  const provider = new hre.ethers.Contract(
    testEnv.addressesProvider.address,
    ['function setPriceOracleSentinel(address sentinel) external'],
    ownerSigner
  );

  await waitForTx(await provider.setPriceOracleSentinel(sentinelAddress));
  await stopImpersonatingAddressesProviderOwner(testEnv.addressesProvider);
};

const deploySentinel = async (testEnv: TestEnv, feedAddress: string) => {
  const factory = await hre.ethers.getContractFactory('PriceOracleSentinel');
  const sentinel = await factory.deploy(
    testEnv.addressesProvider.address,
    feedAddress,
    STABILIZATION_WINDOW
  );
  await sentinel.deployed();

  await setPriceOracleSentinel(testEnv, sentinel.address);
  return sentinel;
};

const provideLiquidity = async (
  testEnv: TestEnv,
  depositorIndex: number,
  token: any,
  amount: string
) => {
  const depositor = testEnv.users[depositorIndex];
  const liquidityAmount = await convertToCurrencyDecimals(token.address, amount);

  await mintTokens(token, depositor.address, liquidityAmount, depositor.signer);
  await token.connect(depositor.signer).approve(testEnv.pool.address, APPROVAL_AMOUNT_LENDING_POOL);
  await waitForTx(
    await testEnv.pool
      .connect(depositor.signer)
      .deposit(token.address, liquidityAmount, depositor.address, 0)
  );
};

const depositCollateral = async (
  testEnv: TestEnv,
  userIndex: number,
  token: any,
  amount: string
) => {
  const user = testEnv.users[userIndex];
  const collateralAmount = await convertToCurrencyDecimals(token.address, amount);

  await mintTokens(token, user.address, collateralAmount, user.signer);
  await token.connect(user.signer).approve(testEnv.pool.address, APPROVAL_AMOUNT_LENDING_POOL);
  await waitForTx(
    await testEnv.pool.connect(user.signer).deposit(token.address, collateralAmount, user.address, 0)
  );
};

const setupUsdcBorrowPosition = async (
  testEnv: TestEnv,
  borrowerIndex: number,
  collateralAmount: string,
  borrowMultiplier: number = 0.95
) => {
  const { oxau, usdc, oracle, pool, users } = testEnv;
  const borrower = users[borrowerIndex];

  await depositCollateral(testEnv, borrowerIndex, oxau, collateralAmount);

  const userData = await pool.getUserAccountData(borrower.address);
  const usdcPrice = await oracle.getAssetPrice(usdc.address);
  const borrowAmount = await convertToCurrencyDecimals(
    usdc.address,
    new BigNumber(userData.availableBorrowsETH.toString())
      .div(usdcPrice.toString())
      .multipliedBy(borrowMultiplier)
      .toFixed(0)
  );

  await waitForTx(
    await pool
      .connect(borrower.signer)
      .borrow(usdc.address, borrowAmount, RateMode.Variable, 0, borrower.address)
  );

  return borrowAmount;
};

makeSuite('Protocol safety checks', (testEnv: TestEnv) => {
  afterEach(async () => {
    await setPriceOracleSentinel(testEnv, ZERO_ADDRESS);
  });

  it('blocks reentrant liquidation calls', async () => {
    const { pool, addressesProvider } = testEnv;
    const caller = testEnv.users[0];
    const originalManager = await addressesProvider.getLendingPoolCollateralManager();

    const factory = await hre.ethers.getContractFactory('ReentrantLiquidationManager');
    const maliciousManager = await factory.deploy();
    await maliciousManager.deployed();

    const ownerSigner = await getAddressesProviderOwnerSigner(addressesProvider);
    const provider = new hre.ethers.Contract(
      addressesProvider.address,
      ['function setLendingPoolCollateralManager(address manager) external'],
      ownerSigner
    );
    await waitForTx(await provider.setLendingPoolCollateralManager(maliciousManager.address));
    await stopImpersonatingAddressesProviderOwner(addressesProvider);

    await expect(
      pool
        .connect(caller.signer)
        .liquidationCall(ZERO_ADDRESS, ZERO_ADDRESS, caller.address, parseEther('1'), false)
    ).to.be.revertedWith(REENTRANT_CALL);

    const restoreSigner = await getAddressesProviderOwnerSigner(addressesProvider);
    const restoreProvider = new hre.ethers.Contract(
      addressesProvider.address,
      ['function setLendingPoolCollateralManager(address manager) external'],
      restoreSigner
    );
    await waitForTx(await restoreProvider.setLendingPoolCollateralManager(originalManager));
    await stopImpersonatingAddressesProviderOwner(addressesProvider);
  });

  it('blocks borrow while the sequencer is down and until the stabilization window passes', async () => {
    const { oxau, usdc, users, pool } = testEnv;
    const borrower = users[2];

    await provideLiquidity(testEnv, 1, usdc, '50000');
    await depositCollateral(testEnv, 2, oxau, '100');

    const now = (await hre.ethers.provider.getBlock('latest')).timestamp;
    const downFeed = await deploySequencerUptimeFeed(1, now);
    await deploySentinel(testEnv, downFeed.address);

    const blockedBorrowAmount = await convertToCurrencyDecimals(usdc.address, '100');
    await expect(
      pool
        .connect(borrower.signer)
        .borrow(usdc.address, blockedBorrowAmount, RateMode.Variable, 0, borrower.address)
    ).to.be.revertedWith(LP_PRICE_ORACLE_SENTINEL_CHECK_FAILED);

    const recoveredAt = (await hre.ethers.provider.getBlock('latest')).timestamp;
    await waitForTx(await downFeed.setLatestRoundData(0, recoveredAt));

    await expect(
      pool
        .connect(borrower.signer)
        .borrow(usdc.address, blockedBorrowAmount, RateMode.Variable, 0, borrower.address)
    ).to.be.revertedWith(LP_PRICE_ORACLE_SENTINEL_CHECK_FAILED);

    await increaseTime(STABILIZATION_WINDOW + 1);

    await waitForTx(
      await pool
        .connect(borrower.signer)
        .borrow(usdc.address, blockedBorrowAmount, RateMode.Variable, 0, borrower.address)
    );
  });

  it('blocks liquidation when the sequencer sentinel rejects and health factor is above the bypass threshold', async () => {
    const { oxau, usdc, oracle, pool, users } = testEnv;
    const borrower = users[4];
    const liquidator = users[5];

    await provideLiquidity(testEnv, 3, usdc, '50000');
    await setupUsdcBorrowPosition(testEnv, 4, '100');

    const userDataBefore = await pool.getUserAccountData(borrower.address);
    const targetHealthFactor = new BigNumber(parseEther('0.97').toString());
    const usdcPrice = new BigNumber((await oracle.getAssetPrice(usdc.address)).toString());
    const priceMultiplier = new BigNumber(userDataBefore.healthFactor.toString()).div(
      targetHealthFactor
    );
    await setAggregatorPrice(
      oracle,
      usdc.address,
      usdcPrice.multipliedBy(priceMultiplier).integerValue(BigNumber.ROUND_UP).toFixed(0)
    );

    const userData = await pool.getUserAccountData(borrower.address);
    expect(userData.healthFactor.toString()).to.be.bignumber.lt(parseEther('1').toString());
    expect(userData.healthFactor.toString()).to.be.bignumber.gte(parseEther('0.95').toString());

    const now = (await hre.ethers.provider.getBlock('latest')).timestamp;
    const downFeed = await deploySequencerUptimeFeed(1, now);
    await deploySentinel(testEnv, downFeed.address);

    const liquidatorAmount = await convertToCurrencyDecimals(usdc.address, '10000');
    await mintTokens(usdc, liquidator.address, liquidatorAmount, liquidator.signer);
    await usdc.connect(liquidator.signer).approve(pool.address, APPROVAL_AMOUNT_LENDING_POOL);

    await expect(
      pool
        .connect(liquidator.signer)
        .liquidationCall(
          oxau.address,
          usdc.address,
          borrower.address,
          APPROVAL_AMOUNT_LENDING_POOL,
          false
        )
    ).to.be.revertedWith(LP_PRICE_ORACLE_SENTINEL_CHECK_FAILED);
  });

  it('allows liquidation when health factor is below the sentinel bypass threshold even if the sequencer is down', async () => {
    const { oxau, usdc, oracle, pool, users, helpersContract } = testEnv;
    const borrower = users[6];
    const liquidator = users[7];

    await provideLiquidity(testEnv, 3, usdc, '50000');
    await setupUsdcBorrowPosition(testEnv, 6, '100');

    const userDataBefore = await pool.getUserAccountData(borrower.address);
    const targetHealthFactor = new BigNumber(parseEther('0.94').toString());
    const usdcPrice = new BigNumber((await oracle.getAssetPrice(usdc.address)).toString());
    const priceMultiplier = new BigNumber(userDataBefore.healthFactor.toString()).div(
      targetHealthFactor
    );
    await setAggregatorPrice(
      oracle,
      usdc.address,
      usdcPrice.multipliedBy(priceMultiplier).integerValue(BigNumber.ROUND_UP).toFixed(0)
    );

    const userData = await pool.getUserAccountData(borrower.address);
    expect(userData.healthFactor.toString()).to.be.bignumber.lt(parseEther('0.95').toString());

    const now = (await hre.ethers.provider.getBlock('latest')).timestamp;
    const downFeed = await deploySequencerUptimeFeed(1, now);
    await deploySentinel(testEnv, downFeed.address);

    const liquidatorAmount = await convertToCurrencyDecimals(usdc.address, '10000');
    await mintTokens(usdc, liquidator.address, liquidatorAmount, liquidator.signer);
    await usdc.connect(liquidator.signer).approve(pool.address, APPROVAL_AMOUNT_LENDING_POOL);

    const debtBefore = (
      await helpersContract.getUserReserveData(usdc.address, borrower.address)
    ).currentVariableDebt;

    await waitForTx(
      await pool
        .connect(liquidator.signer)
        .liquidationCall(
          oxau.address,
          usdc.address,
          borrower.address,
          APPROVAL_AMOUNT_LENDING_POOL,
          false
        )
    );

    const debtAfter = (
      await helpersContract.getUserReserveData(usdc.address, borrower.address)
    ).currentVariableDebt;

    expect(debtAfter.lt(debtBefore)).to.be.true;
  });

  it('reverts when an AaveOracle source is stale', async () => {
    const aggregator = await deployMockAggregator(oneEther.toFixed(), 8);
    const factory = await hre.ethers.getContractFactory('AaveOracle');
    const staleOracle = await factory.deploy(
      [testEnv.oxau.address],
      [aggregator.address],
      testEnv.oracle.address,
      ZERO_ADDRESS,
      oneEther.toFixed()
    );
    await staleOracle.deployed();

    const oracleOwnerSigner = await getOracleOwnerSigner(staleOracle);
    const oracleContract = new hre.ethers.Contract(
      staleOracle.address,
      [
        'function setAssetStaleTimes(address[] calldata assets, uint256[] calldata staleTimes) external',
        'function getAssetPrice(address asset) external view returns (uint256)',
      ],
      oracleOwnerSigner
    );

    await waitForTx(await oracleContract.setAssetStaleTimes([testEnv.oxau.address], [3600]));
    await stopImpersonatingOracleOwner(staleOracle);

    await increaseTime(3601);

    await expect(oracleContract.getAssetPrice(testEnv.oxau.address)).to.be.revertedWith(
      ORACLE_PRICE_STALE
    );
  });
});
