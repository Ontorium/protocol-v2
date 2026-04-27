import { TestEnv, makeSuite } from './helpers/make-suite';
import { APPROVAL_AMOUNT_LENDING_POOL, RAY } from '../../helpers/constants';
import { convertToCurrencyDecimals } from '../../helpers/contracts-helpers';
import { ProtocolErrors } from '../../helpers/types';
import { strategyOXAU, strategyUSDC } from '../../markets/custom/reservesConfigs';
import { mintTokens, getAdminSigner } from './helpers/mint-tokens';

const { expect } = require('chai');

makeSuite('LendingPoolConfigurator', (testEnv: TestEnv) => {
  const {
    CALLER_NOT_POOL_ADMIN,
    LPC_RESERVE_LIQUIDITY_NOT_0,
    RC_INVALID_LTV,
    RC_INVALID_LIQ_THRESHOLD,
    RC_INVALID_LIQ_BONUS,
    RC_INVALID_DECIMALS,
    RC_INVALID_RESERVE_FACTOR,
  } = ProtocolErrors;

  it('Reverts trying to set an invalid reserve factor', async () => {
    const { configurator, oxau, addressesProvider } = testEnv;
    const adminSigner = await getAdminSigner(addressesProvider);

    const invalidReserveFactor = 65536;

    await expect(
      configurator.connect(adminSigner).setReserveFactor(oxau.address, invalidReserveFactor)
    ).to.be.revertedWith(RC_INVALID_RESERVE_FACTOR);
  });

  it('Deactivates the OXAU reserve', async () => {
    const { configurator, oxau, helpersContract, addressesProvider } = testEnv;
    const adminSigner = await getAdminSigner(addressesProvider);

    await configurator.connect(adminSigner).deactivateReserve(oxau.address);
    const { isActive } = await helpersContract.getReserveConfigurationData(oxau.address);
    expect(isActive).to.be.equal(false);
  });

  it('Reactivates the OXAU reserve', async () => {
    const { configurator, oxau, helpersContract, addressesProvider } = testEnv;
    const adminSigner = await getAdminSigner(addressesProvider);

    await configurator.connect(adminSigner).activateReserve(oxau.address);

    const { isActive } = await helpersContract.getReserveConfigurationData(oxau.address);
    expect(isActive).to.be.equal(true);
  });

  it('Check the onlyAaveAdmin on deactivateReserve ', async () => {
    const { configurator, users, oxau } = testEnv;
    await expect(
      configurator.connect(users[2].signer).deactivateReserve(oxau.address),
      CALLER_NOT_POOL_ADMIN
    ).to.be.revertedWith(CALLER_NOT_POOL_ADMIN);
  });

  it('Check the onlyAaveAdmin on activateReserve ', async () => {
    const { configurator, users, oxau } = testEnv;
    await expect(
      configurator.connect(users[2].signer).activateReserve(oxau.address),
      CALLER_NOT_POOL_ADMIN
    ).to.be.revertedWith(CALLER_NOT_POOL_ADMIN);
  });

  it('Freezes the OXAU reserve', async () => {
    const { configurator, oxau, helpersContract, addressesProvider } = testEnv;
    const adminSigner = await getAdminSigner(addressesProvider);

    await configurator.connect(adminSigner).freezeReserve(oxau.address);
    const {
      decimals,
      ltv,
      liquidationBonus,
      liquidationThreshold,
      reserveFactor,
      stableBorrowRateEnabled,
      borrowingEnabled,
      isActive,
      isFrozen,
    } = await helpersContract.getReserveConfigurationData(oxau.address);

    expect(borrowingEnabled).to.be.equal(true);
    expect(isActive).to.be.equal(true);
    expect(isFrozen).to.be.equal(true);
    expect(decimals).to.be.equal(strategyOXAU.reserveDecimals);
    expect(ltv).to.be.equal(strategyOXAU.baseLTVAsCollateral);
    expect(liquidationThreshold).to.be.equal(strategyOXAU.liquidationThreshold);
    expect(liquidationBonus).to.be.equal(strategyOXAU.liquidationBonus);
    expect(stableBorrowRateEnabled).to.be.equal(strategyOXAU.stableBorrowRateEnabled);
    expect(reserveFactor).to.be.equal(strategyOXAU.reserveFactor);
  });

  it('Unfreezes the OXAU reserve', async () => {
    const { configurator, helpersContract, oxau, addressesProvider } = testEnv;
    const adminSigner = await getAdminSigner(addressesProvider);

    await configurator.connect(adminSigner).unfreezeReserve(oxau.address);

    const {
      decimals,
      ltv,
      liquidationBonus,
      liquidationThreshold,
      reserveFactor,
      stableBorrowRateEnabled,
      borrowingEnabled,
      isActive,
      isFrozen,
    } = await helpersContract.getReserveConfigurationData(oxau.address);

    expect(borrowingEnabled).to.be.equal(true);
    expect(isActive).to.be.equal(true);
    expect(isFrozen).to.be.equal(false);
    expect(decimals).to.be.equal(strategyOXAU.reserveDecimals);
    expect(ltv).to.be.equal(strategyOXAU.baseLTVAsCollateral);
    expect(liquidationThreshold).to.be.equal(strategyOXAU.liquidationThreshold);
    expect(liquidationBonus).to.be.equal(strategyOXAU.liquidationBonus);
    expect(stableBorrowRateEnabled).to.be.equal(strategyOXAU.stableBorrowRateEnabled);
    expect(reserveFactor).to.be.equal(strategyOXAU.reserveFactor);
  });

  it('Check the onlyAaveAdmin on freezeReserve ', async () => {
    const { configurator, users, oxau } = testEnv;
    await expect(
      configurator.connect(users[2].signer).freezeReserve(oxau.address),
      CALLER_NOT_POOL_ADMIN
    ).to.be.revertedWith(CALLER_NOT_POOL_ADMIN);
  });

  it('Check the onlyAaveAdmin on unfreezeReserve ', async () => {
    const { configurator, users, oxau } = testEnv;
    await expect(
      configurator.connect(users[2].signer).unfreezeReserve(oxau.address),
      CALLER_NOT_POOL_ADMIN
    ).to.be.revertedWith(CALLER_NOT_POOL_ADMIN);
  });

  it('Deactivates the OXAU reserve for borrowing', async () => {
    const { configurator, helpersContract, oxau, addressesProvider } = testEnv;
    const adminSigner = await getAdminSigner(addressesProvider);

    await configurator.connect(adminSigner).disableBorrowingOnReserve(oxau.address);
    const {
      decimals,
      ltv,
      liquidationBonus,
      liquidationThreshold,
      reserveFactor,
      stableBorrowRateEnabled,
      borrowingEnabled,
      isActive,
      isFrozen,
    } = await helpersContract.getReserveConfigurationData(oxau.address);

    expect(borrowingEnabled).to.be.equal(false);
    expect(isActive).to.be.equal(true);
    expect(isFrozen).to.be.equal(false);
    expect(decimals).to.be.equal(strategyOXAU.reserveDecimals);
    expect(ltv).to.be.equal(strategyOXAU.baseLTVAsCollateral);
    expect(liquidationThreshold).to.be.equal(strategyOXAU.liquidationThreshold);
    expect(liquidationBonus).to.be.equal(strategyOXAU.liquidationBonus);
    expect(stableBorrowRateEnabled).to.be.equal(strategyOXAU.stableBorrowRateEnabled);
    expect(reserveFactor).to.be.equal(strategyOXAU.reserveFactor);
  });

  it('Activates the OXAU reserve for borrowing', async () => {
    const { configurator, oxau, helpersContract, addressesProvider } = testEnv;
    const adminSigner = await getAdminSigner(addressesProvider);

    // Enable borrowing with stable rate enabled (second param = true)
    await configurator.connect(adminSigner).enableBorrowingOnReserve(oxau.address, true);
    const { variableBorrowIndex } = await helpersContract.getReserveData(oxau.address);

    const {
      decimals,
      ltv,
      liquidationBonus,
      liquidationThreshold,
      reserveFactor,
      stableBorrowRateEnabled,
      borrowingEnabled,
      isActive,
      isFrozen,
    } = await helpersContract.getReserveConfigurationData(oxau.address);

    expect(borrowingEnabled).to.be.equal(true);
    expect(isActive).to.be.equal(true);
    expect(isFrozen).to.be.equal(false);
    expect(decimals).to.be.equal(strategyOXAU.reserveDecimals);
    expect(ltv).to.be.equal(strategyOXAU.baseLTVAsCollateral);
    expect(liquidationThreshold).to.be.equal(strategyOXAU.liquidationThreshold);
    expect(liquidationBonus).to.be.equal(strategyOXAU.liquidationBonus);
    // stable rate was enabled by enableBorrowingOnReserve call above
    expect(stableBorrowRateEnabled).to.be.equal(true);
    expect(reserveFactor).to.be.equal(strategyOXAU.reserveFactor);

    expect(variableBorrowIndex.toString()).to.be.equal(RAY);
  });

  it('Check the onlyAaveAdmin on disableBorrowingOnReserve ', async () => {
    const { configurator, users, oxau } = testEnv;
    await expect(
      configurator.connect(users[2].signer).disableBorrowingOnReserve(oxau.address),
      CALLER_NOT_POOL_ADMIN
    ).to.be.revertedWith(CALLER_NOT_POOL_ADMIN);
  });

  it('Check the onlyAaveAdmin on enableBorrowingOnReserve ', async () => {
    const { configurator, users, oxau } = testEnv;
    await expect(
      configurator.connect(users[2].signer).enableBorrowingOnReserve(oxau.address, true),
      CALLER_NOT_POOL_ADMIN
    ).to.be.revertedWith(CALLER_NOT_POOL_ADMIN);
  });

  it('Deactivates the OXAU reserve as collateral', async () => {
    const { configurator, helpersContract, oxau, addressesProvider } = testEnv;
    const adminSigner = await getAdminSigner(addressesProvider);

    await configurator.connect(adminSigner).configureReserveAsCollateral(oxau.address, 0, 0, 0);

    const {
      decimals,
      ltv,
      liquidationBonus,
      liquidationThreshold,
      reserveFactor,
      stableBorrowRateEnabled,
      borrowingEnabled,
      isActive,
      isFrozen,
    } = await helpersContract.getReserveConfigurationData(oxau.address);

    expect(borrowingEnabled).to.be.equal(true);
    expect(isActive).to.be.equal(true);
    expect(isFrozen).to.be.equal(false);
    expect(decimals).to.be.equal(18);
    expect(ltv).to.be.equal(0);
    expect(liquidationThreshold).to.be.equal(0);
    expect(liquidationBonus).to.be.equal(0);
    expect(stableBorrowRateEnabled).to.be.equal(true);
    expect(reserveFactor).to.be.equal(strategyOXAU.reserveFactor);
  });

  it('Activates the OXAU reserve as collateral', async () => {
    const { configurator, helpersContract, oxau, addressesProvider } = testEnv;
    const adminSigner = await getAdminSigner(addressesProvider);

    await configurator.connect(adminSigner).configureReserveAsCollateral(oxau.address, strategyOXAU.baseLTVAsCollateral, strategyOXAU.liquidationThreshold, strategyOXAU.liquidationBonus);

    const {
      decimals,
      ltv,
      liquidationBonus,
      liquidationThreshold,
      reserveFactor,
      stableBorrowRateEnabled,
      borrowingEnabled,
      isActive,
      isFrozen,
    } = await helpersContract.getReserveConfigurationData(oxau.address);

    expect(borrowingEnabled).to.be.equal(true);
    expect(isActive).to.be.equal(true);
    expect(isFrozen).to.be.equal(false);
    expect(decimals).to.be.equal(strategyOXAU.reserveDecimals);
    expect(ltv).to.be.equal(strategyOXAU.baseLTVAsCollateral);
    expect(liquidationThreshold).to.be.equal(strategyOXAU.liquidationThreshold);
    expect(liquidationBonus).to.be.equal(strategyOXAU.liquidationBonus);
    // stable rate was enabled by enableBorrowingOnReserve in earlier test
    expect(stableBorrowRateEnabled).to.be.equal(true);
    expect(reserveFactor).to.be.equal(strategyOXAU.reserveFactor);
  });

  it('Check the onlyAaveAdmin on configureReserveAsCollateral ', async () => {
    const { configurator, users, oxau } = testEnv;
    await expect(
      configurator
        .connect(users[2].signer)
        .configureReserveAsCollateral(oxau.address, '7500', '8000', '10500'),
      CALLER_NOT_POOL_ADMIN
    ).to.be.revertedWith(CALLER_NOT_POOL_ADMIN);
  });

  it('Disable stable borrow rate on the OXAU reserve', async () => {
    const { configurator, helpersContract, oxau, addressesProvider } = testEnv;
    const adminSigner = await getAdminSigner(addressesProvider);

    await configurator.connect(adminSigner).disableReserveStableRate(oxau.address);
    const {
      decimals,
      ltv,
      liquidationBonus,
      liquidationThreshold,
      reserveFactor,
      stableBorrowRateEnabled,
      borrowingEnabled,
      isActive,
      isFrozen,
    } = await helpersContract.getReserveConfigurationData(oxau.address);

    expect(borrowingEnabled).to.be.equal(true);
    expect(isActive).to.be.equal(true);
    expect(isFrozen).to.be.equal(false);
    expect(decimals).to.be.equal(strategyOXAU.reserveDecimals);
    expect(ltv).to.be.equal(strategyOXAU.baseLTVAsCollateral);
    expect(liquidationThreshold).to.be.equal(strategyOXAU.liquidationThreshold);
    expect(liquidationBonus).to.be.equal(strategyOXAU.liquidationBonus);
    expect(stableBorrowRateEnabled).to.be.equal(false);
    expect(reserveFactor).to.be.equal(strategyOXAU.reserveFactor);
  });

  it('Enables stable borrow rate on the OXAU reserve', async () => {
    const { configurator, helpersContract, oxau, addressesProvider } = testEnv;
    const adminSigner = await getAdminSigner(addressesProvider);

    await configurator.connect(adminSigner).enableReserveStableRate(oxau.address);
    const {
      decimals,
      ltv,
      liquidationBonus,
      liquidationThreshold,
      reserveFactor,
      stableBorrowRateEnabled,
      borrowingEnabled,
      isActive,
      isFrozen,
    } = await helpersContract.getReserveConfigurationData(oxau.address);

    expect(borrowingEnabled).to.be.equal(true);
    expect(isActive).to.be.equal(true);
    expect(isFrozen).to.be.equal(false);
    expect(decimals).to.be.equal(strategyOXAU.reserveDecimals);
    expect(ltv).to.be.equal(strategyOXAU.baseLTVAsCollateral);
    expect(liquidationThreshold).to.be.equal(strategyOXAU.liquidationThreshold);
    expect(liquidationBonus).to.be.equal(strategyOXAU.liquidationBonus);
    expect(stableBorrowRateEnabled).to.be.equal(true);
    expect(reserveFactor).to.be.equal(strategyOXAU.reserveFactor);
  });

  it('Check the onlyAaveAdmin on disableReserveStableRate', async () => {
    const { configurator, users, oxau } = testEnv;
    await expect(
      configurator.connect(users[2].signer).disableReserveStableRate(oxau.address),
      CALLER_NOT_POOL_ADMIN
    ).to.be.revertedWith(CALLER_NOT_POOL_ADMIN);
  });

  it('Check the onlyAaveAdmin on enableReserveStableRate', async () => {
    const { configurator, users, oxau } = testEnv;
    await expect(
      configurator.connect(users[2].signer).enableReserveStableRate(oxau.address),
      CALLER_NOT_POOL_ADMIN
    ).to.be.revertedWith(CALLER_NOT_POOL_ADMIN);
  });

  it('Changes the reserve factor of OXAU', async () => {
    const { configurator, helpersContract, oxau, addressesProvider } = testEnv;
    const adminSigner = await getAdminSigner(addressesProvider);

    await configurator.connect(adminSigner).setReserveFactor(oxau.address, '1000');
    const {
      decimals,
      ltv,
      liquidationBonus,
      liquidationThreshold,
      reserveFactor,
      stableBorrowRateEnabled,
      borrowingEnabled,
      isActive,
      isFrozen,
    } = await helpersContract.getReserveConfigurationData(oxau.address);

    expect(borrowingEnabled).to.be.equal(true);
    expect(isActive).to.be.equal(true);
    expect(isFrozen).to.be.equal(false);
    expect(decimals).to.be.equal(strategyOXAU.reserveDecimals);
    expect(ltv).to.be.equal(strategyOXAU.baseLTVAsCollateral);
    expect(liquidationThreshold).to.be.equal(strategyOXAU.liquidationThreshold);
    expect(liquidationBonus).to.be.equal(strategyOXAU.liquidationBonus);
    // stable rate was enabled by enableReserveStableRate in earlier test
    expect(stableBorrowRateEnabled).to.be.equal(true);
    expect(reserveFactor).to.be.equal(1000);
  });

  it('Check the onlyLendingPoolManager on setReserveFactor', async () => {
    const { configurator, users, oxau } = testEnv;
    await expect(
      configurator.connect(users[2].signer).setReserveFactor(oxau.address, '2000'),
      CALLER_NOT_POOL_ADMIN
    ).to.be.revertedWith(CALLER_NOT_POOL_ADMIN);
  });

  it('Reverts when trying to disable the USDC reserve with liquidity on it', async () => {
    const { usdc, pool, configurator, deployer, addressesProvider } = testEnv;
    const adminSigner = await getAdminSigner(addressesProvider);
    const userAddress = await pool.signer.getAddress();

    await mintTokens(usdc, deployer.address, await convertToCurrencyDecimals(usdc.address, '1000'), deployer.signer);

    //approve protocol to access depositor wallet
    await usdc.approve(pool.address, APPROVAL_AMOUNT_LENDING_POOL);
    const amountUSDCtoDeposit = await convertToCurrencyDecimals(usdc.address, '1000');

    //user 1 deposits 1000 USDC
    await pool.deposit(usdc.address, amountUSDCtoDeposit, userAddress, '0');

    await expect(
      configurator.connect(adminSigner).deactivateReserve(usdc.address),
      LPC_RESERVE_LIQUIDITY_NOT_0
    ).to.be.revertedWith(LPC_RESERVE_LIQUIDITY_NOT_0);
  });
});
